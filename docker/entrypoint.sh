#!/bin/bash
set -Eeuo pipefail
ROOT="/app/frontend"
BACKEND="$ROOT/GLM-Free-API"
RUNTIME="/app/runtime"
mkdir -p "$RUNTIME"
if [[ ! -f "$RUNTIME/admin-config.json" ]]; then
  printf '%s\n' '{"zaiToken":"","agentMode":true,"authKey":""}' > "$RUNTIME/admin-config.json"
fi
cleanup() {
  trap - TERM INT EXIT
  [[ -n "${WATCHDOG_PID:-}" ]] && kill "$WATCHDOG_PID" 2>/dev/null || true
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${NEXT_PID:-}" ]] && kill "$NEXT_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup TERM INT EXIT
cd "$BACKEND"
export PORT=3001 HOST=0.0.0.0
./zai-api > "$RUNTIME/server.log" 2>&1 &
BACKEND_PID=$!
for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then break; fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "zai-api exited during startup; see $RUNTIME/server.log" >&2
    exit 1
  fi
  sleep 0.5
done
if ! curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
  echo "zai-api did not become healthy within 30 seconds" >&2
  exit 1
fi
cd "$ROOT"
export GLM_PROJECT_ROOT="$ROOT"
bash "$ROOT/scripts/token_watchdog.sh" &
WATCHDOG_PID=$!
cd "$ROOT/.next/standalone"
node server.js &
NEXT_PID=$!
wait -n "$BACKEND_PID" "$WATCHDOG_PID" "$NEXT_PID"
status=$?
echo "A required service exited (status=$status)" >&2
exit "$status"
