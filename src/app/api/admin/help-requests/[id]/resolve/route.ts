import { NextResponse } from "next/server";
import { ApiError, handle, readJson } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/admin/guard";
import { MAX_BODY_BYTES, resolveSchema } from "@/lib/api/schemas";
import { resolveHelpRequest, toHelpDto } from "@/lib/domain/help";

export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin(request);
  const { id } = await params;
  const parsed = resolveSchema.safeParse(await readJson(request, MAX_BODY_BYTES));
  if (!parsed.success) {
    throw new ApiError("validation", "adminNote must be at most 500 characters", { field: "adminNote" });
  }
  return NextResponse.json(toHelpDto(await resolveHelpRequest(id, parsed.data.adminNote)));
});
