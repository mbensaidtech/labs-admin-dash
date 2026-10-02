import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/env";
import { pingDb } from "@/lib/db/client";

export async function GET() {
  const db = await pingDb();
  return NextResponse.json(
    { status: db ? "ok" : "degraded", version: APP_VERSION, db: db ? "ok" : "unreachable" },
    { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
