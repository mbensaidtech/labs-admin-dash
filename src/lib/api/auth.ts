import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import { readEnv } from "@/lib/env";
import { getCollections } from "@/lib/db/client";
import type { DevDoc } from "@/lib/db/types";

export function generateDevToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of two strings (different lengths compare as different, in constant time). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Compare against itself to keep the timing independent of the mismatch, then fail.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function requireWorkshopKey(request: Request): void {
  const { workshopKey } = readEnv();
  const provided = request.headers.get("x-workshop-key") ?? "";
  if (!workshopKey || !provided || !safeEqual(provided, workshopKey)) {
    throw new ApiError("unauthorized", "A valid X-Workshop-Key header is required");
  }
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export interface AuthenticatedDev {
  dev: DevDoc;
  token: string;
}

/**
 * Resolves the developer bound to the bearer token. 401 without a valid token;
 * 403 when the body's userId is not the one bound to the token (Business Rule 2).
 */
export async function authenticateDev(request: Request, bodyUserId?: string): Promise<AuthenticatedDev> {
  const token = bearerToken(request);
  if (!token) {
    throw new ApiError("unauthorized", "A Bearer dev token is required");
  }

  const { devs } = await getCollections();
  const tokenHash = hashToken(token);
  const dev = await devs.findOne({ tokenHash });
  if (!dev || !safeEqual(dev.tokenHash, tokenHash)) {
    throw new ApiError("unauthorized", "Unknown dev token");
  }

  if (bodyUserId !== undefined && bodyUserId !== dev._id) {
    throw new ApiError("forbidden", "userId does not match the dev token");
  }

  return { dev, token };
}
