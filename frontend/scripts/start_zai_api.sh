#!/bin/bash
# Daemonize zai-api: double-fork style detach so it survives tool-call teardown
ROOT="${GLM_PROJECT_ROOT:-/home/z/my-project}"
cd "$ROOT/GLM-Free-API" || exit 1

# Runtime secrets (gitignored): Aliyun captcha HMAC secret etc.
# `set -a` exports everything sourced — children inherit them.
[ -f aliyun.env ] && set -a && . ./aliyun.env && set +a

# Kill any previous instance by PID file
[ -f server.pid ] && kill "$(cat server.pid)" 2>/dev/null

nohup setsid ./zai-api "$@" >> server.log 2>&1 < /dev/null &
DAEMON_PID=$!
echo "$DAEMON_PID" > server.pid
# Verify it's alive after a short moment
sleep 2
if kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "LAUNCHED PID=$DAEMON_PID"
else
    echo "LAUNCH FAILED — last log lines:"
    tail -5 server.log
fi
