import { NextResponse } from "next/server";
import { handle } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/admin/guard";
import { getMatrix } from "@/lib/domain/queries";

export const GET = handle(async (request: Request) => {
  await requireAdmin(request);
  return NextResponse.json(await getMatrix(), { headers: { "Cache-Control": "no-store" } });
});
