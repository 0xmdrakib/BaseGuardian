import { NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import { getBaseApprovalScan } from "@/lib/baseApprovals";
import type { BaseApprovalScan } from "@/lib/approvalTypes";
import {
  BaseNameResolutionError,
  resolveBaseAddressOrName,
} from "@/lib/baseNameResolve";
import { protectBaseApi } from "@/lib/apiProtection";
import { errorJson, publicJson } from "@/lib/apiResponses";
import { validateWalletAddressOrName } from "@/lib/apiValidation";

export const maxDuration = 60;

const CACHE_TTL_MS = 2 * 60 * 1000;
const APPROVAL_ROUTE_DEADLINE_MS = 42_000;
const approvalCache = new Map<
  string,
  { value: BaseApprovalScan; expiresAt: number }
>();
const approvalScansInFlight = new Map<string, Promise<BaseApprovalScan>>();

function cached(address: string) {
  const key = address.toLowerCase();
  const entry = approvalCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    approvalCache.delete(key);
    return null;
  }
  return entry.value;
}

function store(address: string, value: BaseApprovalScan) {
  approvalCache.set(address.toLowerCase(), {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export async function GET(request: NextRequest) {
  const deadlineAt = Date.now() + APPROVAL_ROUTE_DEADLINE_MS;
  const denied = protectBaseApi(request, "approvals");
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const input = validateWalletAddressOrName(searchParams.get("address"));
  if (!input.ok) return errorJson(input.error, 400);

  const freshValue = searchParams.get("fresh");
  if (freshValue !== null && freshValue !== "1") {
    return errorJson("fresh must be 1 when provided.", 400);
  }
  const fresh = freshValue === "1";

  try {
    const address = getAddress(await resolveBaseAddressOrName(input.value));
    if (!fresh) {
      const cachedScan = cached(address);
      if (cachedScan) return publicJson(cachedScan, 60);
    }

    const cacheKey = address.toLowerCase();
    let pendingScan = approvalScansInFlight.get(cacheKey);
    if (!pendingScan) {
      pendingScan = getBaseApprovalScan(address, { deadlineAt }).finally(() => {
        approvalScansInFlight.delete(cacheKey);
      });
      approvalScansInFlight.set(cacheKey, pendingScan);
    }
    const scan = await pendingScan;
    if (scan.coverage.status === "complete") store(address, scan);

    if (fresh || scan.coverage.status === "partial") {
      return NextResponse.json(scan, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    return publicJson(scan, 60);
  } catch (error) {
    if (error instanceof BaseNameResolutionError) {
      return errorJson(error.message, error.status);
    }
    console.error("Error scanning Base approvals", error);
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (
      message.includes("429") ||
      message.includes("rate") ||
      message.includes("capacity") ||
      message.includes("timeout") ||
      message.includes("fetch failed")
    ) {
      return NextResponse.json(
        {
          error: "The Base data provider is busy. Please try again shortly.",
          retryAfter: 3,
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "private, no-store",
            "Retry-After": "3",
          },
        }
      );
    }
    return errorJson("Failed to scan Base approvals.", 502);
  }
}
