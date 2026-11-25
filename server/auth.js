import crypto from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import { query, withTransaction } from "./db.js";

// --------------------------------------------------
// Own authentication (replaces Supabase Auth): bcrypt passwords + signed JWT.
// Passwords hashed by Supabase ($2a$/$2b$ bcrypt) keep working after migration.
// --------------------------------------------------

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const RESET_TTL_MS = 60 * 60 * 1000;

function jwtSecret() {
  const secret = process.env.AUTH_JWT_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw Object.assign(new Error("AUTH_JWT_SECRET must be set (32+ characters)."), { status: 500 });
  }
  return secret;
}

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

export function signToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: user.id, email: user.email, iat: now, exp: now + TOKEN_TTL_SECONDS });
  const sig = crypto.createHmac("sha256", jwtSecret()).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function verifyToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac("sha256", jwtSecret()).update(`${parts[0]}.${parts[1]}`).digest();
  const received = Buffer.from(parts[2], "base64url");
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (header.alg !== "HS256") return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!payload.sub || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  try {
    const header = String(req.headers.authorization || "");
    const payload = verifyToken(header.startsWith("Bearer ") ? header.slice(7) : "");
    if (!payload) return res.status(401).json({ error: "Please log in again." });
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Authentication is not configured." });
  }
}

const publicUser = (row) => ({ id: row.id, email: row.email, name: row.name || "", createdAt: row.created_at });

const strongPassword = (p) =>
  typeof p === "string" && p.length >= 12 && p.length <= 200 &&
  /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);

const WEAK_MESSAGE = "Password must have 12+ characters, uppercase, lowercase, number and symbol.";
const validEmail = (e) => typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Best-effort per-process brute-force limiter (key -> {count, resetAt}).
const attempts = new Map();
function tooMany(key, limit, windowMs) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + windowMs }); return false; }
  entry.count += 1;
  if (attempts.size > 5000) for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
  return entry.count > limit;
}

// bcrypt compare against a fixed hash when the user is unknown, so response
// time does not reveal whether an e-mail is registered.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

async function sendResetEmail(to, link) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw Object.assign(new Error("Password reset e-mail is not configured on the server."), { status: 503 });
    }
    console.log(`[dev] Password reset link for ${to}: ${link}`);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM?.trim() || "Global AI <onboarding@resend.dev>",
      to: [to],
      subject: "Reset your Global AI password",
      html: `<p>Click the link below to set a new password. It expires in 1 hour.</p><p><a href="${link}">Reset password</a></p><p>If you did not ask for this, ignore this e-mail.</p>`,
    }),
  });
  if (!response.ok) {
    console.error("Resend error:", response.status, await response.text().catch(() => ""));
    throw Object.assign(new Error("Could not send the reset e-mail."), { status: 502 });
  }
}

const router = express.Router();
const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();

router.post("/signup", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = String(req.body?.name || "").trim().slice(0, 120);
    const password = req.body?.password;
    if (!validEmail(email)) return res.status(400).json({ error: "Please enter a valid email address." });
    if (!name) return res.status(400).json({ error: "Please enter your full name." });
    if (!strongPassword(password)) return res.status(400).json({ error: WEAK_MESSAGE });
    if (tooMany(`signup:${ipOf(req)}`, 20, 60 * 60 * 1000)) return res.status(429).json({ error: "Too many attempts. Try again later." });

    const hash = await bcrypt.hash(password, 10);
    let row;
    try {
      ({ rows: [row] } = await query(
        `insert into users (email, password_hash, name, last_sign_in_at) values ($1, $2, $3, now())
         returning id, email, name, created_at`, [email, hash, name]));
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "An account with this email already exists. Please log in." });
      throw error;
    }
    return res.json({ token: signToken(row), user: publicUser(row) });
  } catch (error) {
    console.error("Signup error:", error.message);
    return res.status(error.status || 500).json({ error: error.status ? error.message : "Could not create the account." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ error: "Please enter your email and password." });
    if (tooMany(`login:${email}`, 10, 15 * 60 * 1000) || tooMany(`loginip:${ipOf(req)}`, 60, 15 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many login attempts. Try again in a few minutes." });
    }
    const { rows: [row] } = await query(
      "select id, email, name, password_hash, created_at from users where lower(email) = $1", [email]);
    const ok = await bcrypt.compare(password, row?.password_hash || DUMMY_HASH);
    if (!row || !ok) return res.status(401).json({ error: "Invalid login credentials." });
    await query("update users set last_sign_in_at = now() where id = $1", [row.id]);
    return res.json({ token: signToken(row), user: publicUser(row) });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(error.status || 500).json({ error: error.status ? error.message : "Could not log in." });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const { rows: [row] } = await query("select id, email, name, created_at from users where id = $1", [req.user.id]);
    if (!row) return res.status(401).json({ error: "Account no longer exists." });
    return res.json({ user: publicUser(row) });
  } catch (error) {
    console.error("Me error:", error.message);
    return res.status(500).json({ error: "Could not load your account." });
  }
});

router.post("/forgot", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!validEmail(email)) return res.status(400).json({ error: "Please enter your email address." });
    if (tooMany(`forgot:${email}`, 5, 60 * 60 * 1000) || tooMany(`forgotip:${ipOf(req)}`, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many requests. Try again later." });
    }
    const { rows: [user] } = await query("select id, email from users where lower(email) = $1", [email]);
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await query("delete from password_resets where user_id = $1 or expires_at < now()", [user.id]);
      await query("insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, $3)",
        [tokenHash, user.id, new Date(Date.now() + RESET_TTL_MS)]);
      const site = (process.env.SITE_URL?.trim() || req.headers.origin || "").replace(/\/$/, "");
      await sendResetEmail(user.email, `${site}/#type=recovery&token=${token}`);
    }
    // Same answer whether or not the e-mail exists.
    return res.json({ ok: true });
  } catch (error) {
    console.error("Forgot password error:", error.message);
    return res.status(error.status || 500).json({ error: error.status ? error.message : "Could not send the reset email." });
  }
});

router.post("/reset", async (req, res) => {
  try {
    const token = String(req.body?.token || "");
    const password = req.body?.password;
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: "This reset link is invalid or has expired." });
    if (!strongPassword(password)) return res.status(400).json({ error: WEAK_MESSAGE });
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const hash = await bcrypt.hash(password, 10);
    const done = await withTransaction(async (db) => {
      const { rows: [reset] } = await db.query(
        "delete from password_resets where token_hash = $1 and expires_at > now() returning user_id", [tokenHash]);
      if (!reset) return false;
      await db.query("update users set password_hash = $1 where id = $2", [hash, reset.user_id]);
      await db.query("delete from password_resets where user_id = $1", [reset.user_id]);
      return true;
    });
    if (!done) return res.status(400).json({ error: "This reset link is invalid or has expired." });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Reset password error:", error.message);
    return res.status(500).json({ error: "Could not update the password." });
  }
});

export default router;
