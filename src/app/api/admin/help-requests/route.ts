import { NextResponse } from "next/server";
import { ApiError, handle } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/admin/guard";
import { requestScope } from "@/lib/admin/scope";
import { HELP_STATUSES, type HelpStatus } from "@/lib/db/types";
import { listHelpRequests } from "@/lib/domain/queries";

export const GET = handle(async (request: Request) => {
  await requireAdmin(request);
  const raw = new URL(request.url).searchParams.get("status") ?? "open,acknowledged";
  const statuses = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const invalid = statuses.find((value) => !HELP_STATUSES.includes(value as HelpStatus));
  if (invalid || statuses.length === 0) {
    throw new ApiError("validation", `Unknown status '${invalid ?? ""}'`, { field: "status" });
  }
  return NextResponse.json(await listHelpRequests(statuses as HelpStatus[], { scope: await requestScope(request) }), { headers: { "Cache-Control": "no-store" } });
});
