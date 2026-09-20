// src/app/api/admin/control/route.ts
// POST { action: "start" | "stop" | "restart" }

import { NextRequest, NextResponse } from "next/server";
import {
  fetchModels,
  getRunningPid,
  startBackend,
  stopBackend,
} from "@/lib/zai-backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const action = body.action;

  if (action === "start") {
    const res = await startBackend();
    const models = res.ok ? await fetchModels() : null;
    return NextResponse.json({ ...res, models: models?.models ?? [] });
  }

  if (action === "stop") {
    const res = await stopBackend();
    return NextResponse.json(res);
  }

  if (action === "restart") {
    const wasRunning = getRunningPid() !== null;
    const res = await stopBackend();
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
    }
    const started = await startBackend();
    const models = started.ok ? await fetchModels() : null;
    return NextResponse.json({
      ...started,
      wasRunning,
      models: models?.models ?? [],
    });
  }

  return NextResponse.json(
    { ok: false, error: "action must be one of: start, stop, restart" },
    { status: 400 }
  );
}
