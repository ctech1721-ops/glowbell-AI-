import pg from "pg";

// One small pool per server process. Use Neon's *pooled* connection string
// (host contains "-pooler") when running on serverless platforms like Vercel.
let pool;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL is missing. Add your Neon connection string to .env.");
    }
    pool = new pg.Pool({
      connectionString,
      max: Math.max(1, Number(process.env.PG_POOL_MAX || 5)),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
    pool.on("error", (error) => console.error("Postgres pool error:", error.message));
  }
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try { await client.query("rollback"); } catch { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) { await pool.end(); pool = undefined; }
}
