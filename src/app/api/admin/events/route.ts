import { NextResponse } from "next/server";
import { handle } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/admin/guard";
import { requestScope } from "@/lib/admin/scope";
import { listEvents } from "@/lib/domain/queries";

export const GET = handle(async (request: Request) => {
  await requireAdmin(request);
  const params = new URL(request.url).searchParams;
  const page = await listEvents({
    devId: params.get("devId") ?? undefined,
    type: params.get("type") ?? undefined,
    cursor: params.get("cursor"),
    scope: await requestScope(request),
  });
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
});
