// One-time copy of your existing data from Supabase into Neon.
//
//   1. Run neon/schema.sql on Neon first (npm run db:setup).
//   2. In .env set  DATABASE_URL=<Neon>  and  SUPABASE_DB_URL=<Supabase connection string>
//      (Supabase Dashboard -> Connect -> "Session pooler" or direct string, with your DB password).
//   3. npm run db:migrate-from-supabase
//
// Copies users (with their bcrypt password hashes, so everyone keeps their
// password), chats, SMS friends/requests/blocks/messages, daily usage, and the
// photos/videos/files from the `sms-media` bucket (needs SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY for the files). Safe to re-run: existing rows are skipped.
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ override: true });

const neonUrl = process.env.DATABASE_URL?.trim();
const supaUrl = process.env.SUPABASE_DB_URL?.trim();
if (!neonUrl || !supaUrl) {
  console.error("Set both DATABASE_URL (Neon) and SUPABASE_DB_URL (Supabase) in .env");
  process.exit(1);
}

const src = new pg.Client({ connectionString: supaUrl });
const dst = new pg.Client({ connectionString: neonUrl });
await src.connect();
await dst.connect();

const PART = 3 * 1024 * 1024;
const stats = {};
const bump = (k, n = 1) => { stats[k] = (stats[k] || 0) + n; };

async function tableExists(name) {
  const { rows } = await src.query("select to_regclass($1) as t", [name]);
  return Boolean(rows[0].t);
}

async function copy(label, selectSql, insertSql, toParams) {
  const { rows } = await src.query(selectSql);
  for (const row of rows) {
    const r = await dst.query(insertSql, toParams(row));
    bump(label, r.rowCount);
  }
  console.log(`${label}: ${stats[label] || 0} copied (of ${rows.length})`);
}

try {
  await copy("users",
    `select id, lower(email) as email, encrypted_password, coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', '') as name,
            created_at, last_sign_in_at
       from auth.users where email is not null`,
    `insert into users (id, email, password_hash, name, created_at, last_sign_in_at) values ($1,$2,$3,$4,$5,$6)
       on conflict do nothing`,
    (u) => [u.id, u.email, u.encrypted_password || "!", u.name, u.created_at, u.last_sign_in_at]);

  if (await tableExists("public.chats")) {
    await copy("chats", "select id, user_id, title, messages, created_at, updated_at from public.chats",
      `insert into chats (id, user_id, title, messages, created_at, updated_at) values ($1,$2,$3,$4::jsonb,$5,$6)
         on conflict (id) do nothing`,
      (c) => [c.id, c.user_id, c.title, JSON.stringify(c.messages ?? []), c.created_at, c.updated_at]);
  }
  if (await tableExists("public.sms_friends")) {
    await copy("sms_friends", "select * from public.sms_friends",
      `insert into sms_friends (user_id, friend_id, friend_email, friend_name, created_at) values ($1,$2,$3,$4,$5) on conflict do nothing`,
      (r) => [r.user_id, r.friend_id, r.friend_email, r.friend_name, r.created_at]);
  }
  if (await tableExists("public.sms_requests")) {
    await copy("sms_requests", "select * from public.sms_requests",
      `insert into sms_requests (id, requester_id, receiver_id, requester_email, requester_name, receiver_email, receiver_name, status, created_at, responded_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing`,
      (r) => [r.id, r.requester_id, r.receiver_id, r.requester_email, r.requester_name, r.receiver_email, r.receiver_name, r.status, r.created_at, r.responded_at]);
  }
  if (await tableExists("public.sms_blocks")) {
    await copy("sms_blocks", "select * from public.sms_blocks",
      `insert into sms_blocks (blocker_id, blocked_id, blocked_email, blocked_name, created_at) values ($1,$2,$3,$4,$5) on conflict do nothing`,
      (r) => [r.blocker_id, r.blocked_id, r.blocked_email, r.blocked_name, r.created_at]);
  }
  if (await tableExists("public.user_usage_daily")) {
    await copy("user_usage_daily", "select * from public.user_usage_daily",
      `insert into user_usage_daily (user_id, usage_date, seconds, last_seen) values ($1,$2,$3,$4) on conflict do nothing`,
      (r) => [r.user_id, r.usage_date, r.seconds, r.last_seen]);
  }

  // Messages + their files.
  if (await tableExists("public.sms_messages")) {
    const sbUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const hasMediaColumns = (await src.query(
      "select count(*)::int n from information_schema.columns where table_schema='public' and table_name='sms_messages' and column_name in ('media_name','media_size')")).rows[0].n === 2;
    const { rows } = await src.query(`select * from public.sms_messages order by created_at`);
    let skippedFiles = 0;
    for (const m of rows) {
      let mediaId = null;
      if (m.media_path) {
        if (!sbUrl || !sbKey) { skippedFiles += 1; }
        else {
          const response = await fetch(`${sbUrl}/storage/v1/object/sms-media/${m.media_path.split("/").map(encodeURIComponent).join("/")}`, {
            headers: { Authorization: `Bearer ${sbKey}`, apikey: sbKey },
          });
          if (!response.ok) { skippedFiles += 1; console.warn(`  file missing in Supabase storage: ${m.media_path}`); }
          else {
            const buf = Buffer.from(await response.arrayBuffer());
            const contentType = response.headers.get("content-type") || "application/octet-stream";
            const { rows: [media] } = await dst.query(
              `insert into sms_media (owner_id, receiver_id, content_type, size, parts, created_at) values ($1,$2,$3,$4,$5,$6) returning id`,
              [m.sender_id, m.receiver_id, contentType, buf.length, Math.ceil(buf.length / PART), m.created_at]);
            for (let i = 0, off = 0; off < buf.length; i += 1, off += PART) {
              await dst.query("insert into sms_media_parts (media_id, idx, data) values ($1,$2,$3)", [media.id, i, buf.subarray(off, off + PART)]);
            }
            mediaId = media.id;
          }
        }
        if (!mediaId) continue; // do not copy a message whose file is gone
      }
      const r = await dst.query(
        `insert into sms_messages (id, sender_id, receiver_id, body, media_path, media_type, media_name, media_size, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
        [m.id, m.sender_id, m.receiver_id, m.body, mediaId, mediaId ? m.media_type : null,
         hasMediaColumns ? m.media_name : null, hasMediaColumns ? m.media_size : null, m.created_at]);
      bump("sms_messages", r.rowCount);
    }
    console.log(`sms_messages: ${stats.sms_messages || 0} copied (of ${rows.length}); files skipped: ${skippedFiles}`);
    if (skippedFiles && (!sbUrl || !sbKey)) console.warn("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to copy photo/video/file messages.");
  }

  console.log("\nDone. Existing users can log in with their old passwords.");
} finally {
  await src.end();
  await dst.end();
}
