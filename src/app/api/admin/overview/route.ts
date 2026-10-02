import { NextResponse } from "next/server";
import { handle } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/admin/guard";
import { requestScope } from "@/lib/admin/scope";
import { getOverview } from "@/lib/domain/queries";

export const GET = handle(async (request: Request) => {
  await requireAdmin(request);
  return NextResponse.json(await getOverview(await requestScope(request)), { headers: { "Cache-Control": "no-store" } });
});
