import { NextResponse } from "next/server";
import { handle } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/admin/guard";
import { acknowledgeHelpRequest, toHelpDto } from "@/lib/domain/help";

export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin(request);
  const { id } = await params;
  return NextResponse.json(toHelpDto(await acknowledgeHelpRequest(id)));
});
