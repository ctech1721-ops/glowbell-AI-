// Applies neon/schema.sql to the database in DATABASE_URL.
//   npm run db:setup
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

dotenv.config({ override: true });

const url = process.env.DATABASE_URL?.trim();
if (!url) { console.error("DATABASE_URL is missing in .env"); process.exit(1); }

const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../neon/schema.sql"), "utf8");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  console.log("Neon schema applied successfully.");
} finally {
  await client.end();
}
