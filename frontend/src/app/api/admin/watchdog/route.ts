// src/app/api/admin/watchdog/route.ts
// Manage the captcha token auto-refill watchdog daemon.
//   GET  — current watchdog/collector status
//   POST { action: "start" | "stop" } — enable / disable auto-refill

import { NextResponse } from "next/server";
import { controlWatchdog, getWatchdogStatus } from "@/lib/token-watchdog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getWatchdogStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  let action = "";
  try {
    const body = await req.json();
    action = String(body?.action ?? "");
  } catch {
    /* invalid body handled below */
  }
  if (action !== "start" && action !== "stop") {
    return NextResponse.json(
      { ok: false, error: `invalid action: ${action || "(none)"}` },
      { status: 400 }
    );
  }
  const result = await controlWatchdog(action);
  return NextResponse.json(
    { ...result, status: getWatchdogStatus() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
