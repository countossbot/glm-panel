// src/app/api/admin/authkey/route.ts
// Client-facing /v1 API key management (enforced at the panel's /v1 proxy).
//   GET  -> { mode: "open" | "key", key, masked } — key is included so the
//           owner can copy it into client apps.
//   POST { authKey: string } -> save. Empty string = open access (any/no key).
//           Applies on the next request — no backend restart needed.

import { NextRequest, NextResponse } from "next/server";
import { authKeyState, readConfig, writeConfig } from "@/lib/zai-backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(authKeyState(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  let body: { authKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.authKey !== "string") {
    return NextResponse.json(
      { ok: false, error: "authKey must be a string (empty string = open access)" },
      { status: 400 }
    );
  }

  const authKey = body.authKey.trim();
  if (authKey.length > 128) {
    return NextResponse.json(
      { ok: false, error: "authKey too long (max 128 chars)" },
      { status: 400 }
    );
  }

  const cfg = readConfig();
  writeConfig({ ...cfg, authKey });

  return NextResponse.json(
    {
      ok: true,
      mode: authKey ? "key" : "open",
      ...authKeyState(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
