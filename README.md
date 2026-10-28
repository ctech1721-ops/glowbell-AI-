# Glowbell Search

A beginner-friendly Google-inspired search app built with React, Vite, Express, and the Brave Search API.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- A Brave Search API key for real web results

## Run it locally

1. Install Node.js from https://nodejs.org/ if you don't already have it.
2. Unzip this project and open the `glowbell-search` folder in VS Code.
3. Open a terminal in that folder and run:

   ```bash
   npm install
   ```

4. Copy `.env.example` to a new file named `.env`.
5. Open `.env` and replace `replace_with_your_key` with your Brave Search API key.
6. Start the app:

   ```bash
   npm run dev
   ```

7. Open http://localhost:5173 in your browser.

The frontend runs on port 5173 and the backend on port 3001. Vite forwards `/api` requests to the backend during development.

## Get a search API key

1. Visit https://api-dashboard.search.brave.com/
2. Create/sign in to an account and review/activate an available plan.
3. Create an API key.
4. Put it in `.env` as `BRAVE_SEARCH_API_KEY=your_key_here`.

Brave Search API usage may be paid. Check current plan and pricing before using it. Keep the key private: do not put it in frontend code, commit `.env`, or share it in screenshots.

## Build and run production locally

```bash
npm run build
npm start
```

Open http://localhost:3001. The Express server serves the built frontend and the search API.

## Project structure

```text
glowbell-search/
├── server/
│   └── index.js       # API endpoint; keeps the key on the server
├── src/
│   ├── App.jsx        # Search UI and result list
│   ├── main.jsx       # React entry point
│   └── styles.css     # Responsive visual design
├── .env.example      # Example environment variables
├── index.html
├── package.json
└── vite.config.js
```

## Troubleshooting

- **"Real web search is not configured yet"**: create `.env`, add your key, and restart `npm run dev`.
- **Port in use**: close the other app using port 3001 or set another `PORT` in `.env`; update `vite.config.js` if you change the development server port.
- **401/403**: verify the API key and plan in your Brave dashboard.
- **429**: wait and retry; check provider limits and usage.


## Glowbell AI chat and web search

Copy `.env.example` to `.env`, then add your own `TAVILY_API_KEY` and `OPENROUTER_API_KEY` values in `.env`. Never share `.env` or commit it to Git. Restart `npm run dev` after editing environment variables. The app has separate **AI Chat** and **Web Search** modes.
