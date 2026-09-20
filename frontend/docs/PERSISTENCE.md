# Persistence — how every process here survives

This is the subtle stuff: what dies, what doesn't, and exactly why. The reference
deployment is a sandboxed Linux container where **every command runs in a fresh
shell** and **children of an exiting shell are killed**. Getting long-running
services required deliberate daemonization at three layers.

## The environment model

- PID 1 is `tini -- /start.sh`. On container boot, `/start.sh` runs the project's
  boot hook **`.zscripts/dev.sh`** (convention of this environment).
- Each automation/CLI command (including every shell an admin panel or CI would
  spawn) gets a **throwaway shell**. When that shell exits, the kernel sends
  SIGHUP/SIGTERM down its process group — a naive `./server &` is reaped with it.
- Ingress: Caddy listens on `:81` and reverse-proxies to the panel on `:3000`
  (plus a `?XTransformPort=` escape hatch for side services). The dev domain
  resolves to the container IP (`hostname -I`).

## The daemonization recipe (used everywhere)

```bash
nohup setsid ./zai-api "$@" >> server.log 2>&1 < /dev/null &
DAEMON_PID=$!
echo "$DAEMON_PID" > server.pid
sleep 2
kill -0 "$DAEMON_PID" || echo "LAUNCH FAILED"   # verify BEFORE declaring victory
```

Why each piece matters:

| Piece | Why |
|---|---|
| `setsid` | New session → escapes the shell's process group & controlling terminal, so the group-wide SIGHUP teardown never reaches it. |
| `nohup` | Belt-and-suspenders `SIGHUP` immunity. |
| `>> log 2>&1` | stdout/stderr must not point at the dying shell's tty/pipe (a broken pipe kills writers). |
| `< /dev/null` | Never blocks on a dead stdin. |
| pidfile + `kill -0` check | Proves liveness; scripts are idempotent (start kills a previous instance by pidfile first). |

Orphans are **reparented to PID 1 (tini)** — the sandbox reaps them only when they
exit, it does not hunt them down. That's the loophole persistence hangs on.

## The three daemon classes

### 1. Panel — `bun run dev` (Next.js)

Started by `.zscripts/dev.sh` (boot hook): `bun install` → `bun run db:push` →
`bun run dev &` → wait for `:3000` to answer → `disown`. The panel is the *least*
persistent thing on purpose: Fast Refresh recompiles it constantly. That's fine —
it owns no state beyond `admin-config.json` (on disk) and the daemons it manages
are deliberately **not its children** (next section).

### 2. Bridge — `zai-api` (Go)

Two interchangeable launchers, same pidfile (`GLM-Free-API/server.pid`), so the
panel buttons and the shell scripts interoperate:

- **From the panel** (`src/lib/zai-backend.ts → startBackend()`):
  `child_process.spawn("./zai-api", flags, { detached: true, stdio: ["ignore", logFd, logFd] })`
  + `child.unref()`. The child gets its **own session** (Node's `detached` implies
  `setsid` semantics), file descriptors instead of pipes, and a hand-built env —
  crucially **`PORT=3001`**, because the child would otherwise inherit Next's
  `PORT=3000` and bind-conflict. The manager then polls `/health` for up to 30 s
  before reporting success.
- **From the shell**: `scripts/start_zai_api.sh` (the `nohup setsid` recipe above).

Stop path (`stopBackend()` / `stop_zai_api.sh`): SIGTERM, 12 s grace poll, SIGKILL,
pidfile cleanup.

### 3. Token watchdog — `token_watchdog.sh`

Spawned by `scripts/token_watchdog_ctl.sh` with the same `nohup setsid` recipe,
**as a sibling of the panel, never a child** — an in-Next `setInterval` refiller
would silently vanish on every Fast Refresh / dev-server restart. The watchdog
runs a `while true` loop (check every `CHECK_EVERY=120s`) and traps TERM/INT to
kill any in-flight collector before exiting. The panel controls it exclusively
through the ctl script; status is read from pidfiles + `/proc/<pid>/cmdline` +
`watchdog.log`.

## Liveness truth: pidfile + `/proc` cmdline

`kill -0 <pid>` alone lies twice: a **stale pidfile** (old boot) and **PID reuse**
(an unrelated process now owns the number). Every check therefore also reads
`/proc/<pid>/cmdline` and requires a substring match:

- bridge → cmdline contains `zai-api`
- watchdog → `token_watchdog.sh`
- collector → `token-collector`

All path defaults come from `GLM_PROJECT_ROOT` (see RUNBOOK), so the same
pidfile-lifecycle logic works on any machine.

## Boot sequence (container restart)

```
/start.sh
  └─ .zscripts/dev.sh
       ├─ bun install
       ├─ bun run db:push
       ├─ bun run dev &                    (panel, disowned)
       ├─ wait_for_service :3000           (up to 60 tries)
       ├─ start_mini_services              (none by default)
       └─ start_glm_infra
            ├─ reads GLM-Free-API/admin-config.json  (zaiToken → env, agentMode → flag)
            ├─ bridge already running? (pidfile + kill -0) → skip, else start_zai_api.sh
            └─ watchdog already running? (pgrep) → skip, else token_watchdog_ctl.sh start
```

Everything is **guarded** — re-running dev.sh (or rebooting) never double-starts.

## What survives what

| Event | Panel | Bridge | Watchdog |
|---|---|---|---|
| Tool-call shell exits (fresh shell each command) | n/a | ✅ (setsid) | ✅ (setsid) |
| Panel Fast Refresh / dev recompile | recompiles | ✅ (not a child) | ✅ (sibling) |
| `bun run dev` restart / panel crash | restarts | ✅ (detached) | ✅ |
| Container reboot | ▶ dev.sh | ▶ dev.sh (honors `admin-config.json`) | ▶ dev.sh |

## Gotchas that shaped this design

1. **`PORT` inheritance** — Next exports `PORT=3000` into its children; the panel
   must explicitly force `PORT=3001` when spawning the bridge (this exact bug was
   hit and fixed here).
2. **Inline `setsid` from a shell that exits immediately** is *not* enough in this
   sandbox — the teardown catches the process group before setsid relands it in
   edge cases; the script-based `nohup setsid` pattern (with verification) is the
   reliable form.
3. **Never swap `tokens.sqlite` under a running bridge.** The bridge pins one
   long-lived SQLite handle (`database/sql` lazy connect + `MaxConnLifetime(0)`) —
   replacing the *file* leaves it draining an invisible deleted inode. This is the
   core reason token refills append in place (`--topup`) instead of rebuilding the
   file. See [TOKEN-LIFECYCLE.md](TOKEN-LIFECYCLE.md).
4. **stdio must not outlive the parent** — always redirect daemon output to files.
5. Logs grow: `watchdog.log` (1 MB) and `token-collector-runs.log` (5 MB) self-rotate
   inside the watchdog loop; `server.log` is the bridge's own append log.
