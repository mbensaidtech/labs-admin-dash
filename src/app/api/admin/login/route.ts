import { NextResponse } from "next/server";
import { ApiError, handle, readJson } from "@/lib/api/errors";
import { safeEqual } from "@/lib/api/auth";
import { clientIp } from "@/lib/api/rateLimit";
import { loginSchema, MAX_BODY_BYTES } from "@/lib/api/schemas";
import { clearLoginFailures, loginBlockedFor, recordLoginFailure } from "@/lib/admin/loginThrottle";
import { createSessionValue, sessionCookieOptions } from "@/lib/admin/session";
import { missingAdminEnv, readEnv } from "@/lib/env";

export const POST = handle(async (request: Request) => {
  const missing = missingAdminEnv();
  if (missing.length > 0) {
    throw new ApiError("internal", `Admin area is not configured: ${missing.join(", ")} missing`, { missing });
  }

  const ip = clientIp(request);
  const blocked = loginBlockedFor(ip);
  if (blocked > 0) {
    throw new ApiError("rateLimited", "Too many failed logins, try again later", { retryAfterSeconds: blocked }, { "Retry-After": String(blocked) });
  }

  const parsed = loginSchema.safeParse(await readJson(request, MAX_BODY_BYTES));
  if (!parsed.success) {
    throw new ApiError("validation", "A password is required", { field: "password" });
  }

  const env = readEnv();
  if (!safeEqual(parsed.data.password, env.adminPassword)) {
    recordLoginFailure(ip);
    throw new ApiError("unauthorized", "Wrong password");
  }
  clearLoginFailures(ip);

  const response = new NextResponse(null, { status: 204 });
  const secure = new URL(request.url).protocol === "https:" || process.env.NODE_ENV === "production";
  response.cookies.set({ ...sessionCookieOptions(secure), value: await createSessionValue(env.sessionSecret) });
  return response;
});
