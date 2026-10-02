import { NextResponse } from "next/server";
import { ApiError, handle, readJson } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/admin/guard";
import { createWorkshopSchema, MAX_BODY_BYTES } from "@/lib/api/schemas";
import { createWorkshop, listWorkshops } from "@/lib/domain/workshops";

export const GET = handle(async (request: Request) => {
  await requireAdmin(request);
  return NextResponse.json(await listWorkshops(), { headers: { "Cache-Control": "no-store" } });
});

export const POST = handle(async (request: Request) => {
  await requireAdmin(request);
  const parsed = createWorkshopSchema.safeParse(await readJson(request, MAX_BODY_BYTES));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError("validation", issue.message, { field: issue.path.join(".") || "name", reason: issue.message });
  }
  return NextResponse.json(await createWorkshop(parsed.data.name), { status: 201 });
});
