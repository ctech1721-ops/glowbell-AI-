import dotenv from "dotenv";
import crypto from "node:crypto";
import {
  claimChatTask, heartbeatChatTask, completeChatTask, failChatTask, recoverExpiredChatTasks,
} from "./queue.js";
import { closePool } from "./db.js";

dotenv.config({ override: true });

// Optional standalone worker (the API server also drains the queue itself).
const serverUrl = (process.env.CHAT_WORKER_SERVER_URL || `http://127.0.0.1:${process.env.PORT || 3001}`).replace(/\/$/, "");
const workerSecret = process.env.CHAT_WORKER_SECRET?.trim();
const leaseSeconds = Math.max(30, Math.min(300, Number(process.env.CHAT_WORKER_LEASE_SECONDS || 120)));
const pollMs = Math.max(250, Number(process.env.CHAT_WORKER_POLL_MS || 1000));
const heartbeatMs = Math.max(5000, Math.min(60000, Number(process.env.CHAT_WORKER_HEARTBEAT_MS || 20000)));

if (!process.env.DATABASE_URL?.trim() || !workerSecret) {
  throw new Error("Worker requires DATABASE_URL and CHAT_WORKER_SECRET.");
}

const workerId = `global-ai-worker-${crypto.randomUUID()}`;
let stopping = false;

async function processTask(task) {
  const taskId = task.id;
  const token = Number(task.fencing_token);
  let leaseLost = false;
  const heartbeat = setInterval(async () => {
    try {
      if (!(await heartbeatChatTask(taskId, workerId, token, leaseSeconds))) {
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
    const completed = await completeChatTask(taskId, workerId, token, data);
    if (!completed) console.warn(`Task ${task.request_id} completion rejected: stale worker fencing token.`);
  } catch (error) {
    console.error(`Task ${task.request_id} failed:`, error.message);
    try {
      const marked = await failChatTask(taskId, workerId, token, error.message);
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
    const count = await recoverExpiredChatTasks(100);
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
      const task = await claimChatTask(workerId, leaseSeconds);
      if (task?.id) {
        await processTask(task);
        continue;
      }
    } catch (error) {
      console.error("Queue claim failed:", error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  await closePool();
}

function shutdown() { stopping = true; }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
main().catch((error) => { console.error(error); process.exitCode = 1; });
