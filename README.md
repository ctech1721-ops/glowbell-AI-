# Global AI — redesigned frontend

This package keeps the existing React/Vite frontend, Express API, Supabase authentication and chat persistence, Groq AI integration, Tavily web search, owner dashboard, report issue flow, file attachments, website creator and notes feature. The visual layer has been redesigned around the supplied black/electric-blue Global AI reference, including the extracted glowing G logo.

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

## Notes

The Notes widget is available from the notes icon in the chat composer. It supports creating notes, switching between saved notes, editing, saving, deleting, and downloading a note as PDF. Notes are stored in the browser's local storage per signed-in user, as in the supplied project; they are not synced across devices through Supabase.

## Deployment

The existing Express app is exported for the supplied Vercel API catch-all at `api/[...path].js`. Configure the environment variables from `.env.example` in the deployment provider. Keep secret keys server-side; only the two `VITE_` Supabase values are exposed to the browser by design. Test authentication, chat, web search, uploads and owner access in the deployed environment before publishing it to users.

## Important

The ZIP does not contain your private `.env` values. Add the same working values from your existing deployment; do not replace them with the example placeholders. The Excel endpoint remains marked Coming Soon in the original backend and has intentionally not been changed.
