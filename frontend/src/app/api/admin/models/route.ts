// src/app/api/admin/models/route.ts
import { NextResponse } from "next/server";
import { fetchModels, getRunningPid } from "@/lib/zai-backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!getRunningPid()) {
    return NextResponse.json(
      { ok: false, models: [], error: "backend not running" },
      { status: 503 }
    );
  }
  const result = await fetchModels();
  return NextResponse.json(result, {
    status: result.ok ? 200 : 502,
    headers: { "Cache-Control": "no-store" },
  });
}
