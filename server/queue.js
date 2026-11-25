import { query } from "./db.js";

// Thin wrappers over the queue functions defined in neon/schema.sql.
export async function enqueueChatTask(requestId, payloadHash, payload, maxRetries = 3) {
  await query("select * from enqueue_chat_task($1, $2, $3::jsonb, $4)", [
    requestId, payloadHash, JSON.stringify(payload), maxRetries,
  ]);
}

export async function claimChatTask(workerId, leaseSeconds) {
  const { rows } = await query("select * from claim_chat_task($1, $2)", [workerId, leaseSeconds]);
  return rows[0] || null;
}

export async function heartbeatChatTask(taskId, workerId, fencingToken, leaseSeconds) {
  const { rows } = await query("select heartbeat_chat_task($1, $2, $3, $4) as ok", [taskId, workerId, fencingToken, leaseSeconds]);
  return rows[0]?.ok === true;
}

export async function completeChatTask(taskId, workerId, fencingToken, result) {
  const { rows } = await query("select complete_chat_task($1, $2, $3, $4::jsonb) as ok", [taskId, workerId, fencingToken, JSON.stringify(result ?? {})]);
  return rows[0]?.ok === true;
}

export async function failChatTask(taskId, workerId, fencingToken, message) {
  const { rows } = await query("select fail_chat_task($1, $2, $3, $4) as ok", [taskId, workerId, fencingToken, String(message || "Unknown worker error")]);
  return rows[0]?.ok === true;
}

export async function recoverExpiredChatTasks(batchSize = 100) {
  const { rows } = await query("select recover_expired_chat_tasks($1) as n", [batchSize]);
  return Number(rows[0]?.n || 0);
}

export async function getChatTask(requestId) {
  const { rows } = await query("select status, result, last_error from chat_tasks where request_id = $1", [requestId]);
  return rows[0] || null;
}
