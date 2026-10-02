import { NextResponse } from "next/server";
import { handle } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/admin/guard";
import { rotateWorkshopCode } from "@/lib/domain/workshops";

/** Business Rule 3: a new code; the old one stops working for registrations at once. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin(request);
  const { id } = await params;
  return NextResponse.json(await rotateWorkshopCode(id));
});
