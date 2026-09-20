// src/app/api/admin/status/route.ts
import { NextResponse } from "next/server";
import {
  authKeyState,
  checkHealth,
  countTokens,
  fetchZaiStatus,
  getRunningPid,
  maskedTokenState,
  readConfig,
} from "@/lib/zai-backend";
import { getWatchdogStatus } from "@/lib/token-watchdog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const pid = getRunningPid();
  const health = await checkHealth();
  const zai = health.reachable ? await fetchZaiStatus() : null;
  const config = readConfig();
  const token = maskedTokenState();
  const tokenPool = pid !== null ? await countTokens() : null;

  return NextResponse.json(
    {
      process: {
        running: pid !== null,
        pid,
      },
      health: {
        reachable: health.reachable,
        healthy: health.healthy,
        body: health.body ?? null,
      },
      zai,
      config: {
        agentMode: config.agentMode,
      },
      token,
      tokenPool,
      watchdog: getWatchdogStatus(),
      auth: authKeyState(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
