import { NextRequest, NextResponse } from "next/server";
import {
  BaseRevokeProviderError,
  getPrivateBaseRevokeStatus,
} from "@/lib/baseRevokeStatus";
import { protectBaseApi } from "@/lib/apiProtection";
import { errorJson } from "@/lib/apiResponses";
import { parseRevokeVerificationRequest } from "@/lib/revokeVerification";

export const maxDuration = 15;

const MAX_BODY_BYTES = 32_768;

function noStoreJson(body: unknown, status = 200, retryAfter?: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}

export async function POST(request: NextRequest) {
  const denied = protectBaseApi(request, "revoke-status");
  if (denied) return denied;

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return errorJson("Content-Type must be application/json.", 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > MAX_BODY_BYTES
  ) {
    return errorJson("Revoke verification request is too large.", 413);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return errorJson("Cross-origin revoke verification is not allowed.", 403);
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return errorJson("Revoke verification request is too large.", 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return errorJson("Request body must be valid JSON.", 400);
  }
  const parsed = parseRevokeVerificationRequest(body);
  if (!parsed.ok) return errorJson(parsed.error, 400);

  try {
    const result = await getPrivateBaseRevokeStatus(parsed.value, {
      signal: request.signal,
    });
    if (result.status === "pending") {
      return noStoreJson(result, 202, result.retryAfter);
    }
    return noStoreJson(result);
  } catch (error) {
    if (error instanceof BaseRevokeProviderError) {
      console.error("Private Base revoke verification failed", {
        name: error.name,
        status: error.status,
      });
      return noStoreJson(
        { error: error.message, retryAfter: error.retryAfter },
        error.status,
        error.retryAfter
      );
    }
    console.error("Private Base revoke verification failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return noStoreJson(
      { error: "Failed to verify the Base transaction." },
      502
    );
  }
}
