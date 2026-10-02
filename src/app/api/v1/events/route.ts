import { NextResponse } from "next/server";
import { ApiError, handle, readJson } from "@/lib/api/errors";
import { authenticateDev } from "@/lib/api/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/api/rateLimit";
import { eventBatchSchema, MAX_BATCH_BYTES } from "@/lib/api/schemas";
import { getCollections } from "@/lib/db/client";
import { applyEventBatch } from "@/lib/domain/projection";

/** Business Rule 6: a validated, idempotent, all-or-nothing batch of events. */
export const POST = handle(async (request: Request) => {
  const body = await readJson(request, MAX_BATCH_BYTES);
  const parsed = eventBatchSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const index = issue.path[0] === "events" && typeof issue.path[1] === "number" ? issue.path[1] : undefined;
    throw new ApiError("validation", issue.message, {
      ...(index !== undefined ? { index } : {}),
      field: issue.path.join("."),
      reason: issue.message,
    });
  }

  const { dev, token } = await authenticateDev(request, parsed.data.userId);
  checkRateLimit(`events:${token}`, RATE_LIMITS.eventsPerToken);

  const now = new Date();
  const result = await applyEventBatch(dev, parsed.data.events, now);

  // Every accepted request refreshes the username, lastSeenAt and un-archives (Business Rules 3, 16).
  const { devs } = await getCollections();
  await devs.updateOne({ _id: dev._id }, { $set: { username: parsed.data.username, lastSeenAt: now, archivedAt: null } });

  return NextResponse.json({ ...result, serverTime: now.toISOString() }, { status: 202 });
});
