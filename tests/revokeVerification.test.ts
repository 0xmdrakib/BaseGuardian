import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseApprovalItem } from "../lib/approvalTypes";
import {
  createRevokeVerificationRequest,
  parseRevokeVerificationRequest,
  waitForPrivateRevokeVerification,
  type RevokeVerificationRequest,
} from "../lib/revokeVerification";

const owner = "0x1111111111111111111111111111111111111111";
const token = "0x3333333333333333333333333333333333333333";
const delegate = "0x2222222222222222222222222222222222222222";
const hash = `0x${"ab".repeat(32)}` as const;

function approval(): BaseApprovalItem {
  return {
    id: `erc20:${token}:${delegate}`,
    kind: "erc20",
    token: {
      address: token,
      name: "Token",
      symbol: "TKN",
      decimals: 18,
      standard: "ERC-20",
    },
    delegate: { address: delegate, type: "contract" },
    tokenId: null,
    value: { raw: "1", display: "0.000000000000000001", unlimited: false },
    exposure: "medium",
    reasons: [],
    verification: "verified",
    permit2: false,
    lastApproval: { blockNumber: 1, transactionHash: hash },
  };
}

function request(): RevokeVerificationRequest {
  return createRevokeVerificationRequest([hash], owner, [approval()]);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("private revoke verification payload", () => {
  it("sends only the minimum fixed verification descriptor", () => {
    expect(request()).toEqual({
      transactionHashes: [hash],
      owner,
      approvals: [
        {
          id: `erc20:${token}:${delegate}`,
          kind: "erc20",
          token: { address: token },
          delegate: { address: delegate },
          tokenId: null,
        },
      ],
    });
    expect(parseRevokeVerificationRequest(request()).ok).toBe(true);
  });

  it("rejects arbitrary RPC fields and mismatched canonical IDs", () => {
    expect(
      parseRevokeVerificationRequest({ ...request(), method: "eth_call" })
    ).toMatchObject({ ok: false });
    expect(
      parseRevokeVerificationRequest({
        ...request(),
        approvals: [{ ...request().approvals[0], id: "forged" }],
      })
    ).toMatchObject({ ok: false });
    expect(
      parseRevokeVerificationRequest({
        ...request(),
        approvals: [
          {
            ...request().approvals[0],
            token: { address: token, data: "0xdeadbeef" },
          },
        ],
      })
    ).toMatchObject({ ok: false });
  });

  it("rejects invalid hashes, duplicate hashes, and invalid token IDs", () => {
    expect(
      parseRevokeVerificationRequest({ ...request(), transactionHashes: ["0x1"] })
    ).toMatchObject({ ok: false });
    expect(
      parseRevokeVerificationRequest({
        ...request(),
        transactionHashes: [hash, hash],
      })
    ).toMatchObject({ ok: false });
    expect(
      parseRevokeVerificationRequest({
        ...request(),
        approvals: [
          {
            id: `erc721-token:${token}:-1`,
            kind: "erc721-token",
            token: { address: token },
            delegate: { address: delegate },
            tokenId: "-1",
          },
        ],
      })
    ).toMatchObject({ ok: false });
  });

  it("polls pending confirmation and stops at a confirmed private result", async () => {
    vi.useFakeTimers();
    const payload = request();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { status: "pending", transactionHashes: [hash], retryAfter: 1 },
          { status: 202, headers: { "Retry-After": "1" } }
        )
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "confirmed",
          transactionHashes: [hash],
          blockNumber: 123,
          clearedIds: [payload.approvals[0].id],
          approvals: [{ id: payload.approvals[0].id, state: "cleared" }],
        })
      );

    const pending = waitForPrivateRevokeVerification(payload, {
      fetchFn,
      timeoutMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({
      status: "confirmed",
      clearedIds: [payload.approvals[0].id],
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][0]).toBe("/api/base/revoke-status");
  });
});
