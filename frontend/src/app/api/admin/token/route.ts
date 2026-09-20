// src/app/api/admin/token/route.ts
// GET  -> current token state (masked) + agent mode
// POST -> save ZAI_TOKEN (or empty = back to guest), restart backend,
//         then instantly pull the fresh model list.

import { NextRequest, NextResponse } from "next/server";
import {
  fetchModels,
  fetchZaiStatus,
  maskedTokenState,
  readConfig,
  restartBackend,
  writeConfig,
} from "@/lib/zai-backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const cfg = readConfig();
  return NextResponse.json(
    { ...maskedTokenState(), agentMode: cfg.agentMode },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  let body: { zaiToken?: unknown; agentMode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const rawToken = typeof body.zaiToken === "string" ? body.zaiToken.trim() : undefined;
  const agentMode = typeof body.agentMode === "boolean" ? body.agentMode : undefined;

  if (rawToken !== undefined && rawToken.length > 0 && rawToken.length < 20) {
    return NextResponse.json(
      { ok: false, error: "that does not look like a ZAI_TOKEN JWT (too short)" },
      { status: 400 }
    );
  }

  const cfg = readConfig();
  const next: typeof cfg = {
    zaiToken: rawToken !== undefined ? rawToken : cfg.zaiToken,
    agentMode: agentMode !== undefined ? agentMode : cfg.agentMode,
    authKey: cfg.authKey,
  };
  writeConfig(next);

  const restart = await restartBackend();
  if (!restart.ok) {
    return NextResponse.json(
      { ok: false, error: `backend restart failed: ${restart.error ?? "unknown"}` },
      { status: 500 }
    );
  }

  // Instantly pull what the new session can see
  const [models, zai] = await Promise.all([fetchModels(), fetchZaiStatus()]);

  return NextResponse.json({
    ok: true,
    pid: restart.pid ?? null,
    ...maskedTokenState(),
    agentMode: next.agentMode,
    models: models.models,
    modelsError: models.error ?? null,
    zai,
  });
}
