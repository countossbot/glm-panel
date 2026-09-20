# Architecture

## Components

| Component | Process | Port | Source |
|---|---|---|---|
| Admin panel | `next dev` (Bun) | 3000 | `src/`, root configs |
| GLM bridge | `./zai-api --agent-mode` (Go, static binary) | 3001 | `GLM-Free-API/` |
| Token watchdog | `bash scripts/token_watchdog.sh` (loop) | — | `scripts/token_watchdog.sh` |
| Token collector | `./token-collector` (Go + Playwright Chromium) | — | `GLM-Free-API/cmd/token-collector` |
| Dev ingress | Caddy | 81 → 3000 | `Caddyfile` |
| Data | `tokens.sqlite` (WAL), `admin-config.json`, `db/custom.db` (Prisma scaffold) | — | `GLM-Free-API/`, root |

## Request walkthrough — `POST <panel>/v1/chat/completions`

1. **Proxy auth** (`src/app/v1/[...path]/route.ts`): if `admin-config.json → authKey` is set, the caller must present it via `Authorization: Bearer <key>` or `x-api-key: <key>`; anything else → OpenAI-style `401`. Empty `authKey` = open access. Either way the proxy then **overwrites** the credential with the bridge's internal one (`Waguri`) — clients never learn it.
2. **Stream pass-through**: headers filtered to an allowlist, body forwarded verbatim, response streamed untouched (SSE works), `AbortSignal.timeout(600_000)` for long thinking chains, CORS `*`.
3. **Bridge translation** (`internal/zbridge`): picks a pooled Z.AI chat session (async pool of 5, **throwaway** — deleted upstream after each response), signs the payload (HMAC-SHA256 with a rotating salt bucket `timestamp/300000`), posts to `https://chat.z.ai/api/v2/chat/completions`.
4. **Token cost**: 1 captcha device token per attempt (`tokens.sqlite`: `SELECT ... ORDER BY id LIMIT 1` → `DELETE`), up to 5 retries on upstream failures.
5. **Response massaging**: Z.AI's edit-based stream is stabilized with `STREAM_HOLDBACK=24` (holds back a 24-rune tail so mid-stream rewrites can't contradict already-sent text). Agent mode wraps multi-turn/tool flows in an XML-sectioned prompt shim so single-role upstream fakes multi-role + `tool_calls`. Reasoning surfaces as `reasoning_content`.

## Admin API surface (panel, server-side only)

| Route | Verbs | Purpose |
|---|---|---|
| `/api/admin/status` | GET | Everything the Overview tab shows: daemon pid/health, Z.AI session, session pool, token pool count, watchdog state, auth-key state |
| `/api/admin/control` | POST | `start` / `stop` / `restart` the bridge daemon |
| `/api/admin/token` | GET/POST | ZAI_TOKEN (masked) + agent-mode; POST saves config, restarts daemon, instantly re-pulls models |
| `/api/admin/authkey` | GET/POST | Client API key state (GET returns the full key so the owner can configure clients); POST saves — applies on the next request, no restart |
| `/api/admin/watchdog` | GET/POST | Auto-refill daemon status / start-stop |
| `/api/admin/models` | GET | Live `/v1/models` from the bridge |
| `/api/admin/logs` | GET | `server.log` tail |

## Daemon manager (`src/lib/zai-backend.ts`)

- `startBackend()`: `spawn("./zai-api", flags, { cwd, detached: true, stdio: ["ignore", logFd, logFd], env })` + `child.unref()` → the bridge becomes a **session leader independent of the Next.js process tree**. Env is built explicitly: `PORT=3001` (critical — Next runs with `PORT=3000` and the child would inherit it and bind-conflict), `ZAI_TOKEN` from config if present.
- Liveness is **never** trusted from a pidfile alone: `pidIsZaiApi()` checks `kill(pid, 0)` **and** `/proc/<pid>/cmdline` content, so stale pidfiles and PID-reuse can't false-positive. Start waits up to 30 s polling `/health`.
- `stopBackend()`: SIGTERM → 12 s grace → SIGKILL, then pidfile cleanup.

## Watchdog manager (`src/lib/token-watchdog.ts` + `scripts/token_watchdog_ctl.sh`)

The watchdog is a **sibling daemon, not a child of Next.js** — the panel only drives it through `token_watchdog_ctl.sh` (`execFile`). Status is assembled from the same primitives: pidfile + `/proc` cmdline match for the watchdog and any in-flight collector, plus the last lines of `watchdog.log` (the UI shows the newest `REFILL ...` line).

## Model catalog

`/v1/models` is served live by the bridge. Guest sessions expose a subset (e.g. `glm-4.7`, flash variants); a `ZAI_TOKEN` session unlocks the full GLM-5.x family + vision models (modality metadata included). The panel re-pulls it on every daemon start/token save and caches it client-side.
