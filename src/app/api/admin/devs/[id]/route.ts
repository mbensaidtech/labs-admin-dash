import { NextResponse } from "next/server";
import { handle } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/admin/guard";
import { getDevDetail } from "@/lib/domain/queries";

export const GET = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin(request);
  const { id } = await params;
  return NextResponse.json(await getDevDetail(id), { headers: { "Cache-Control": "no-store" } });
});
