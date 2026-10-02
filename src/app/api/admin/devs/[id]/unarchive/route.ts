import { NextResponse } from "next/server";
import { handle } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/admin/guard";
import { setArchived } from "@/lib/domain/queries";

export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin(request);
  const { id } = await params;
  await setArchived(id, false);
  return NextResponse.json({ id, archived: false });
});
