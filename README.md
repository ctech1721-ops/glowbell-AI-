# Global AI — redesigned frontend

This package keeps the existing React/Vite frontend, Express API, Supabase authentication and chat persistence, multi-provider AI integration (Groq, Gemini and optional Cloudflare Workers AI), Tavily web search, owner dashboard, report issue flow, file attachments, website creator and notes feature. The visual layer has been redesigned around the supplied black/electric-blue Global AI reference, including the extracted glowing G logo.

## Run locally

Requirements: Node.js 20.19+ or 22.12+ and npm.

1. Open this folder in VS Code.
2. Install dependencies:

   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your existing provider/Supabase values. Never commit or share `.env`.
4. Start frontend and backend:

   ```bash
   npm run dev
   ```
5. Open http://localhost:5173.

The Vite development server proxies `/api` to the Express server on port 3001. For a production build, run `npm run build`; for the standalone Express server, run `npm start`.


## API-only AI provider fallback

The backend supports API-key-only inference; it does not require a local knowledge dataset. Provider order is Groq, then Gemini, then Cloudflare Workers AI when configured. Configure `GROQ_API_KEY`, `GEMINI_API_KEY`, and (optionally) `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` in the server environment. `GEMINI_MODEL` defaults to `gemini-3.1-flash-lite`; confirm that this model is available to your Google AI Studio project and on its free tier before deployment. Cloudflare's default model is `@cf/zai-org/glm-4.7-flash`, which Cloudflare lists among models available on its Workers Free plan. The router does not silently switch to paid providers. Cloudflare is skipped for image requests; Gemini handles image fallback.

Chat requests send only a bounded recent history (up to 6 messages / 5,000 characters), and the default chat output cap is 2,048 tokens. Set `CHAT_MAX_OUTPUT_TOKENS` between 512 and 4,096 if you need to tune response length. Spreadsheet and website-generation tasks keep their larger task-specific output caps and use the same provider fallback.

Free-tier quotas are controlled by each provider and can change. Cloudflare Workers AI currently lists a 10,000-Neuron daily free allocation; this is not 10,000 chat requests and the amount consumed depends on the model and workload. If all configured providers reach their limits, Global AI returns a clear temporary-unavailable message; it cannot guarantee unlimited or 5,000 simultaneous AI generations on free plans. Gemini free-tier requests may be used by Google to improve its products under Google's current free-tier terms, so do not send sensitive user information unless the applicable data terms are acceptable.

Copy `.env.example` to `.env` for local development and fill in your real values. For Vercel/production, add the same variables in the project's server-side Environment Variables. Never expose any AI provider key or token in frontend code or a `VITE_` variable.

## Notes

The Notes widget is available from the notes icon in the chat composer. It supports creating notes, switching between saved notes, editing, saving, deleting, and downloading a note as PDF. Notes are stored in the browser's local storage per signed-in user, as in the supplied project; they are not synced across devices through Supabase.

## Deployment

The existing Express app is exported for the supplied Vercel API catch-all at `api/[...path].js`. Configure the environment variables from `.env.example` in the deployment provider. Keep secret keys server-side; only the two `VITE_` Supabase values are exposed to the browser by design. Test authentication, chat, web search, uploads and owner access in the deployed environment before publishing it to users.

## Important

The ZIP does not contain your private `.env` values. Add the same working values from your existing deployment; do not replace them with the example placeholders. The Excel endpoint remains marked Coming Soon in the original backend and has intentionally not been changed.

## UI update
Start-circle intro with solid-blue animated G, dark welcome guide, daily date + calendar (header chip, welcome card, day dividers), flat chat messages, responsive phone/tablet/desktop layout, and ChatGPT-style features: stop generating, typing effect, edit & resend, voice input, read aloud, like/dislike, chat search/rename/pin, temporary chat, export to Markdown, drag-drop/paste files, slash commands, personalisation (response style + custom instructions), keyboard shortcuts (Ctrl K / B / ,).

## SMS Friend (one-time Supabase setup)
Open Supabase → SQL Editor → paste all of `supabase/sms_setup.sql` → Run. Then reload the app.
Then run `supabase/sms_run_this_once.sql` the same way (friend requests + block + file sending).
To add someone, enter the email they signed up with: they get a request in their SMS Friend window and can Accept, Reject or Block. Chat opens only after Accept. The sidebar badge counts unread messages + pending requests; each friend shows their own unread count. Photos/videos go to a private `sms-media` bucket (max 10 MB photo / 50 MB video). SMS chats never go to the AI.

## Owner usage tracking
Run `supabase/usage_setup.sql` once in the Supabase SQL Editor. Every logged-in user's active time (visible tab, not idle) is recorded per day; the Owner Dashboard shows it per user per date and refreshes every minute. Timezone: `USAGE_TIMEZONE` env var (default Asia/Kolkata).

## Durable chat queue, idempotency and workers (new)

The chat generation path now uses a Supabase/PostgreSQL-backed queue. The React UI and `/api/chat` response shape remain unchanged for normal completed requests. Each UI chat request supplies a UUID `requestId`; external API clients should send a stable `Idempotency-Key` header and reuse that same key when retrying the same logical request. Reusing a key with a different payload returns HTTP 409.

### One-time Supabase setup

1. Open Supabase Dashboard → SQL Editor.
2. Run the complete file `supabase/chat_queue_setup.sql`.
3. Confirm the `public.chat_tasks` table and RPC functions were created successfully.

The table is service-role-only under RLS. Never place `SUPABASE_SERVICE_ROLE_KEY` or `CHAT_WORKER_SECRET` in frontend variables.

### Environment variables

Copy the queue variables from `.env.example` into the backend environment. Set `CHAT_WORKER_SECRET` to a long random secret (for example, generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`). `CHAT_WORKER_SERVER_URL` must point to the Express API reachable by the worker. For a separate production worker host, use the public HTTPS API base URL.

### Run locally

Use two terminals after installing dependencies and configuring `.env`:

```bash
npm run server
```

```bash
npm run worker
```

The worker generates a unique process ID, claims tasks atomically, renews leases, validates the fencing token when completing/failing, and periodically recovers expired leases. Run multiple worker processes/instances to increase queue concurrency; PostgreSQL `FOR UPDATE SKIP LOCKED` prevents them from claiming the same pending task.

### Production deployment notes

Deploy the Express API and at least one continuously running Node worker separately. A serverless API deployment alone does not run the worker; configure a persistent worker service/container with the same server-side environment variables. Ensure its outbound network can reach the Express API and Supabase. Monitor `chat_tasks` for pending/failed tasks and tune worker count, lease duration, and provider quotas based on load tests. This queue provides durable at-least-once execution; external AI provider calls cannot be made exactly-once if a worker crashes after the provider accepted a request but before the result is committed.
