import dotenv from "dotenv";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ override: true });

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const serverUrl = (process.env.CHAT_WORKER_SERVER_URL || `http://127.0.0.1:${process.env.PORT || 3001}`).replace(/\/$/, "");
const workerSecret = process.env.CHAT_WORKER_SECRET?.trim();
const leaseSeconds = Math.max(30, Math.min(300, Number(process.env.CHAT_WORKER_LEASE_SECONDS || 120)));
const pollMs = Math.max(250, Number(process.env.CHAT_WORKER_POLL_MS || 1000));
const heartbeatMs = Math.max(5000, Math.min(60000, Number(process.env.CHAT_WORKER_HEARTBEAT_MS || 20000)));

if (!supabaseUrl || !serviceKey || !workerSecret) {
  throw new Error("Worker requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CHAT_WORKER_SECRET.");
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const workerId = `global-ai-worker-${crypto.randomUUID()}`;
let stopping = false;

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

async function processTask(task) {
  const taskId = task.id;
  const token = Number(task.fencing_token);
  let leaseLost = false;
  const heartbeat = setInterval(async () => {
    console.log(`Heartbeat timer started: ${task.request_id}`);
    try {
      const renewed = await rpc("heartbeat_chat_task", {
        p_task_id: taskId, p_worker_id: workerId, p_fencing_token: token, p_lease_seconds: leaseSeconds,
      });
      if (renewed === true) {
  console.log(`Heartbeat renewed: ${task.request_id}`);
} else {
  leaseLost = true;
  console.error(`Heartbeat renewal failed: ${task.request_id}`);
}
    } catch (error) {
      console.error("Worker heartbeat error:", error.message);
      leaseLost = true;
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  try {
    const response = await fetch(`${serverUrl}/api/internal/process-chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-chat-worker-secret": workerSecret },
      body: JSON.stringify({ payload: task.payload }),
      signal: AbortSignal.timeout(Number(process.env.CHAT_WORKER_TASK_TIMEOUT_MS || 180000)),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Chat processor returned HTTP ${response.status}`);
    if (leaseLost) throw new Error("Worker lease was lost before completion.");
    const completed = await rpc("complete_chat_task", {
      p_task_id: taskId, p_worker_id: workerId, p_fencing_token: token, p_result: data,
    });
    if (!completed) console.warn(`Task ${task.request_id} completion rejected: stale worker fencing token.`);
  } catch (error) {
    console.error(`Task ${task.request_id} failed:`, error.message);
    try {
      const marked = await rpc("fail_chat_task", {
        p_task_id: taskId, p_worker_id: workerId, p_fencing_token: token, p_error: error.message,
      });
      if (!marked) console.warn(`Task ${task.request_id} failure update rejected: lease no longer owned.`);
    } catch (dbError) {
      console.error("Could not mark task failed:", dbError.message);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function recoverExpired() {
  try {
    const count = await rpc("recover_expired_chat_tasks", { p_batch_size: 100 });
    if (count) console.warn(`Recovered ${count} expired chat task(s).`);
  } catch (error) {
    console.error("Crash recovery scan failed:", error.message);
  }
}

async function main() {
  console.log(`Global AI worker started: ${workerId}`);
  while (!stopping) {
    await recoverExpired();
    try {
      const claimed = await rpc("claim_chat_task", { p_worker_id: workerId, p_lease_seconds: leaseSeconds });
      const task = Array.isArray(claimed) ? claimed[0] : claimed;
      if (task?.id) {
        await processTask(task);
        continue;
      }
    } catch (error) {
      console.error("Queue claim failed:", error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function shutdown() { stopping = true; }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
main().catch((error) => { console.error(error); process.exitCode = 1; });
