// src/app/api/admin/logs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readLogTail } from "@/lib/zai-backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const linesParam = parseInt(req.nextUrl.searchParams.get("lines") ?? "120", 10);
  const lines = Number.isFinite(linesParam)
    ? Math.min(Math.max(linesParam, 10), 1000)
    : 120;
  return NextResponse.json(
    { lines: readLogTail(lines) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
