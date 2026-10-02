import { NextResponse } from "next/server";
import { ApiError, handle, readJson } from "@/lib/api/errors";
import { authenticateDev, bearerToken, generateDevToken, hashToken, requireWorkshopKey } from "@/lib/api/auth";
import { checkRateLimit, clientIp, RATE_LIMITS } from "@/lib/api/rateLimit";
import { MAX_BODY_BYTES, registerSchema } from "@/lib/api/schemas";
import { getCollections } from "@/lib/db/client";
import type { DevDoc } from "@/lib/db/types";

/** Business Rules 1, 3, 4, 5, 16: idempotent registration protected by the workshop key. */
export const POST = handle(async (request: Request) => {
  requireWorkshopKey(request);
  checkRateLimit(`register:${clientIp(request)}`, RATE_LIMITS.registrationsPerIp);

  const parsed = registerSchema.safeParse(await readJson(request, MAX_BODY_BYTES));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError("validation", issue.message, { field: issue.path.join("."), reason: issue.message });
  }
  const { userId, username, dashboardVersion, platform } = parsed.data;
  const now = new Date();
  const { devs } = await getCollections();
  const existing = await devs.findOne({ _id: userId });

  if (existing) {
    // Known id: only the holder of the token may refresh it (a copied id cannot hijack a developer).
    if (!bearerToken(request)) {
      throw new ApiError("forbidden", "This userId is already registered; its dev token is required");
    }
    try {
      await authenticateDev(request, userId);
    } catch (error) {
      if (error instanceof ApiError && error.code === "unauthorized") {
        throw new ApiError("forbidden", "This userId is already registered; its dev token is required");
      }
      throw error;
    }
    await devs.updateOne(
      { _id: userId },
      {
        $set: {
          username,
          lastSeenAt: now,
          archivedAt: null,
          ...(dashboardVersion !== undefined ? { dashboardVersion } : {}),
          ...(platform !== undefined ? { platform } : {}),
        },
      },
    );
    return NextResponse.json({ userId, username, serverTime: now.toISOString() }, { status: 200 });
  }

  const devToken = generateDevToken();
  const doc: DevDoc = {
    _id: userId,
    username,
    tokenHash: hashToken(devToken),
    ...(dashboardVersion !== undefined ? { dashboardVersion } : {}),
    ...(platform !== undefined ? { platform } : {}),
    createdAt: now,
    lastSeenAt: now,
    lastActivityAt: now,
    lastActivityType: "dev.registered",
    archivedAt: null,
    catalogLabIds: [],
    progress: {},
  };
  try {
    await devs.insertOne(doc);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new ApiError("forbidden", "This userId is already registered; its dev token is required");
    }
    throw error;
  }
  return NextResponse.json({ userId, username, devToken, serverTime: now.toISOString() }, { status: 201 });
});
