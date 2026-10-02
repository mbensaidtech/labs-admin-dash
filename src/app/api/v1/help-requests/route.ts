import { NextResponse } from "next/server";
import { ApiError, handle, readJson } from "@/lib/api/errors";
import { authenticateDev } from "@/lib/api/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/api/rateLimit";
import { helpRequestSchema, MAX_BODY_BYTES } from "@/lib/api/schemas";
import { getCollections } from "@/lib/db/client";
import { createHelpRequest } from "@/lib/domain/help";

export const POST = handle(async (request: Request) => {
  const parsed = helpRequestSchema.safeParse(await readJson(request, MAX_BODY_BYTES));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError("validation", issue.message, { field: issue.path.join("."), reason: issue.message });
  }
  const { dev, token } = await authenticateDev(request, parsed.data.userId);
  checkRateLimit(`events:${token}`, RATE_LIMITS.eventsPerToken);

  const { devs } = await getCollections();
  await devs.updateOne({ _id: dev._id }, { $set: { username: parsed.data.username } });
  const created = await createHelpRequest(dev._id, { labId: parsed.data.labId, message: parsed.data.message });
  return NextResponse.json({ id: created._id, status: created.status, createdAt: created.createdAt.toISOString() }, { status: 201 });
});
