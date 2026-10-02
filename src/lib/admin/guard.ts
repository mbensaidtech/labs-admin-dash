import { cookies } from "next/headers";
import { ApiError } from "@/lib/api/errors";
import { readEnv, missingAdminEnv } from "@/lib/env";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/admin/session";

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Route handlers: 401 without a valid admin session cookie on the request. */
export async function requireAdmin(request: Request): Promise<void> {
  if (missingAdminEnv().length > 0) {
    throw new ApiError("unauthorized", "Admin area is not configured");
  }
  const valid = await verifySessionValue(readEnv().sessionSecret, cookieValue(request, SESSION_COOKIE));
  if (!valid) {
    throw new ApiError("unauthorized", "Admin session required");
  }
}

/** Server components: true when the current request carries a valid admin session. */
export async function hasAdminSession(): Promise<boolean> {
  if (missingAdminEnv().length > 0) return false;
  const store = await cookies();
  return verifySessionValue(readEnv().sessionSecret, store.get(SESSION_COOKIE)?.value);
}
