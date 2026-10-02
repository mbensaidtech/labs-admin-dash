import { NextResponse } from "next/server";
import { handle } from "@/lib/api/errors";
import { authenticateDev } from "@/lib/api/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/api/rateLimit";
import { getCollections } from "@/lib/db/client";
import { findActiveHelpRequest, findLastHelpRequest } from "@/lib/domain/help";
import type { HelpRequestDoc } from "@/lib/db/types";

function helpView(request: HelpRequestDoc) {
  return {
    id: request._id,
    status: request.status,
    labId: request.labId ?? null,
    createdAt: request.createdAt.toISOString(),
    acknowledgedAt: request.acknowledgedAt?.toISOString() ?? null,
    closedAt: request.closedAt?.toISOString() ?? null,
    closedBy: request.closedBy ?? null,
    ...(request.adminNote ? { adminNote: request.adminNote } : {}),
  };
}

/**
 * Sync-back for the local dashboard (Business Rule 10): the active help request and, so that a resolution
 * note can still be shown once the request is closed, the most recent request whatever its status.
 */
export const GET = handle(async (request: Request) => {
  const { dev, token } = await authenticateDev(request);
  checkRateLimit(`events:${token}`, RATE_LIMITS.eventsPerToken);
  const now = new Date();
  const [{ devs }, active, last] = await Promise.all([
    getCollections(),
    findActiveHelpRequest(dev._id),
    findLastHelpRequest(dev._id),
  ]);
  await devs.updateOne({ _id: dev._id }, { $set: { lastSeenAt: now } });

  return NextResponse.json(
    {
      userId: dev._id,
      username: dev.username,
      archived: Boolean(dev.archivedAt),
      activeHelpRequest: active ? helpView(active) : null,
      lastHelpRequest: last ? helpView(last) : null,
      serverTime: now.toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
