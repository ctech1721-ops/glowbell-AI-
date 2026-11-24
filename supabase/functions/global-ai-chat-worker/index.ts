import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const workerSecret = Deno.env.get("CHAT_WORKER_SECRET") ?? "";
const triggerSecret = Deno.env.get("WORKER_TRIGGER_SECRET") ?? "";
const serverUrl = (Deno.env.get("CHAT_WORKER_SERVER_URL") ?? "").replace(/\/$/, "");
const leaseSeconds = 180;
const processorTimeoutMs = 125_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

if (!supabaseUrl || !serviceRoleKey || !workerSecret || !triggerSecret || !serverUrl) {
  console.error("Worker configuration is incomplete.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

async function processOneTask() {
  // Requeue expired leases left by an interrupted invocation before claiming work.
  await rpc("recover_expired_chat_tasks", { p_batch_size: 25 });
  const workerId = `global-ai-edge-${crypto.randomUUID()}`;
  const claimed = await rpc("claim_chat_task", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  const task = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!task?.id) return { processed: false, reason: "queue_empty" };

  const taskId = task.id as string;
  const requestId = String(task.request_id ?? "unknown");
  const fencingToken = Number(task.fencing_token);
  let leaseLost = false;
  let heartbeatBusy = false;

  const heartbeat = setInterval(async () => {
    if (heartbeatBusy || leaseLost) return;
    heartbeatBusy = true;
    try {
      const renewed = await rpc("heartbeat_chat_task", {
        p_task_id: taskId,
        p_worker_id: workerId,
        p_fencing_token: fencingToken,
        p_lease_seconds: leaseSeconds,
      });
      if (renewed !== true) leaseLost = true;
    } catch (error) {
      console.error("Task lease heartbeat failed", requestId, error);
      leaseLost = true;
    } finally {
      heartbeatBusy = false;
    }
  }, 20_000);

  try {
    const response = await fetch(`${serverUrl}/api/internal/process-chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chat-worker-secret": workerSecret,
      },
      body: JSON.stringify({ payload: task.payload }),
      signal: AbortSignal.timeout(processorTimeoutMs),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result?.error || `Chat processor returned HTTP ${response.status}`);
    }
    if (leaseLost) throw new Error("Worker lease was lost before completion.");

    const completed = await rpc("complete_chat_task", {
      p_task_id: taskId,
      p_worker_id: workerId,
      p_fencing_token: fencingToken,
      p_result: result,
    });
    if (completed !== true) {
      throw new Error("Task completion was rejected because the worker lease is no longer valid.");
    }
    return { processed: true, requestId, status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    console.error("Chat task processing failed", requestId, message);
    try {
      await rpc("fail_chat_task", {
        p_task_id: taskId,
        p_worker_id: workerId,
        p_fencing_token: fencingToken,
        p_error: message,
      });
    } catch (dbError) {
      console.error("Could not mark chat task failed", requestId, dbError);
    }
    return { processed: true, requestId, status: "retry_or_failed", error: message };
  } finally {
    clearInterval(heartbeat);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!triggerSecret || request.headers.get("x-worker-trigger-secret") !== triggerSecret) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!supabaseUrl || !serviceRoleKey || !workerSecret || !serverUrl) {
    return json({ error: "Worker configuration is incomplete" }, 500);
  }

  try {
    const result = await processOneTask();
    return json({ ok: true, ...result });
  } catch (error) {
    console.error("Worker invocation failed", error);
    return json({ error: error instanceof Error ? error.message : "Worker invocation failed" }, 500);
  }
});
