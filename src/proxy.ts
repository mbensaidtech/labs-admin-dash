import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/admin/session";

/** Pages other than /login need the admin session (API routes check it themselves and answer 401). */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const secret = process.env.SESSION_SECRET ?? "";
  const valid = await verifySessionValue(secret, request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    return valid ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (!valid) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
