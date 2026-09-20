#!/bin/bash
# Show live status of the zai-api daemon
ROOT="${GLM_PROJECT_ROOT:-/home/z/my-project}"
PIDFILE="$ROOT/GLM-Free-API/server.pid"
echo "=== Process ==="
if [ -f "$PIDFILE" ] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then
    echo "RUNNING (PID $(cat $PIDFILE))"
else
    echo "NOT RUNNING"
fi
echo "=== Health ==="
curl -s -m 4 http://localhost:3001/health -w "  HTTP:%{http_code}\n" || echo "no response"
echo "=== Recent log ==="
tail -8 "$ROOT/GLM-Free-API/server.log" 2>/dev/null
