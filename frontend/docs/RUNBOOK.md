# Runbook — operating the stack

## First-run checklist

1. **Build** (from `GLM-Free-API/`):
   ```bash
   CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o zai-api .
   CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o token-collector ./cmd/token-collector
   ```
2. **Seed the pool** (no bridge running yet): `./token-collector --no-tui --tokens 100 --batch 1 --parallel 1`
   → creates `tokens.sqlite` (the bridge **refuses to boot** without it).
2b. **Captcha signing secret**: `cp aliyun.env.example GLM-Free-API/aliyun.env`
   (without it every chat fails with `captcha generation returned empty payload`
   and burns tokens — see [TOKEN-LIFECYCLE](TOKEN-LIFECYCLE.md#the-captcha-signing-secret)).
3. **Configure** `GLM-Free-API/admin-config.json` (or start guest and use the panel):
   `cp admin-config.example.json GLM-Free-API/admin-config.json`
4. **Panel**: `bun install && bun run db:push && bun run dev` → `:3000`.
5. **Daemons**: on boot-hook machines automatic; otherwise
   `bash scripts/start_zai_api.sh --agent-mode` + `bash scripts/token_watchdog_ctl.sh start`.

## Daily ops

| Task | Command / UI |
|---|---|
| Everything at a glance | `bash scripts/status_zai_api.sh` · `bash scripts/token_watchdog_ctl.sh status` |
| Bridge start / stop / restart | scripts above, or the panel **Overview** buttons |
| Set ZAI_TOKEN / agent mode | panel → **ZAI Token** tab → save (restarts daemon, re-pulls models) |
| Set / clear client API key | panel → **ZAI Token** tab → *Client auth key* card (instant, no restart) |
| Manual token top-up | `cd GLM-Free-API && ./token-collector --topup --no-tui --tokens 50 --batch 1 --parallel 1` |
| Watchdog on / off | `token_watchdog_ctl.sh start|stop` or the Overview card toggle |
| Client smoke test | see the copy-paste `curl` in the panel Overview (matches current auth mode) |

## Environment variables

| Var | Applies to | Default | Notes |
|---|---|---|---|
| `GLM_PROJECT_ROOT` | panel + scripts | `/home/z/my-project` | Root containing `GLM-Free-API/` and `scripts/` |
| `GLM_BRIDGE_URL` | panel | `http://localhost:3001` | Bridge base URL |
| `PORT` / `HOST` | bridge | `3001` / `0.0.0.0` | Panel **forces** `PORT=3001` when spawning (Next would leak `PORT=3000`) |
| `ZAI_TOKEN` | bridge | — | Logged-in session; panel injects it from `admin-config.json` |
| `AUTH_TOKEN` | bridge | `Waguri` | Internal credential (the proxy always presents it) |
| `AGENT_MODE` | bridge | off | `1`/`true`/`modern`/`legacy` (flag `--agent-mode` = modern) |
| `STREAM_HOLDBACK` | bridge | `24` | Tail runes held back to absorb Z.AI stream rewrites |
| `SESSION_POOL_SIZE` | bridge | `5` | Pre-made throwaway chat sessions |
| `SYNC_MODE` | bridge | off | Legacy synchronous session flow |
| `TARGET` / `REFILL_BELOW` / `CHECK_EVERY` | watchdog | `150` / `100` / `120` | Pool top-up policy |
| `ALIYUN_CAPTCHA_SECRET` | bridge | placeholder | Aliyun captcha HMAC secret — required; loaded from `GLM-Free-API/aliyun.env` by both spawn paths |
| `DATABASE_URL` | panel (Prisma) | `file:.../db/custom.db` | Scaffold DB; `bun run db:push` applies schema |

## Ports

| Port | Service |
|---|---|
| 3000 | Admin panel (+ `/v1` proxy — the client base URL) |
| 3001 | Go bridge (internal; also reachable directly for its `/health`, `/status`) |
| 81 | Caddy ingress → 3000 (reference deployment) |

## Files on disk

| File | Role |
|---|---|
| `GLM-Free-API/admin-config.json` | zaiToken · agentMode · authKey (panel-managed; gitignored) |
| `GLM-Free-API/tokens.sqlite` (+ `-wal`/`-shm`) | Device token pool (gitignored — live credentials) |
| `GLM-Free-API/server.log` | Bridge log (panel Logs tab tails this) |
| `GLM-Free-API/watchdog.log` | Watchdog events (self-rotates ~1 MB) |
| `GLM-Free-API/token-collector-runs.log` | Collector output (self-rotates ~5 MB) |
| `GLM-Free-API/{server,watchdog,collector}.pid` | Liveness anchors (content verified against `/proc/<pid>/cmdline`) |
| `dev.log` | Panel/dev.sh boot log |

## Troubleshooting

| Symptom | Cause → Fix |
|---|---|
| Bridge exits immediately at start | No `tokens.sqlite` → seed with the collector (checklist step 2); details in `server.log`. |
| `bind: address already in use` on 3001 | Another bridge instance (stale pidfile) or `PORT` inheritance → `bash scripts/stop_zai_api.sh`, then start again. |
| Panel shows "bridge offline" | Daemon down → Overview → Start; if it flaps, read `server.log` via the Logs tab. |
| `502 bridge_proxy_error` from `/v1` | Proxy up, bridge down → start the bridge. |
| `401 invalid_api_key` | A client key is configured and the request's key doesn't match → send `Authorization: Bearer <key>` / `x-api-key: <key>`, or clear the key in the panel. |
| `No device tokens available` in `server.log` | Pool empty → check the watchdog (`token_watchdog_ctl.sh status`) and let it refill, or top up manually (`--topup`!). |
| Model list looks short (no vision) | Guest session → paste a `ZAI_TOKEN` in the ZAI Token tab. |
| Collector fails to launch browser | Playwright Chromium missing → install once (`playwright install chromium` or let the collector's best-effort install run). |
| Pool counter ≠ what the bridge sees | You ran the collector **without** `--topup` against a live bridge (inode swap) → restart the bridge once to re-open the new file; from now on always use `--topup`. |
| `captcha generation returned empty payload` + pool draining fast | Missing/wrong `ALIYUN_CAPTCHA_SECRET` (see `aliyun.env`) — each mint silently burns 5 tokens. Fix env → restart → watchdog refills. Details: [TOKEN-LIFECYCLE](TOKEN-LIFECYCLE.md#the-captcha-signing-secret). |
| SQLite "database is locked" | Rare (both sides use WAL + 10 s busy timeout) → transient; if persistent, pause the watchdog and retry. |
