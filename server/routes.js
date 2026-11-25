import crypto from "node:crypto";
import express from "express";
import { query, withTransaction } from "./db.js";
import { requireAuth } from "./auth.js";

// Everything the browser used to do directly against Supabase (with RLS) now
// goes through these authenticated routes. Ownership checks live here.

const router = express.Router();
// Only guard our own paths; other /api routes (chat, owner, ...) have their own checks.
router.use(["/chats", "/sms"], requireAuth);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID.test(v);

// plpgsql `raise exception` (P0001) messages are written for end users.
function fail(res, error, fallback) {
  if (error?.code === "P0001") return res.status(400).json({ error: error.message });
  if (error?.status) return res.status(error.status).json({ error: error.message });
  console.error(`${fallback}:`, error?.message || error);
  return res.status(500).json({ error: fallback });
}

// ---------------------------------------------------------------- chats ---
router.get("/chats", async (req, res) => {
  try {
    const { rows } = await query(
      "select id, title, messages, created_at, updated_at from chats where user_id = $1 order by updated_at desc",
      [req.user.id]);
    res.json({ chats: rows });
  } catch (error) { fail(res, error, "Could not load chat history."); }
});

router.put("/chats/:id", async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "Invalid chat id." });
    const title = String(req.body?.title || "New chat").slice(0, 300);
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const updated = Number.isFinite(Date.parse(req.body?.updatedAt)) ? new Date(req.body.updatedAt) : new Date();
    // The WHERE clause stops one user from overwriting another user's chat id.
    const { rowCount } = await query(
      `insert into chats (id, user_id, title, messages, updated_at) values ($1, $2, $3, $4::jsonb, $5)
       on conflict (id) do update set title = excluded.title, messages = excluded.messages, updated_at = excluded.updated_at
       where chats.user_id = excluded.user_id`,
      [req.params.id, req.user.id, title, JSON.stringify(messages), updated]);
    if (!rowCount) return res.status(403).json({ error: "You cannot modify this chat." });
    res.json({ ok: true });
  } catch (error) { fail(res, error, "Could not save the chat."); }
});

router.delete("/chats/:id", async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "Invalid chat id." });
    await query("delete from chats where id = $1 and user_id = $2", [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (error) { fail(res, error, "Could not delete the chat."); }
});

router.delete("/chats", async (req, res) => {
  try {
    await query("delete from chats where user_id = $1", [req.user.id]);
    res.json({ ok: true });
  } catch (error) { fail(res, error, "Could not clear chat history."); }
});

// ------------------------------------------------------------------ sms ---
router.get("/sms/unread", async (req, res) => {
  try {
    const [incoming, requests] = await Promise.all([
      query("select sender_id, created_at from sms_messages where receiver_id = $1 order by created_at desc limit 300", [req.user.id]),
      query("select count(*)::int as n from sms_requests where receiver_id = $1 and status = 'pending'", [req.user.id]),
    ]);
    res.json({ incoming: incoming.rows, requestCount: requests.rows[0].n });
  } catch (error) { fail(res, error, "Could not load unread messages."); }
});

router.get("/sms/friends", async (req, res) => {
  try {
    const { rows } = await query(
      "select friend_id, friend_email, friend_name, created_at from sms_friends where user_id = $1 order by created_at desc",
      [req.user.id]);
    res.json({ friends: rows });
  } catch (error) { fail(res, error, "Could not load friends."); }
});

router.get("/sms/requests", async (req, res) => {
  try {
    const [incoming, sent, blocked] = await Promise.all([
      query("select * from sms_requests where receiver_id = $1 and status = 'pending' order by created_at desc", [req.user.id]),
      query("select * from sms_requests where requester_id = $1 and status = 'pending' order by created_at desc", [req.user.id]),
      query("select blocked_id, blocked_email, blocked_name from sms_blocks where blocker_id = $1", [req.user.id]),
    ]);
    res.json({ incoming: incoming.rows, sent: sent.rows, blocked: blocked.rows });
  } catch (error) { fail(res, error, "Could not load requests."); }
});

router.post("/sms/requests", async (req, res) => {
  try {
    const { rows } = await query("select * from sms_send_request($1, $2)", [req.user.id, String(req.body?.email || "")]);
    res.json({ result: rows[0] || null });
  } catch (error) { fail(res, error, "Could not send the request."); }
});

router.post("/sms/requests/:id/respond", async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "Request not found." });
    await query("select sms_respond_request($1, $2, $3)", [req.user.id, req.params.id, String(req.body?.action || "")]);
    res.json({ ok: true });
  } catch (error) { fail(res, error, "Could not answer the request."); }
});

router.post("/sms/block", async (req, res) => {
  try {
    if (!isUuid(req.body?.userId)) return res.status(400).json({ error: "User not found." });
    await query("select sms_block_user($1, $2)", [req.user.id, req.body.userId]);
    res.json({ ok: true });
  } catch (error) { fail(res, error, "Could not block the user."); }
});

router.post("/sms/unblock", async (req, res) => {
  try {
    if (!isUuid(req.body?.userId)) return res.status(400).json({ error: "User not found." });
    await query("select sms_unblock_user($1, $2)", [req.user.id, req.body.userId]);
    res.json({ ok: true });
  } catch (error) { fail(res, error, "Could not unblock the user."); }
});

router.get("/sms/messages/:friendId", async (req, res) => {
  try {
    if (!isUuid(req.params.friendId)) return res.status(400).json({ error: "Invalid friend." });
    const { rows } = await query(
      `select * from (
         select m.id, m.sender_id, m.receiver_id, m.body, m.media_path, m.media_type, m.media_name,
                m.media_size::float8 as media_size, m.created_at,
                md.parts as media_parts, md.content_type as media_content_type
           from sms_messages m left join sms_media md on md.id::text = m.media_path
          where (m.sender_id = $1 and m.receiver_id = $2) or (m.sender_id = $2 and m.receiver_id = $1)
          order by m.created_at desc limit 500
       ) t order by created_at asc`,
      [req.user.id, req.params.friendId]);
    res.json({ messages: rows });
  } catch (error) { fail(res, error, "Could not load messages."); }
});

const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_PART_BYTES = 3 * 1024 * 1024;

async function areFriends(a, b) {
  const { rowCount } = await query("select 1 from sms_friends where user_id = $1 and friend_id = $2", [a, b]);
  return rowCount > 0;
}

// Step 1 of an upload: reserve a media row.
router.post("/sms/media", async (req, res) => {
  try {
    const { receiverId, contentType, size } = req.body || {};
    if (!isUuid(receiverId)) return res.status(400).json({ error: "Invalid friend." });
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_MEDIA_BYTES) return res.status(400).json({ error: "File is too large (max 50 MB)." });
    if (!(await areFriends(req.user.id, receiverId))) return res.status(403).json({ error: "You can only send files to friends." });
    const { rows: [row] } = await query(
      "insert into sms_media (owner_id, receiver_id, content_type, size) values ($1, $2, $3, $4) returning id",
      [req.user.id, receiverId, String(contentType || "application/octet-stream").slice(0, 120), Math.round(bytes)]);
    res.json({ id: row.id, partSize: MAX_PART_BYTES });
  } catch (error) { fail(res, error, "Could not start the upload."); }
});

// Step 2: upload each <= 3 MB part as a raw body (stays below serverless body limits).
router.put("/sms/media/:id/:idx", express.raw({ type: "*/*", limit: "4mb" }), async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    if (!isUuid(req.params.id) || !Number.isInteger(idx) || idx < 0 || idx > 40) return res.status(400).json({ error: "Invalid upload part." });
    if (!Buffer.isBuffer(req.body) || !req.body.length || req.body.length > MAX_PART_BYTES) return res.status(400).json({ error: "Invalid upload part size." });
    const { rowCount } = await query(
      `insert into sms_media_parts (media_id, idx, data)
       select id, $2, $3 from sms_media where id = $1 and owner_id = $4
       on conflict (media_id, idx) do update set data = excluded.data`,
      [req.params.id, idx, req.body, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: "Upload not found." });
    res.json({ ok: true });
  } catch (error) { fail(res, error, "Could not upload the file part."); }
});

// Step 3 (or plain text message): create the message.
router.post("/sms/messages", async (req, res) => {
  try {
    const { receiverId, body, mediaId, mediaType, mediaName, mediaSize } = req.body || {};
    if (!isUuid(receiverId)) return res.status(400).json({ error: "Invalid friend." });
    if (!(await areFriends(req.user.id, receiverId))) return res.status(403).json({ error: "You can only message friends." });
    const text = typeof body === "string" ? body.slice(0, 10000) : null;
    if (!mediaId && !text?.trim()) return res.status(400).json({ error: "Message is empty." });

    const row = await withTransaction(async (db) => {
      let kind = null;
      if (mediaId) {
        if (!isUuid(mediaId) || !["image", "video", "file"].includes(mediaType)) throw Object.assign(new Error("Invalid attachment."), { status: 400 });
        const { rows: [media] } = await db.query("select id, size from sms_media where id = $1 and owner_id = $2 and receiver_id = $3 for update",
          [mediaId, req.user.id, receiverId]);
        if (!media) throw Object.assign(new Error("Attachment not found."), { status: 404 });
        const { rows: [count] } = await db.query("select count(*)::int as n, coalesce(sum(length(data)), 0)::float8 as bytes from sms_media_parts where media_id = $1", [mediaId]);
        if (!count.n || Number(count.bytes) !== Number(media.size)) throw Object.assign(new Error("Upload is incomplete. Please try again."), { status: 400 });
        await db.query("update sms_media set parts = $2 where id = $1", [mediaId, count.n]);
        kind = mediaType;
      }
      const { rows: [msg] } = await db.query(
        `insert into sms_messages (sender_id, receiver_id, body, media_path, media_type, media_name, media_size)
         values ($1, $2, $3, $4, $5, $6, $7) returning id, sender_id, receiver_id, body, media_path, media_type, media_name, media_size::float8 as media_size, created_at`,
        [req.user.id, receiverId, text?.trim() ? text : null, mediaId || null, kind,
         kind === "file" ? String(mediaName || "file").slice(0, 200) : null, kind === "file" ? Number(mediaSize) || null : null]);
      return msg;
    });
    res.json({ message: row });
  } catch (error) { fail(res, error, "Message could not be sent."); }
});

router.delete("/sms/messages/:id", async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "Message not found." });
    await withTransaction(async (db) => {
      const { rows: [msg] } = await db.query("delete from sms_messages where id = $1 and sender_id = $2 returning media_path", [req.params.id, req.user.id]);
      if (msg?.media_path && isUuid(msg.media_path)) await db.query("delete from sms_media where id = $1 and owner_id = $2", [msg.media_path, req.user.id]);
    });
    res.json({ ok: true });
  } catch (error) { fail(res, error, "Could not delete the message."); }
});

async function mediaFor(userId, mediaId) {
  const { rows: [media] } = await query(
    "select id, content_type, size::float8 as size, parts from sms_media where id = $1 and (owner_id = $2 or receiver_id = $2)", [mediaId, userId]);
  return media || null;
}

router.get("/sms/media/:id/:idx", async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    if (!isUuid(req.params.id) || !Number.isInteger(idx) || idx < 0) return res.status(400).json({ error: "Invalid file part." });
    if (!(await mediaFor(req.user.id, req.params.id))) return res.status(404).json({ error: "File not found." });
    const { rows: [part] } = await query("select data from sms_media_parts where media_id = $1 and idx = $2", [req.params.id, idx]);
    if (!part) return res.status(404).json({ error: "File part not found." });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(part.data);
  } catch (error) { fail(res, error, "Could not download the file."); }
});

export default router;
