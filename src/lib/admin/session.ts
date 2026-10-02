/**
 * Admin session: a signed cookie `<expiresMs>.<hmac>` (Web Crypto only, so it also runs in the proxy).
 * httpOnly, Secure (outside development), SameSite=Lax, 12 hours.
 */
export const SESSION_COOKIE = "labs_admin_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const encoder = new TextEncoder();

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionValue(secret: string, now = Date.now()): Promise<string> {
  const expires = String(now + SESSION_TTL_MS);
  return `${expires}.${await hmac(secret, expires)}`;
}

export async function verifySessionValue(secret: string, value: string | undefined, now = Date.now()): Promise<boolean> {
  if (!secret || !value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < now) return false;
  const expected = await hmac(secret, expires);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export function sessionCookieOptions(secure: boolean) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}
