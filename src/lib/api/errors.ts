import { NextResponse } from "next/server";

export type ErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "conflict"
  | "rateLimited"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  rateLimited: 429,
  internal: 500,
};

/** Error shape of every API route: { error, message, details? }. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>, headers?: Record<string, string>) {
    super(message);
    this.code = code;
    this.details = details;
    this.headers = headers;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export function errorResponse(error: ApiError): NextResponse {
  return NextResponse.json(
    { error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    { status: error.status, headers: error.headers },
  );
}

/** Wraps a route handler: ApiError → its JSON; anything else → 500 without leaking internals. */
export function handle<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>,
): (...args: TArgs) => Promise<Response> {
  return async (...args: TArgs) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return errorResponse(error);
      }
      console.error("Unhandled API error", error);
      return errorResponse(new ApiError("internal", "Internal error"));
    }
  };
}

/** Parses the JSON body of a request, 400 when it is not JSON or exceeds maxBytes. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) {
    throw new ApiError("validation", `Body exceeds ${maxBytes} bytes`, { reason: "tooLarge" });
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new ApiError("validation", `Body exceeds ${maxBytes} bytes`, { reason: "tooLarge" });
  }
  if (text.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("validation", "Body is not valid JSON", { reason: "invalidJson" });
  }
}
