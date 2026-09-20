// src/lib/zai-backend.ts
// 服务器-only manager for the GLM-Free-API bridge daemon (Go binary on :3001).
// Handles lifecycle (start/stop/restart), token persistence, models and logs.

import { spawn, execFile, execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Root of the deployed project (contains GLM-Free-API/, scripts/, etc.).
 * Override with GLM_PROJECT_ROOT when running elsewhere — defaults to the
 * reference instance layout.
 */
export const PROJECT_ROOT = process.env.GLM_PROJECT_ROOT ?? process.cwd();
export const BACKEND_DIR = path.join(PROJECT_ROOT, "GLM-Free-API");
export const BACKEND_URL = process.env.GLM_BRIDGE_URL ?? "http://localhost:3001";
export const AUTH_TOKEN = "Waguri";
export const PID_FILE = path.join(BACKEND_DIR, "server.pid");
export const LOG_FILE = path.join(BACKEND_DIR, "server.log");
export const CONFIG_FILE = path.join(BACKEND_DIR, "admin-config.json");
export const BINARY = path.join(BACKEND_DIR, "zai-api");

/**
 * Credential the BRIDGE itself expects (its auth is always on and defaults to
 * "Waguri"). This is an internal detail: the panel's /v1 proxy injects it when
 * forwarding, so clients never need it. Client-facing auth is enforced at the
 * proxy layer from AdminConfig.authKey (empty = open access).
 */
export const BRIDGE_AUTH_TOKEN = AUTH_TOKEN;

export interface AdminConfig {
  zaiToken: string;
  agentMode: boolean;
  /** API key clients must present at /v1 (Bearer or x-api-key). Empty = open. */
  authKey: string;
}

export function readConfig(): AdminConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      zaiToken: typeof parsed.zaiToken === "string" ? parsed.zaiToken : "",
      agentMode: parsed.agentMode !== false,
      authKey: typeof parsed.authKey === "string" ? parsed.authKey : "",
    };
  } catch {
    return { zaiToken: "", agentMode: true, authKey: "" };
  }
}

export function writeConfig(cfg: AdminConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

function pidFromFile(): number | null {
  try {
    const raw = fs.readFileSync(PID_FILE, "utf8").trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function pidIsZaiApi(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      return cmdline.includes("zai-api");
    }
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return command.includes("zai-api");
  } catch {
    return false;
  }
}

function findZaiApiPid(): number | null {
  try {
    const output = execFileSync(
      "lsof",
      ["-nP", "-iTCP:3001", "-sTCP:LISTEN", "-t"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    for (const rawPid of output.split(/\s+/)) {
      const pid = Number.parseInt(rawPid.trim(), 10);
      if (pid > 0 && pidIsZaiApi(pid)) return pid;
    }
  } catch {
    // lsof may be unavailable; health probing still reports the bridge.
  }
  return null;
}

export function getRunningPid(): number | null {
  const pid = pidFromFile();
  if (pid && pidIsZaiApi(pid)) return pid;

  const discoveredPid = findZaiApiPid();
  if (discoveredPid) {
    try {
      fs.writeFileSync(PID_FILE, String(discoveredPid), "utf8");
    } catch {
      // The PID is still usable even if the pid file cannot be written.
    }
    return discoveredPid;
  }

  return null;
}

export interface HealthInfo {
  healthy: boolean;
  reachable: boolean;
  body?: Record<string, unknown>;
}

export async function checkHealth(timeoutMs = 2500): Promise<HealthInfo> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    let body: Record<string, unknown> | undefined;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    return { healthy: res.ok, reachable: true, body };
  } catch {
    return { healthy: false, reachable: false };
  }
}

export interface ZaiSessionStatus {
  connected?: boolean;
  feVersion?: string;
  userName?: string;
  userId?: string;
  mode?: string;
  features?: Record<string, unknown>;
  sessionPool?: Record<string, unknown>;
  [k: string]: unknown;
}

export async function fetchZaiStatus(): Promise<ZaiSessionStatus | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/status`, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as ZaiSessionStatus;
  } catch {
    return null;
  }
}

export interface ModelInfo {
  id: string;
  display_name?: string;
  description?: string;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  [k: string]: unknown;
}

export async function fetchModels(): Promise<{
  ok: boolean;
  models: ModelInfo[];
  error?: string;
}> {
  try {
    const res = await fetch(`${BACKEND_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, models: [], error: `backend /v1/models HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, models: (data.data ?? []) as ModelInfo[] };
  } catch (e) {
    return { ok: false, models: [], error: e instanceof Error ? e.message : String(e) };
  }
}

function backendFlags(cfg: AdminConfig): string[] {
  const flags: string[] = [];
  if (cfg.agentMode) flags.push("--agent-mode");
  return flags;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface StartResult {
  ok: boolean;
  pid?: number;
  alreadyRunning?: boolean;
  error?: string;
}

async function ensureBackendBinary(): Promise<{ ok: boolean; error?: string }> {
  if (fs.existsSync(BINARY)) return { ok: true };
  return new Promise((resolve) => {
    execFile(
      "go",
      ["build", "-o", BINARY, "."],
      { cwd: BACKEND_DIR, timeout: 120000 },
      (err, stdout, stderr) => {
        if (err || !fs.existsSync(BINARY)) {
          const detail = String(stderr ?? stdout ?? err?.message ?? "unknown build error").trim();
          resolve({
            ok: false,
            error: "backend binary is missing and automatic Go build failed: " + detail.slice(0, 500),
          });
          return;
        }
        resolve({ ok: true });
      }
    );
  });
}

export async function startBackend(): Promise<StartResult> {
  if (getRunningPid()) {
    return { ok: true, alreadyRunning: true, pid: getRunningPid() ?? undefined };
  }
  const binary = await ensureBackendBinary();
  if (!binary.ok) {
    return { ok: false, error: binary.error };
  }
  const cfg = readConfig();
  const out = fs.openSync(LOG_FILE, "a");
  const err = fs.openSync(LOG_FILE, "a");
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  // The bridge must own :3001 — never inherit Next.js' PORT (3000).
  env.PORT = "3001";
  env.HOST = "0.0.0.0";
  if (cfg.zaiToken) env.ZAI_TOKEN = cfg.zaiToken;
  else delete env.ZAI_TOKEN;

  // Runtime secrets from GLM-Free-API/aliyun.env (gitignored), e.g.
  // ALIYUN_CAPTCHA_SECRET — required by the captcha signing path.
  try {
    const envFile = fs.readFileSync(path.join(BACKEND_DIR, "aliyun.env"), "utf8");
    for (const line of envFile.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith("#")) env[m[1]] = m[2];
    }
  } catch {
    /* aliyun.env optional */
  }

  fs.appendFileSync(LOG_FILE, `\n[admin-panel] spawning zai-api ${backendFlags(cfg).join(" ")} (token: ${cfg.zaiToken ? "set" : "guest"})\n`);

  const child = spawn("./zai-api", backendFlags(cfg), {
    cwd: BACKEND_DIR,
    detached: true,
    stdio: ["ignore", out, err],
    env,
  });
  child.unref();
  fs.closeSync(out);
  fs.closeSync(err);
  fs.writeFileSync(PID_FILE, String(child.pid), "utf8");

  // Wait for /health to turn 200 (session init is async upstream)
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const h = await checkHealth(1500);
    if (h.healthy) return { ok: true, pid: child.pid };
    if (!pidIsZaiApi(child.pid)) {
      return { ok: false, pid: child.pid, error: "process exited during startup — check logs" };
    }
  }
  return { ok: false, pid: child.pid, error: "backend did not become healthy within 30s" };
}

export interface StopResult {
  ok: boolean;
  error?: string;
}

export async function stopBackend(): Promise<StopResult> {
  const pid = getRunningPid();
  if (!pid) {
    // stale pid file cleanup
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    return { ok: true };
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return { ok: true };
  }
  // Wait generously before SIGKILL: the bridge's graceful shutdown drains
  // in-flight streaming responses (STREAM_DRAIN_TIMEOUT, default 180s) so a
  // panel restart during an active chat does NOT truncate the stream.
  // This wait MUST be longer than the bridge's drain deadline — a shorter
  // kill timeout lands the SIGKILL mid-drain and cuts the stream anyway
  // (observed as a 2-minute stream truncated at exactly the 120s mark).
  // 400 x 500ms = 200s > 180s drain. srv.Shutdown returns the moment the
  // last handler finishes — with no live streams this loop exits on the
  // first check.
  for (let i = 0; i < 400; i++) {
    await sleep(500);
    if (!pidIsZaiApi(pid)) {
      try {
        fs.unlinkSync(PID_FILE);
      } catch {
        /* ignore */
      }
      return { ok: true };
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* ignore */
  }
  await sleep(500);
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
  return pidIsZaiApi(pid) ? { ok: false, error: "process survived SIGKILL" } : { ok: true };
}

export interface RestartResult {
  ok: boolean;
  pid?: number;
  error?: string;
}

export async function restartBackend(): Promise<RestartResult> {
  await stopBackend();
  const started = await startBackend();
  return started.ok ? { ok: true, pid: started.pid } : { ok: false, error: started.error };
}

export function readLogTail(maxLines = 120): string[] {
  try {
    const stat = fs.statSync(LOG_FILE);
    const readBytes = Math.min(stat.size, 256 * 1024);
    const fd = fs.openSync(LOG_FILE, "r");
    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, stat.size - readBytes);
    fs.closeSync(fd);
    const text = buf.toString("utf8");
    const lines = text.split("\n");
    if (readBytes < stat.size && lines.length > 1) lines.shift(); // drop partial first line
    return lines.filter((l) => l.trim().length > 0).slice(-maxLines);
  } catch {
    return [];
  }
}

export function maskedTokenState(): {
  mode: "guest" | "token";
  masked: string | null;
  length: number;
} {
  const cfg = readConfig();
  if (!cfg.zaiToken) return { mode: "guest", masked: null, length: 0 };
  const t = cfg.zaiToken;
  const masked =
    t.length > 18 ? `${t.slice(0, 10)}…${t.slice(-6)} (${t.length} chars)` : `${t.slice(0, 3)}… (${t.length} chars)`;
  return { mode: "token", masked, length: t.length };
}

export interface AuthKeyState {
  mode: "open" | "key";
  /** Full key — the panel owner needs it to configure client apps. */
  key: string | null;
  masked: string | null;
}

/** Client-facing /v1 auth state (enforced at the proxy layer). */
export function authKeyState(): AuthKeyState {
  const key = readConfig().authKey.trim();
  if (!key) return { mode: "open", key: null, masked: null };
  const masked =
    key.length > 10
      ? `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} chars)`
      : `${key.slice(0, 2)}… (${key.length} chars)`;
  return { mode: "key", key, masked };
}

/**
 * Extract the credential a client presented at /v1 (Bearer header first,
 * then x-api-key — matching the bridge's own semantics).
 */
export function providedClientKey(reqHeaders: Headers): string {
  const authz = reqHeaders.get("authorization") ?? "";
  if (/^bearer\s+/i.test(authz)) return authz.replace(/^bearer\s+/i, "").trim();
  return (reqHeaders.get("x-api-key") ?? "").trim();
}

const COUNT_TOKENS_PY = [
  "import sqlite3,sys",
  "try:",
  `    con = sqlite3.connect("file:${path.join(BACKEND_DIR, "tokens.sqlite")}?mode=ro", uri=True)`,
  '    print(con.execute("SELECT COUNT(*) FROM tokens").fetchone()[0])',
  "    con.close()",
  "except Exception:",
  "    print(-1)",
].join("\n");

/** Remaining captcha device tokens (each chat request consumes one). */
export function countTokens(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("python3", ["-c", COUNT_TOKENS_PY], { timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(null);
      const n = parseInt(String(stdout).trim(), 10);
      resolve(Number.isFinite(n) && n >= 0 ? n : null);
    });
  });
}
