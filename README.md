# Global AI — redesigned frontend

This package keeps the existing React/Vite frontend, Express API, Neon (PostgreSQL) database with built-in email/password authentication and chat persistence, multi-provider AI integration (Groq, Gemini and optional Cloudflare Workers AI), Tavily web search, owner dashboard, report issue flow, file attachments, website creator and notes feature. The visual layer has been redesigned around the supplied black/electric-blue Global AI reference, including the extracted glowing G logo.

## Run locally

Requirements: Node.js 20.19+ or 22.12+ and npm.

1. Open this folder in VS Code.
2. Install dependencies:

   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your Neon `DATABASE_URL`, `AUTH_JWT_SECRET` and your provider keys. Never commit or share `.env`.
4. Create the tables once: `npm run db:setup` (or paste `neon/schema.sql` into the Neon SQL Editor).
5. Start frontend and backend:

   ```bash
   npm run dev
   ```
6. Open http://localhost:5173.

The Vite development server proxies `/api` to the Express server on port 3001. For a production build, run `npm run build`; for the standalone Express server, run `npm start`.


## API-only AI provider fallback

The backend supports API-key-only inference; it does not require a local knowledge dataset. Provider order is Groq, then Gemini, then Cloudflare Workers AI when configured. Configure `GROQ_API_KEY`, `GEMINI_API_KEY`, and (optionally) `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` in the server environment. `GEMINI_MODEL` defaults to `gemini-3.1-flash-lite`; confirm that this model is available to your Google AI Studio project and on its free tier before deployment. Cloudflare's default model is `@cf/zai-org/glm-4.7-flash`, which Cloudflare lists among models available on its Workers Free plan. The router does not silently switch to paid providers. Cloudflare is skipped for image requests; Gemini handles image fallback.

Chat requests send only a bounded recent history (up to 6 messages / 5,000 characters), and the default chat output cap is 2,048 tokens. Set `CHAT_MAX_OUTPUT_TOKENS` between 512 and 4,096 if you need to tune response length. Spreadsheet and website-generation tasks keep their larger task-specific output caps and use the same provider fallback.

Free-tier quotas are controlled by each provider and can change. Cloudflare Workers AI currently lists a 10,000-Neuron daily free allocation; this is not 10,000 chat requests and the amount consumed depends on the model and workload. If all configured providers reach their limits, Global AI returns a clear temporary-unavailable message; it cannot guarantee unlimited or 5,000 simultaneous AI generations on free plans. Gemini free-tier requests may be used by Google to improve its products under Google's current free-tier terms, so do not send sensitive user information unless the applicable data terms are acceptable.

Copy `.env.example` to `.env` for local development and fill in your real values. For Vercel/production, add the same variables in the project's server-side Environment Variables. Never expose any AI provider key or token in frontend code or a `VITE_` variable.

## Notes

The Notes widget is available from the notes icon in the chat composer. It supports creating notes, switching between saved notes, editing, saving, deleting, and downloading a note as PDF. Notes are stored in the browser's local storage per signed-in user, as in the supplied project; they are not synced across devices.

## Deployment

The existing Express app is exported for the supplied Vercel API catch-all at `api/[...path].js`. Configure the environment variables from `.env.example` in the deployment provider. Keep secret keys server-side; no database or auth value is exposed to the browser (there are no `VITE_` variables any more). Test authentication, chat, web search, uploads and owner access in the deployed environment before publishing it to users.

## Important

The ZIP does not contain your private `.env` values. Add the same working values from your existing deployment; do not replace them with the example placeholders. The Excel endpoint remains marked Coming Soon in the original backend and has intentionally not been changed.

## UI update
Start-circle intro with solid-blue animated G, dark welcome guide, daily date + calendar (header chip, welcome card, day dividers), flat chat messages, responsive phone/tablet/desktop layout, and ChatGPT-style features: stop generating, typing effect, edit & resend, voice input, read aloud, like/dislike, chat search/rename/pin, temporary chat, export to Markdown, drag-drop/paste files, slash commands, personalisation (response style + custom instructions), keyboard shortcuts (Ctrl K / B / ,).

## Database: Neon (replaces Supabase)

Everything now runs on a single Neon PostgreSQL database. The browser never talks to the database directly; it calls the Express API (`/api/auth/*`, `/api/chats`, `/api/sms/*`), which checks the logged-in user.

| Was (Supabase) | Now |
| --- | --- |
| Supabase Auth | `users` table, bcrypt passwords, signed 30-day login token (`server/auth.js`) |
| Row-level security from the browser | Ownership checks in `server/routes.js` |
| Realtime (SMS) | Polling (3 s in an open chat, 10 s for the unread badge) |
| Storage bucket `sms-media` | Postgres tables `sms_media` / `sms_media_parts` (files stored in 3 MB parts, max 50 MB each) |
| Edge Function + pg_cron worker | The API process drains the queue itself; optional `/api/internal/run-worker` for an external cron, or `npm run worker` |
| `supabase/*.sql` | One file: `neon/schema.sql` |

### Setup
1. Create a Neon project, copy the **pooled** connection string into `DATABASE_URL` (use the pooled one on Vercel).
2. Generate `AUTH_JWT_SECRET` (`node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`).
3. `npm run db:setup` applies `neon/schema.sql` (safe to re-run).
4. Password-reset e-mails use [Resend](https://resend.com): set `RESEND_API_KEY`, `MAIL_FROM` and `SITE_URL`. Without a key the reset link is printed in the server console (development only).
5. In Vercel, add the same variables and remove the old `SUPABASE_*` / `VITE_SUPABASE_*` ones.

### Moving existing Supabase data
Put `SUPABASE_DB_URL` (and, to copy photos/videos/files, `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) in `.env` next to `DATABASE_URL`, then run `npm run db:migrate-from-supabase`. It copies users (with their password hashes, so nobody has to reset a password), chats, friends, requests, blocks, messages, files and usage. It is safe to re-run.

### Notes
* New sign-ups are active immediately (no e-mail confirmation step).
* Login tokens are not revocable before they expire (30 days); rotate `AUTH_JWT_SECRET` to sign everyone out.
* Neon's free plan has a small storage allowance; SMS photos/videos/files are stored in the database, so large files use it quickly.

## Owner usage tracking
Every logged-in user's active time (visible tab, not idle) is recorded per day (`user_usage_daily`); the Owner Dashboard shows it per user per date and refreshes every minute. Timezone: `USAGE_TIMEZONE` env var (default Asia/Kolkata).

## SMS Friend
Enter the email a friend signed up with: they get a request in their SMS Friend window and can Accept, Reject or Block. Chat opens only after Accept. The sidebar badge counts unread messages + pending requests. Photos, videos and files are sent in 3 MB parts (photo max 10 MB, video/file max 50 MB). SMS chats never go to the AI.

## Durable chat queue, idempotency and workers

Chat generation uses a PostgreSQL-backed queue (`chat_tasks` in Neon). Each UI chat request supplies a UUID `requestId`; external API clients should send a stable `Idempotency-Key` header and reuse it when retrying. Reusing a key with a different payload returns HTTP 409.

The API process claims and processes the queued task itself (`CHAT_INLINE_WORKER`, on by default), so no separate worker host is required on Vercel. Tasks left behind by a crashed function are recovered by the lease logic whenever another request or worker runs. Optional extras:

* `npm run worker` — standalone long-running worker (needs `CHAT_WORKER_SECRET`, `CHAT_WORKER_SERVER_URL`).
* `GET/POST /api/internal/run-worker` with header `x-chat-worker-secret: <CHAT_WORKER_SECRET>` (or `Authorization: Bearer <CHAT_WORKER_SECRET>`) — processes one task; point any cron service at it for extra safety.

The queue claims tasks atomically with `FOR UPDATE SKIP LOCKED`, renews leases, and checks a fencing token on completion, so several workers can run at once. Delivery is at-least-once; an AI provider call cannot be made exactly-once if a worker crashes after the provider accepted it but before the result is saved.
