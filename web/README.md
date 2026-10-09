# I-observe Web (assistant-ui chat)

A chat front-end for I-observe, built with [assistant-ui](https://github.com/assistant-ui/assistant-ui)
on React/Next.js, talking to the existing FastAPI service.

It is **embedded in the dashboard** (`ui/dashboard.html`) as a floating panel available on
every page, not a destination of its own — the iframe keeps its CSS and runtime fully isolated
from the dashboard's own styles.

The Python service is **not modified** and remains the single system of record. This app only
renders the UI and calls FastAPI **server-side**, so there is no CORS surface and no credential
ever reaches the browser.

```
browser ──▶ Next.js (localhost:3100)
              ├── /api/chat          agent loop (OpenRouter + tools)
              └── fetch ──────────▶ FastAPI (localhost:8000)   /query, /api/events, /api/status
```

## Run

```powershell
# 1. the Python service (already running if the dashboard works)
cd E:\I-observe
.\.venv\Scripts\python.exe -m uvicorn query_api:app --host 127.0.0.1 --port 8000

# 2. this app
cd E:\I-observe\web
npm install          # first time only
npm run dev          # http://localhost:3100
# or: npm run build && npm start
```

Open <http://localhost:3100>.

> Use `localhost`, not `127.0.0.1`. Next.js treats them as different origins and blocks its own
> dev resources (HMR) otherwise, which silently leaves the page running stale code.
> `allowedDevOrigins` in `next.config.ts` covers both.

## Configuration

All secrets live in **`E:\I-observe\.env`** (gitignored) — deliberately only one copy on the
machine. `lib/env.ts` reads that file server-side; a real environment variable wins over it.

| Variable | Needed for | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | the agent | Without it the chat still works: it answers straight from `/query` and says so. |
| `API_TOKEN` | reading the timeline | See below. |
| `VLM_MODEL` | the agent model | Defaults to `google/gemini-3.6-flash`. |
| `OBSERVE_API_URL` | pointing elsewhere | Defaults to `http://127.0.0.1:8000`. |

### Why `API_TOKEN` is required

`query_api._check_auth` requires a **login** for `/query` and `/api/events` as soon as one user
account exists (a fresh install with no users stays open). Once you registered a user in the
dashboard, every server-to-server call started returning `401 Login required`.

`API_TOKEN` is the backend's documented non-interactive alternative to a user session: the app
sends it as `Authorization: Bearer <token>`. Generate one with:

```powershell
.\.venv\Scripts\python.exe -c "import secrets;print(secrets.token_urlsafe(32))"
```

then add `API_TOKEN=<value>` to `.env` **and restart the Python service** (config is read at
import). This is a full-access credential: keep `.env` out of version control and rotate it if
it leaks.

## What the agent can do

Tools are defined in `app/api/chat/route.ts` and are thin wrappers over the FastAPI endpoints:

| Tool | Endpoint | Example question |
|---|---|---|
| `query_timeline` | `POST /query` | "when did you last see MENNA?" |
| `list_events` | `GET /api/events` | "show me MENNA's last 5 events" |
| `system_status` | `GET /api/status` | "is the system healthy?" |

Tool results are **compacted** in `lib/observe.ts` before they reach the model — the raw
`/query` payload can carry hundreds of evidence rows, and every one would be billed as input
tokens and dilute the answer.

The agent is capped at 5 steps (`stepCountIs(5)`) and runs at `temperature: 0`.

## Two notes for the next person

1. **Selectors must be stable references.** Passing an inline arrow to `AuiIf`/`useAuiState`
   (`condition={(s) => ...}` written inside a component) re-subscribes the store on every render
   and React aborts with *"Maximum update depth exceeded"*. Hoist selectors to module scope —
   see `isEmptyThread` in `app/page.tsx`.

2. **`thread.isEmpty` is not "no messages".** On a fresh `useChatRuntime` thread it is `false`
   even with zero messages (verified with a store probe), so the welcome screen keys off
   `thread.messages.length === 0`.
