import { NextResponse } from "next/server";
import { ApiError, handle, readJson } from "@/lib/api/errors";
import { authenticateDev } from "@/lib/api/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/api/rateLimit";
import { identitySchema, MAX_BODY_BYTES } from "@/lib/api/schemas";
import { getCollections } from "@/lib/db/client";
import { cancelHelpRequest } from "@/lib/domain/help";

export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const parsed = identitySchema.safeParse(await readJson(request, MAX_BODY_BYTES));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError("validation", issue.message, { field: issue.path.join("."), reason: issue.message });
  }
  const { dev, token } = await authenticateDev(request, parsed.data.userId);
  checkRateLimit(`events:${token}`, RATE_LIMITS.eventsPerToken);

  const { devs } = await getCollections();
  await devs.updateOne({ _id: dev._id }, { $set: { username: parsed.data.username, lastSeenAt: new Date() } });
  const cancelled = await cancelHelpRequest(dev._id, id);
  return NextResponse.json({ id: cancelled._id, status: cancelled.status });
});
