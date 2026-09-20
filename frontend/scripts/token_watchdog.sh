#!/bin/bash
# token_watchdog.sh — auto-refill loop for the GLM-Free-API captcha token pool.
#
# Every CHECK_EVERY seconds it counts device tokens in tokens.sqlite. When the
# pool drops below REFILL_BELOW it runs ./token-collector --topup to append
# (TARGET - pool) fresh tokens. --topup is ESSENTIAL: without it the collector
# WIPES tokens.sqlite and rebuilds it, which (a) throws away remaining tokens
# and (b) breaks the running zai-api server, which holds a long-lived handle
# to the database file. With --topup, inserts land in the same live file the
# server reads, so new tokens are visible immediately — no restart, no empty
# window.
#
# Config (env overrides):
#   TARGET       pool size to top up to            (default 150)
#   REFILL_BELOW trigger a refill below this count (default 100)
#   CHECK_EVERY  seconds between pool checks       (default 120)

ROOT="${GLM_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BASE="$ROOT/GLM-Free-API"
LOG="$BASE/watchdog.log"
COLLECTOR_LOG="$BASE/token-collector-runs.log"
PID_FILE="$BASE/watchdog.pid"
COLLECTOR_PID_FILE="$BASE/collector.pid"

TARGET="${TARGET:-150}"
REFILL_BELOW="${REFILL_BELOW:-100}"
CHECK_EVERY="${CHECK_EVERY:-120}"

cd "$BASE" || exit 1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

rotate_if_big() { # $1=file $2=max_bytes $3=keep_lines
  local f="$1" max="$2" keep="$3" size
  size=$(stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "$size" -gt "$max" ]; then
    tail -n "$keep" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
}

count_tokens() {
  python3 - "$BASE/tokens.sqlite" <<'PY' 2>/dev/null
import sqlite3, sys
try:
    con = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
    print(con.execute("SELECT COUNT(*) FROM tokens").fetchone()[0])
    con.close()
except Exception:
    print(-1)
PY
}

COLLECTOR_PID=""
cleanup() {
  if [ -n "$COLLECTOR_PID" ]; then
    kill "$COLLECTOR_PID" 2>/dev/null
    log "killed in-flight collector (pid $COLLECTOR_PID)"
  fi
  rm -f "$PID_FILE" "$COLLECTOR_PID_FILE"
  log "STOP signal received — watchdog exiting"
  exit 0
}
trap cleanup TERM INT

echo $$ > "$PID_FILE"
log "START watchdog pid=$$ target=$TARGET refill_below=$REFILL_BELOW check_every=${CHECK_EVERY}s"

checks=0
while true; do
  checks=$((checks + 1))
  rotate_if_big "$LOG" 1048576 2000
  rotate_if_big "$COLLECTOR_LOG" 5242880 2000

  pool=$(count_tokens)

  if [ "$pool" -lt 0 ]; then
    log "WARN could not read tokens.sqlite (rc=$pool) — retrying next cycle"
    sleep "$CHECK_EVERY"
    continue
  fi

  if [ "$pool" -lt "$REFILL_BELOW" ]; then
    need=$((TARGET - pool))
    [ "$need" -gt 1500 ] && need=1500   # collector per-run hard cap
    log "pool=$pool below threshold $REFILL_BELOW -> topping up +$need device tokens (--topup, no wipe)"
    GOMEMLIMIT="${COLLECTOR_GOMEMLIMIT:-512MiB}" \
      ./token-collector --topup --no-tui --tokens "$need" --batch 1 --parallel 1 \
      >> "$COLLECTOR_LOG" 2>&1 &
    COLLECTOR_PID=$!
    echo "$COLLECTOR_PID" > "$COLLECTOR_PID_FILE"
    wait "$COLLECTOR_PID"
    rc=$?
    COLLECTOR_PID=""
    rm -f "$COLLECTOR_PID_FILE"
    after=$(count_tokens)
    added=$((after - pool))
    if [ "$rc" -eq 0 ] && [ "$after" -gt "$pool" ]; then
      log "REFILL pool $pool -> $after (+$added tokens, collector rc=0)"
    else
      log "REFILL FAILED pool=$pool after=$after (+$added) rc=$rc — backing off, retry next cycle"
      sleep "$CHECK_EVERY"
    fi
  else
    # heartbeat every 15 checks (~30 min) to prove the loop is alive
    if [ $((checks % 15)) -eq 1 ]; then
      log "pool=$pool ok (target=$TARGET, threshold=$REFILL_BELOW)"
    fi
  fi

  sleep "$CHECK_EVERY"
done
