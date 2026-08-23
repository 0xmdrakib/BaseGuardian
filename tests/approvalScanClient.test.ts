import { describe, expect, it } from "vitest";
import {
  approvalScanRequestReducer,
  approvalScanRequestUrl,
  initialApprovalScanRequestState,
  normalizeApprovalScanQuery,
  parseApprovalScanCache,
  parseApprovalScanResponse,
  removeApprovalItems,
  serializeApprovalScanCache,
} from "../lib/approvalScanClient";
import type { BaseApprovalScan } from "../lib/approvalTypes";

const address = "0x1111111111111111111111111111111111111111" as const;

function scan(): BaseApprovalScan {
  return {
    address,
    chain: "base-mainnet",
    snapshotBlock: 123,
    coverage: {
      status: "complete",
      fromBlock: 0,
      toBlock: 123,
      standardApprovals: true,
      permit2: "flag-only",
      message: "Complete",
    },
    summary: {
      active: 1,
      unlimited: 1,
      nftOperators: 0,
      highExposure: 1,
      unverified: 0,
    },
    approvals: [
      {
        id: "approval-1",
        kind: "erc20",
        token: {
          address: "0x2222222222222222222222222222222222222222",
          name: "Token",
          symbol: "TKN",
          decimals: 18,
          standard: "ERC-20",
        },
        delegate: {
          address: "0x3333333333333333333333333333333333333333",
          type: "contract",
        },
        tokenId: null,
        value: { raw: "100", display: "0.0000000000000001", unlimited: true },
        exposure: "high",
        reasons: ["Unlimited ERC-20 allowance"],
        verification: "verified",
        permit2: false,
        lastApproval: {
          blockNumber: 120,
          transactionHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
    ],
    permit2: { detected: false, note: "Flag only" },
  };
}

describe("approval scan request state", () => {
  it("normalizes submitted wallet queries", () => {
    expect(normalizeApprovalScanQuery("  NAME.Base.ETH ")).toBe(
      "name.base.eth"
    );
  });

  it("ignores stale success and failure events after a newer request starts", () => {
    const first = approvalScanRequestReducer(initialApprovalScanRequestState, {
      type: "start",
      requestId: 1,
      query: "wallet-a",
    });
    const second = approvalScanRequestReducer(first, {
      type: "start",
      requestId: 2,
      query: "wallet-b",
    });
    const staleSuccess = approvalScanRequestReducer(second, {
      type: "success",
      requestId: 1,
      query: "wallet-a",
      scan: scan(),
    });
    const staleFailure = approvalScanRequestReducer(staleSuccess, {
      type: "failure",
      requestId: 1,
      query: "wallet-a",
      error: "old error",
    });

    expect(staleFailure).toBe(second);
    expect(staleFailure.phase).toBe("loading");

    const completed = approvalScanRequestReducer(staleFailure, {
      type: "success",
      requestId: 2,
      query: "wallet-b",
      scan: scan(),
    });
    expect(completed.phase).toBe("idle");
    expect(completed.scan).toEqual(scan());
  });

  it("keeps an existing result visible while the same wallet refreshes", () => {
    const existing = {
      ...initialApprovalScanRequestState,
      query: "wallet-a",
      scan: scan(),
    };
    const refreshing = approvalScanRequestReducer(existing, {
      type: "start",
      requestId: 3,
      query: "wallet-a",
    });
    expect(refreshing.phase).toBe("refreshing");
    expect(refreshing.scan).toEqual(scan());

    const failed = approvalScanRequestReducer(refreshing, {
      type: "failure",
      requestId: 3,
      query: "wallet-a",
      error: "gateway unavailable",
    });
    expect(failed.scan).toEqual(scan());
    expect(failed.error).toBe("gateway unavailable");
  });

  it("ignores a response after its request is cancelled", () => {
    const loading = approvalScanRequestReducer(initialApprovalScanRequestState, {
      type: "start",
      requestId: 4,
      query: "wallet-a",
    });
    const cancelled = approvalScanRequestReducer(loading, {
      type: "cancel",
      requestId: 4,
    });
    const late = approvalScanRequestReducer(cancelled, {
      type: "success",
      requestId: 4,
      query: "wallet-a",
      scan: scan(),
    });
    expect(late).toBe(cancelled);
    expect(late.scan).toBeNull();
  });
});

describe("approval scan browser cache", () => {
  it("round-trips a versioned, fully validated scan", () => {
    const raw = serializeApprovalScanCache(scan(), 1_000);
    expect(parseApprovalScanCache(raw, 2_000)?.scan).toEqual(scan());
    expect(parseApprovalScanCache(raw, 2_000)?.requiresFresh).toBe(false);
  });

  it("persists a one-time fresh requirement after a confirmed revoke", () => {
    const cached = parseApprovalScanCache(
      serializeApprovalScanCache(scan(), 1_000, true),
      1_001
    );
    expect(cached?.requiresFresh).toBe(true);
    expect(approvalScanRequestUrl("alice.base.eth", cached?.requiresFresh)).toBe(
      "/api/base/approvals?address=alice.base.eth&fresh=1"
    );
  });

  it("rejects old versions, expired entries, and incomplete shapes", () => {
    const raw = serializeApprovalScanCache(scan(), 1_000);
    expect(parseApprovalScanCache(raw, 1_000 + 10 * 60_000 + 1)).toBeNull();
    expect(
      parseApprovalScanCache(
        JSON.stringify({ version: 0, savedAt: 1_000, scan: scan() }),
        2_000
      )
    ).toBeNull();
    expect(
      parseApprovalScanCache(
        JSON.stringify({ version: 1, savedAt: 1_000, scan: { address } }),
        2_000
      )
    ).toBeNull();
  });
});

describe("approval scan HTTP responses", () => {
  it("accepts only complete response shapes", async () => {
    const response = new Response(JSON.stringify(scan()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    await expect(parseApprovalScanResponse(response)).resolves.toEqual(scan());

    await expect(
      parseApprovalScanResponse(
        new Response(JSON.stringify({ address }), { status: 200 })
      )
    ).rejects.toThrow("invalid response");
  });

  it("surfaces plain-text gateway failures", async () => {
    await expect(
      parseApprovalScanResponse(new Response("error code: 502\n", { status: 502 }))
    ).rejects.toThrow("HTTP 502): error code: 502");
  });

  it("includes Retry-After guidance for rate limits", async () => {
    await expect(
      parseApprovalScanResponse(
        new Response(JSON.stringify({ error: "Too many scans." }), {
          status: 429,
          headers: { "Retry-After": "17" },
        })
      )
    ).rejects.toThrow("Try again in 17 seconds");
  });
});

describe("confirmed revoke result updates", () => {
  it("removes only confirmed rows and recomputes the summary", () => {
    const updated = removeApprovalItems(scan(), ["approval-1"]);
    expect(updated.approvals).toEqual([]);
    expect(updated.summary).toEqual({
      active: 0,
      unlimited: 0,
      nftOperators: 0,
      highExposure: 0,
      unverified: 0,
    });
  });
});
