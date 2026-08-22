import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseApprovalScan } from "../lib/approvalTypes";

vi.mock("../lib/baseApprovals", () => ({
  getBaseApprovalScan: vi.fn(),
}));
vi.mock("../lib/baseNameResolve", () => ({
  resolveBaseAddressOrName: vi.fn(async (value: string) => value),
}));

import { GET } from "../app/api/base/approvals/route";
import { getBaseApprovalScan } from "../lib/baseApprovals";
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
});
