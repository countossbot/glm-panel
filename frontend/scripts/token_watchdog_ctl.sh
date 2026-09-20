#!/bin/bash
# token_watchdog_ctl.sh — manage the captcha token auto-refill watchdog.
# Usage: token_watchdog_ctl.sh {start|stop|restart|status}
#
# Same daemonization pattern as start_zai_api.sh (nohup setsid, pidfile,
# liveness verified after launch) — survives the sandbox's per-tool-call
# shell teardown.

ROOT="${GLM_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BASE="$ROOT/GLM-Free-API"
WD="$ROOT/scripts/token_watchdog.sh"
PID_FILE=$BASE/watchdog.pid
COLLECTOR_PID_FILE=$BASE/collector.pid
LOG=$BASE/watchdog.log

alive() { # $1=pid $2=cmdline fragment
  [ -n "${1:-}" ] || return 1
  kill -0 "$1" 2>/dev/null || return 1
  if [ "$(uname -s)" = "Linux" ]; then
    tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null | grep -q "$2"
  else
    ps -p "$1" -o command= 2>/dev/null | grep -q "$2"
  fi
}

wd_pid() {
  [ -f "$PID_FILE" ] || return 1
  local p
  p=$(cat "$PID_FILE" 2>/dev/null)
  alive "$p" token_watchdog && { echo "$p"; return 0; }
  return 1
}

do_start() {
  if P=$(wd_pid); then
    echo "ALREADY RUNNING PID=$P"
    return 0
  fi
  rm -f "$PID_FILE"
  nohup bash "$WD" >> "$LOG" 2>&1 < /dev/null &
  sleep 2
  if P=$(wd_pid); then
    echo "STARTED PID=$P (target=150 refill_below=100 every=120s — env-overridable)"
    return 0
  fi
  echo "START FAILED — last log lines:"
  tail -5 "$LOG" 2>/dev/null
  return 1
}

do_stop() {
  if P=$(wd_pid); then
    # also stop an in-flight collector run if present
    if [ -f "$COLLECTOR_PID_FILE" ]; then
      CP=$(cat "$COLLECTOR_PID_FILE" 2>/dev/null)
      alive "$CP" token-collector && kill "$CP" 2>/dev/null
    fi
    kill "$P" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 0.5
      alive "$P" token_watchdog || break
    done
    alive "$P" token_watchdog && kill -9 "$P" 2>/dev/null
    rm -f "$PID_FILE" "$COLLECTOR_PID_FILE"
    echo "STOPPED (was PID $P)"
  else
    rm -f "$PID_FILE" "$COLLECTOR_PID_FILE"
    echo "NOT RUNNING"
  fi
}

do_status() {
  if P=$(wd_pid); then
    echo "WATCHDOG: RUNNING PID=$P"
  else
    echo "WATCHDOG: STOPPED"
  fi
  if [ -f "$COLLECTOR_PID_FILE" ]; then
    CP=$(cat "$COLLECTOR_PID_FILE" 2>/dev/null)
    if alive "$CP" token-collector; then
      echo "COLLECTOR: RUNNING PID=$CP (refill in progress)"
    fi
  fi
  echo "POOL: $(python3 - "$BASE/tokens.sqlite" <<'PY' 2>/dev/null
import sqlite3, sys
try:
    con = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
    print(con.execute("SELECT COUNT(*) FROM tokens").fetchone()[0])
except Exception:
    print("?")
PY
) tokens left"
  echo "--- last log lines ---"
  tail -n 6 "$LOG" 2>/dev/null
}

case "${1:-status}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; sleep 1; do_start ;;
  status)  do_status ;;
  *) echo "usage: $0 {start|stop|restart|status}"; exit 2 ;;
esac
