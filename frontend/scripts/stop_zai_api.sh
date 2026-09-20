#!/bin/bash
# Stop the zai-api daemon
ROOT="${GLM_PROJECT_ROOT:-/home/z/my-project}"
PIDFILE="$ROOT/GLM-Free-API/server.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then
    kill "$(cat $PIDFILE)" && echo "zai-api stopped (PID $(cat $PIDFILE))"
else
    echo "zai-api not running"
fi
