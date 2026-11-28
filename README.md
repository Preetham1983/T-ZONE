# T-ZONE — Microsoft Teams & M365 AI Agent

End-to-end Microsoft Teams & Microsoft 365 agent powered by the bundled `msgraph` skill (`skills/msgraph`), SQLite FTS5 indexing, WebVTT transcript extraction, configurable **EPAM DIAL** and **GitHub Copilot** LLM providers, and a **React + TypeScript** frontend running cleanly in **Docker**.

## Architecture

- **`apps/api`** — Node.js 24 + TypeScript + Fastify + native `node:sqlite` (WAL + FTS5)
  - **`skills/msgraph`** — Bundled `msgraph` skill (`SKILL.md`, `scripts/msgraph.js`) sharing `.ms_graph_token_cache.json`
  - **PKCE Browser Auth Bridge** — Binds `0.0.0.0:8484` inside Docker (`127.0.0.1:8484:8484`) so host browser sign-in preserves macOS Intune / Enterprise SSO device claims, with a **Paste Callback URL** fallback
  - **Batch Transcript Vault** — Extracts WebVTT transcripts + Copilot AI Insights across date ranges, parses speaker timelines, computes speaker share %, and indexes every segment into SQLite FTS5
  - **Hot-Swappable LLM Providers** — Switch live in UI Settings between **Profile B (EPAM DIAL / Azure OpenAI)** and **Profile A (GitHub Copilot / GitHub Models)**
  - **Human-in-the-Loop Guardrails** — External sends (Teams chats, DMs, channel posts, emails, calendar invites) pause for 1-click approval or inline JSON edits by default
- **`apps/web`** — React 19 + TypeScript + Vite + Tailwind CSS + TanStack Query + Zustand (served via Nginx with SSE proxy buffering disabled)
- **`apps/desktop`** — Electron macOS Menu Bar app (`[T] TZ`) for 24/7 background operation with native Node 24 API runner, auto-recovery, and macOS `LaunchAgent` support
- **`packages/shared`** — Shared TypeScript interfaces & Zod schemas

## Quick Start with Docker

1. Copy `.env.example` to `.env` and set your DIAL or GitHub Copilot credentials (`.env` is gitignored).
2. Spin up the full stack:
   ```bash
   docker compose up --build -d
   ```
3. Open **http://localhost:3100** in your browser.
4. Go to **Microsoft Sign-In** in the sidebar and click **Sign in with Microsoft** (opens Entra ID PKCE popup in your host browser and caches the token in the persistent `tzone_data` Docker volume).
5. Open **LLM & Skill Settings** to switch between EPAM DIAL and GitHub Copilot, edit keys/models live, or run **Test Connection**.

## macOS Desktop App (Electron 24/7 Menu Bar)

T-ZONE includes an Electron desktop & menu bar app (`apps/desktop`) that keeps T-ZONE running 24/7 whenever your Mac is on — **without requiring Docker** for daily M365, Teams, Email, Calendar, To Do, Planner, Transcript, and Agent Chat workflows.

### How It Works
- **Native Mode (No Docker required):** On startup, Electron checks `http://127.0.0.1:8088/api/health`. If no API is running, it automatically spawns `apps/api/dist/index.js` using your Mac's Node 24 (`node:sqlite`) and serves `apps/web/dist` locally.
- **Docker Bridge Mode:** If `tzone-api` is already running in Docker on `:8088`, Electron connects to it automatically (Docker is only required for the **Teams Guest Browser Bot**'s Linux PulseAudio virtual mic & Piper neural TTS).
- **Menu Bar Tray (`[T] TZ`):** Closing the window hides it to the top-right macOS Menu Bar instead of quitting. A 15-second health check automatically restarts the local backend if it ever stops.
- **Updating Code:** After pulling or editing code, click **`[T] TZ` → `Rebuild Code & Reload`** in the menu bar to rebuild and restart in place.

### Build & Run Manually
```bash
npm install
npm run build:desktop
npm run start:desktop
```

### Enable 24/7 Auto-Start on Mac Boot (`LaunchAgent`)
Install the macOS LaunchAgent (`~/Library/LaunchAgents/com.tzone.desktop.plist`) so T-ZONE launches hidden in the menu bar on every login and stays alive automatically:
```bash
/Users/bandi_preethamreddy/T-ZONE/apps/desktop/install-launchagent.sh
```

Useful LaunchAgent commands:
```bash
# Check status
launchctl list | grep tzone

# View desktop logs
tail -f ~/Library/Logs/T-ZONE/desktop.err.log

# Stop and remove auto-start
launchctl unload ~/Library/LaunchAgents/com.tzone.desktop.plist && rm ~/Library/LaunchAgents/com.tzone.desktop.plist
```

### Desktop Environment Variables (Optional)
| Variable | Default | Description |
|---|---|---|
| `TZONE_API_PORT` | `8088` | Port for the native API / Docker API check |
| `TZONE_WEB_PORT` | `3100` | Local HTTP port for serving `apps/web/dist` (falls back to an ephemeral port if `3100` is in use) |
| `MSGRAPH_CALLBACK_PORT` | `8484` | OAuth PKCE redirect listener port |
| `TZONE_NODE_BIN` | Auto-detected (`v24+`) | Path to Node.js binary used to run `apps/api/dist/index.js` |
| `DATA_DIR` | `./data` | SQLite (`tzone.db`) storage directory in native mode |

## Local Development

```bash
npm install
npm run dev:api
npm run dev:web
```

## Verification

```bash
npm run typecheck
npm run build
npm run test
```
