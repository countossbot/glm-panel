# syntax=docker/dockerfile:1.7
FROM --platform=$BUILDPLATFORM golang:1.27-bookworm AS go-builder
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY frontend/GLM-Free-API/go.mod frontend/GLM-Free-API/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download
COPY frontend/GLM-Free-API/ ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/zai-api . \
    && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/token-collector ./cmd/token-collector

FROM node:22-bookworm AS web-builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund
COPY frontend/ ./
RUN NEXT_TELEMETRY_DISABLED=1 npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GLM_PROJECT_ROOT=/app/frontend \
    GLM_BRIDGE_URL=http://127.0.0.1:3001 \
    CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium curl python3 ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=web-builder /app/.next/standalone ./frontend/.next/standalone
COPY --from=web-builder /app/.next/static ./frontend/.next/standalone/.next/static
COPY --from=web-builder /app/public ./frontend/.next/standalone/public
COPY frontend/scripts ./frontend/scripts
RUN mkdir -p ./frontend/GLM-Free-API
COPY --from=go-builder /out/zai-api ./frontend/GLM-Free-API/zai-api
COPY --from=go-builder /out/token-collector ./frontend/GLM-Free-API/token-collector
COPY docker/entrypoint.sh /entrypoint.sh

RUN mkdir -p /app/runtime \
    && rm -f frontend/GLM-Free-API/tokens.sqlite frontend/GLM-Free-API/admin-config.json \
       frontend/GLM-Free-API/server.log frontend/GLM-Free-API/watchdog.log \
       frontend/GLM-Free-API/token-collector-runs.log \
       frontend/GLM-Free-API/server.pid frontend/GLM-Free-API/watchdog.pid \
       frontend/GLM-Free-API/collector.pid \
    && ln -s /app/runtime/tokens.sqlite frontend/GLM-Free-API/tokens.sqlite \
    && ln -s /app/runtime/admin-config.json frontend/GLM-Free-API/admin-config.json \
    && ln -s /app/runtime/server.log frontend/GLM-Free-API/server.log \
    && ln -s /app/runtime/watchdog.log frontend/GLM-Free-API/watchdog.log \
    && ln -s /app/runtime/token-collector-runs.log frontend/GLM-Free-API/token-collector-runs.log \
    && ln -s /app/runtime/server.pid frontend/GLM-Free-API/server.pid \
    && ln -s /app/runtime/watchdog.pid frontend/GLM-Free-API/watchdog.pid \
    && ln -s /app/runtime/collector.pid frontend/GLM-Free-API/collector.pid \
    && chmod +x /entrypoint.sh frontend/GLM-Free-API/zai-api frontend/GLM-Free-API/token-collector \
    && printf '%s\n' '{"zaiToken":"","agentMode":true,"authKey":""}' > /app/runtime/admin-config.json

VOLUME ["/app/runtime"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/ >/dev/null && curl -fsS http://127.0.0.1:3001/health >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
