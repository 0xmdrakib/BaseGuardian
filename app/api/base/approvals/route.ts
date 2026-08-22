import { NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import { getBaseApprovalScan } from "@/lib/baseApprovals";
import type { BaseApprovalScan } from "@/lib/approvalTypes";
import { resolveBaseAddressOrName } from "@/lib/baseNameResolve";
import { protectBaseApi } from "@/lib/apiProtection";
import { errorJson, publicJson } from "@/lib/apiResponses";
import { validateWalletAddressOrName } from "@/lib/apiValidation";

export const maxDuration = 60;

const CACHE_TTL_MS = 2 * 60 * 1000;
const approvalCache = new Map<
  string,
  { value: BaseApprovalScan; expiresAt: number }
>();

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

    const scan = await getBaseApprovalScan(address);
    if (scan.coverage.status === "complete") store(address, scan);

    if (fresh || scan.coverage.status === "partial") {
      return NextResponse.json(scan, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    return publicJson(scan, 60);
  } catch (error) {
    console.error("Error scanning Base approvals", error);
    return errorJson("Failed to scan Base approvals.", 502);
  }
}
