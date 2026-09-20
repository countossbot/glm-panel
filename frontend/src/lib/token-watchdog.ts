// src/lib/token-watchdog.ts
// 服务器-only manager for the captcha token auto-refill watchdog daemon
// (scripts/token_watchdog.sh, controlled by token_watchdog_ctl.sh).
//
// The watchdog keeps tokens.sqlite topped up: every 2 min it counts device
// tokens and, below the threshold, runs `token-collector --topup` which
// APPENDS to the live database — the running zai-api bridge sees new tokens
// immediately (no restart, no wipe, no empty window).

import { execFile, execFileSync } from "child_process";
import fs from "fs";
import path from "path";

import { BACKEND_DIR, PROJECT_ROOT } from "./zai-backend";

export const WATCHDOG_CTL = path.join(PROJECT_ROOT, "scripts", "token_watchdog_ctl.sh");
export const WATCHDOG_PID_FILE = path.join(BACKEND_DIR, "watchdog.pid");
export const WATCHDOG_LOG = path.join(BACKEND_DIR, "watchdog.log");
export const COLLECTOR_PID_FILE = path.join(BACKEND_DIR, "collector.pid");

export interface WatchdogStatus {
  running: boolean;
  pid: number | null;
  collectorRunning: boolean;
  lastLine: string | null;
  lastRefill: string | null;
  logTail: string[];
}

function pidAliveMatching(pid: number | null, fragment: string): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      return cmdline.includes(fragment);
    }
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return command.includes(fragment);
  } catch {
    return false;
  }
}

function readPidFile(file: string): number | null {
  try {
    const pid = parseInt(fs.readFileSync(file, "utf8").trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function readLogTail(file: string, maxLines: number): string[] {
  try {
    const stat = fs.statSync(file);
    const readBytes = Math.min(stat.size, 32 * 1024);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, stat.size - readBytes);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n");
    if (readBytes < stat.size && lines.length > 1) lines.shift(); // drop partial first line
    return lines.filter((l) => l.trim().length > 0).slice(-maxLines);
  } catch {
    return [];
  }
}

/** Current watchdog + collector state (cheap, synchronous fs reads). */
export function getWatchdogStatus(): WatchdogStatus {
  const pid = readPidFile(WATCHDOG_PID_FILE);
  const running = pidAliveMatching(pid, "token_watchdog.sh");
  const collectorPid = readPidFile(COLLECTOR_PID_FILE);
  const collectorRunning = pidAliveMatching(collectorPid, "token-collector");
  const logTail = readLogTail(WATCHDOG_LOG, 8);
  const lastLine = logTail.length > 0 ? logTail[logTail.length - 1] : null;
  const lastRefill =
    [...logTail].reverse().find((l) => l.includes("REFILL")) ?? null;
  return {
    running,
    pid: running ? pid : null,
    collectorRunning,
    lastLine,
    lastRefill,
    logTail,
  };
}

async function ensureCollectorBinary(): Promise<{ ok: boolean; error?: string }> {
  const binary = path.join(BACKEND_DIR, "token-collector");
  if (fs.existsSync(binary)) return { ok: true };
  return new Promise((resolve) => {
    execFile(
      "go",
      ["build", "-o", binary, "./cmd/token-collector"],
      { cwd: BACKEND_DIR, timeout: 120000 },
      (err, stdout, stderr) => {
        if (err || !fs.existsSync(binary)) {
          const detail = String(stderr ?? stdout ?? err?.message ?? "unknown build error").trim();
          resolve({
            ok: false,
            error: "token-collector is missing and automatic Go build failed: " + detail.slice(0, 500),
          });
          return;
        }
        resolve({ ok: true });
      }
    );
  });
}

export interface WatchdogControlResult {
  ok: boolean;
  pid?: number | null;
  error?: string;
}

/** 启动 or stop the watchdog via its ctl script and verify the outcome. */
export async function controlWatchdog(
  action: "start" | "stop"
): Promise<WatchdogControlResult> {
  if (action === "start") {
    const built = await ensureCollectorBinary();
    if (!built.ok) return { ok: false, error: built.error };
  }
  return new Promise((resolve) => {
    execFile(
      "bash",
      [WATCHDOG_CTL, action],
      { timeout: 20000 },
      (err, stdout, stderr) => {
        const out = String(stdout ?? "").trim();
        const status = getWatchdogStatus();
        if (action === "start" && !status.running) {
          resolve({
            ok: false,
            error: String(stderr ?? err?.message ?? out ?? "watchdog did not start").slice(0, 300),
          });
          return;
        }
        if (action === "stop" && status.running) {
          resolve({ ok: false, error: out || "watchdog still running" });
          return;
        }
        resolve({ ok: true, pid: status.pid });
      }
    );
  });
}
