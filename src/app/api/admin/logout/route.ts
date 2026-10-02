import { NextResponse } from "next/server";
import { sessionCookieOptions } from "@/lib/admin/session";

export async function POST(request: Request) {
  const response = new NextResponse(null, { status: 204 });
  const secure = new URL(request.url).protocol === "https:" || process.env.NODE_ENV === "production";
  response.cookies.set({ ...sessionCookieOptions(secure), value: "", maxAge: 0 });
  return response;
}
