import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseApprovalScan } from "../lib/approvalTypes";

vi.mock("../lib/baseApprovals", () => ({
  getBaseApprovalScan: vi.fn(),
}));
vi.mock("../lib/baseNameResolve", () => ({
  BaseNameResolutionError: class BaseNameResolutionError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message);
    }
  },
  resolveBaseAddressOrName: vi.fn(async (value: string) => value),
}));

import { GET } from "../app/api/base/approvals/route";
import { getBaseApprovalScan } from "../lib/baseApprovals";
import {
  BaseNameResolutionError,
  resolveBaseAddressOrName,
} from "../lib/baseNameResolve";
import { resetApiProtectionForTests } from "../lib/apiProtection";

const address = "0x1111111111111111111111111111111111111111";

function scan(status: "complete" | "partial" = "complete"): BaseApprovalScan {
  return {
    address,
    chain: "base-mainnet",
    snapshotBlock: 100,
    coverage: {
      status,
      fromBlock: 0,
      toBlock: 100,
      standardApprovals: true,
      permit2: "flag-only",
      message: status === "complete" ? "complete" : "partial",
    },
    summary: {
      active: 0,
      unlimited: 0,
      nftOperators: 0,
      highExposure: 0,
      unverified: 0,
    },
    approvals: [],
    permit2: { detected: false, note: "flag only" },
  };
}

function request(query: string) {
  return new NextRequest(`https://baseguardian.example/api/base/approvals?${query}`, {
    headers: { "x-vercel-forwarded-for": "198.51.100.20" },
  });
}

beforeEach(() => {
  resetApiProtectionForTests();
  vi.mocked(getBaseApprovalScan).mockReset();
});

describe("approval scan route", () => {
  it("validates the fresh parameter before scanning", async () => {
    const response = await GET(request(`address=${address}&fresh=true`));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "fresh must be 1 when provided.",
    });
    expect(getBaseApprovalScan).not.toHaveBeenCalled();
  });

  it("caches complete scans and returns public cache headers", async () => {
    vi.mocked(getBaseApprovalScan).mockResolvedValue(scan("complete"));
    const first = await GET(request(`address=${address}`));
    const second = await GET(request(`address=${address}`));

    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toContain("s-maxage=60");
    expect(second.status).toBe(200);
    expect(getBaseApprovalScan).toHaveBeenCalledTimes(1);
    expect(getBaseApprovalScan).toHaveBeenCalledWith(
      address,
      expect.objectContaining({ deadlineAt: expect.any(Number) })
    );
  });

  it("returns partial scans with no-store and never caches them", async () => {
    const partialAddress = "0x4444444444444444444444444444444444444444";
    vi.mocked(getBaseApprovalScan).mockResolvedValue({
      ...scan("partial"),
      address: partialAddress,
    });
    const response = await GET(request(`address=${partialAddress}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("bypasses caches for a confirmed-transaction refresh", async () => {
    vi.mocked(getBaseApprovalScan).mockResolvedValue(scan("complete"));
    const response = await GET(request(`address=${address}&fresh=1`));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getBaseApprovalScan).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent scans for the same wallet", async () => {
    const concurrentAddress = "0x5555555555555555555555555555555555555555";
    let release!: (value: BaseApprovalScan) => void;
    vi.mocked(getBaseApprovalScan).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    const first = GET(request(`address=${concurrentAddress}`));
    const second = GET(request(`address=${concurrentAddress}`));
    await vi.waitFor(() => expect(getBaseApprovalScan).toHaveBeenCalledTimes(1));
    release({ ...scan("complete"), address: concurrentAddress });

    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(second).resolves.toMatchObject({ status: 200 });
  });

  it("returns a retryable JSON error when Alchemy is throttled", async () => {
    const busyAddress = "0x6666666666666666666666666666666666666666";
    vi.mocked(getBaseApprovalScan).mockRejectedValue(
      new Error("Alchemy RPC returned HTTP 429.")
    );
    const response = await GET(request(`address=${busyAddress}`));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("3");
    await expect(response.json()).resolves.toMatchObject({ retryAfter: 3 });
  });

  it("returns a typed not-found response for an unresolved name", async () => {
    vi.mocked(resolveBaseAddressOrName).mockRejectedValueOnce(
      new BaseNameResolutionError("No Base address was found.", 404)
    );
    const response = await GET(request("address=missing.base.eth"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "No Base address was found.",
    });
  });
});
