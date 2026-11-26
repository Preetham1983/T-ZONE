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
