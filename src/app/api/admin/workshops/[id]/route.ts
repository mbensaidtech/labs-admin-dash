import { NextResponse } from "next/server";
import { ApiError, handle, readJson } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/admin/guard";
import { MAX_BODY_BYTES, updateWorkshopSchema } from "@/lib/api/schemas";
import { deleteWorkshop, updateWorkshop } from "@/lib/domain/workshops";

type Params = { params: Promise<{ id: string }> };

/** Rename and / or close / reopen. */
export const PATCH = handle(async (request: Request, { params }: Params) => {
  await requireAdmin(request);
  const { id } = await params;
  const parsed = updateWorkshopSchema.safeParse(await readJson(request, MAX_BODY_BYTES));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError("validation", issue.message, { field: issue.path.join(".") || "name", reason: issue.message });
  }
  return NextResponse.json(await updateWorkshop(id, parsed.data));
});

/** Business Rule 5: 409 while the workshop has developers. */
export const DELETE = handle(async (request: Request, { params }: Params) => {
  await requireAdmin(request);
  const { id } = await params;
  await deleteWorkshop(id);
  return new NextResponse(null, { status: 204 });
});
