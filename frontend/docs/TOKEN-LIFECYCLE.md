# Token lifecycle — the captcha device-token pool

Every chat request through the bridge costs one **device token**. This doc covers
what those are, how they're burned, and how the pool refills itself — including
the subtle database trap that required patching the upstream collector.

## What a device token is

chat.z.ai protects its web API with **Aliyun Captcha (v3)**. The bridge defeats
this by harvesting valid device tokens with a **headless Chromium** (Playwright)
that emulates a real desktop Chrome: matched engine/UA version, human-like cursor
drift, eased mouse paths, typing cadence — then reads the token endpoint. One
harvested token ≈ one captcha pass.

Harvester: `GLM-Free-API/cmd/token-collector` (interactive TUI or scripted flags):

```bash
./token-collector --topup --no-tui --tokens 80 --batch 1 --parallel 1
#   --tokens N    collect N tokens (per batch)
#   --batch B     number of batches
#   --parallel P  worker pages on one browser
#   --topup       append to tokens.sqlite instead of WIPING it (local patch!)
#   --headed      visible browser for debugging
```

A scripted top-up of ~80 tokens takes **~20 seconds**. First run needs Playwright's
Chromium (`~/.cache/ms-playwright`); the collector installs it best-effort.

## Storage & burn model

- Store: `GLM-Free-API/tokens.sqlite` (WAL mode) — table `tokens(id, token, batch)`.
- Per request: `SELECT token FROM tokens ORDER BY id LIMIT 1` → use it →
  `DELETE FROM tokens WHERE token = ?`. **Tokens are consumed even on failed
  attempts** (up to 5 retries per request — a bad upstream patch can burn several).
- Both session modes (guest and `ZAI_TOKEN`) consume pool tokens.

## The wipe trap (upstream behavior)

The **stock collector deletes the database on every run**:

```go
dbPath := filepath.Join(".", "tokens.sqlite")
_ = os.Remove(dbPath)
_ = os.Remove(dbPath + "-wal")
_ = os.Remove(dbPath + "-shm")
```

Running it against a **live bridge** causes two failures:

1. All unconsumed tokens are thrown away (rebuild-from-zero semantics).
2. Worse: the bridge opened SQLite **once** (`database/sql` lazy connect +
   `SetConnMaxLifetime(0)`) and holds that handle forever. Replacing the *file*
   swaps the inode — the bridge keeps draining the deleted invisible inode while
   every counter that reads the *path* reports the new file. The bridge then dies
   with "No device tokens available" while the panel shows a full pool.

## The `--topup` patch (local modification)

`cmd/token-collector/main.go` gained a `--topup` flag:

- skips the `os.Remove` block (WAL/SHM sidecars stay too);
- creates a **unique index** on `tokens(token)` and inserts with
  `INSERT OR IGNORE` → re-harvested duplicates are dropped;
- appends into the *same live file* the bridge reads — SQLite WAL + a 10 s
  `busy_timeout` on both sides make the tiny concurrent writes safe.

Result: refills are **additive, zero-downtime, restart-free**. The bridge sees new
tokens on its next `SELECT` — verified live: a chat request succeeded mid-refill
and the pool count dropped by exactly 1 while the collector was still inserting.

> Rule of thumb: **never** run the collector *without* `--topup` while a bridge is
> up. (Fresh-machine seeding with no bridge running is the one safe wipe case.)

## The auto-refill watchdog

`scripts/token_watchdog.sh` (managed by `token_watchdog_ctl.sh`, toggleable in the
panel):

- every `CHECK_EVERY=120s`: count tokens via a **read-only** SQLite URI query
  (python3, `mode=ro` — never disturbs the writers);
- `pool < REFILL_BELOW(100)` → run
  `token-collector --topup --no-tui --tokens $((TARGET(150) - pool))`
  synchronously (`wait`), log `REFILL pool A -> B (+N tokens)`;
- on failure: back off one extra cycle and retry (collector exit code + post-count
  are both checked — a `rc=0` that added nothing counts as a failure);
- heartbeats every ~30 min; `watchdog.log` self-rotates at 1 MB (collector output
  goes to its own `token-collector-runs.log`, rotated at 5 MB);
- `trap TERM INT` kills an in-flight collector and removes pidfiles on stop.

All thresholds are env-overridable (`TARGET`, `REFILL_BELOW`, `CHECK_EVERY`).

## Monitoring

- Panel → Overview: pool count (green > 20, amber > 5, red below), watchdog state
  (`armed` / `refilling…` / `off`), last `REFILL` line.
- CLI: `bash scripts/token_watchdog_ctl.sh status` (watchdog + collector + pool +
  log tail in one shot).
- Manual top-up any time: run the collector command above from `GLM-Free-API/`.

## The captcha signing secret

Minting a `CaptchaVerifyParam` calls two Aliyun "captcha-open" endpoints
(`InitCaptchaV3` → `VerifyCaptchaV3`). Their behavior:

- the **AccessKey ID is ignored** (upstream ships a `[REDACTED:...]` placeholder
  and everything still works);
- the **HMAC-SHA1 signature IS validated** against the secret — and that secret
  is a constant embedded in chat.z.ai's frontend JS (the report in upstream's
  `.assets` documents the extraction). It is a protocol constant, not a
  per-account credential.

Therefore the secret lives at **runtime**, not in source:

```
GLM-Free-API/aliyun.env          # gitignored
ALIYUN_CAPTCHA_SECRET=<captcha-signing-constant>
```

Both spawn paths load it: `scripts/start_zai_api.sh` sources it with
`set -a` (⚠️ plain `. ./aliyun.env` sets an unexported shell var — the daemon
would silently inherit nothing and every captcha mint would fail), and the
panel's daemon manager parses the file into the child env explicitly.

**Failure mode to recognize:** with a wrong/missing secret, `InitCaptchaV3`
still returns HTTP 400 with a JSON body — the bridge treats it as an empty
`certifyID` and *silently* burns **5 device tokens per mint attempt**
(`maxTokenRetries`), repeatedly, until the pool is drained. Symptoms: chat
returns `captcha generation returned empty payload`, pool counter plummets,
no ERROR lines unless the daemon runs with `--verbose`. Fix the env, restart,
let the watchdog refill.
