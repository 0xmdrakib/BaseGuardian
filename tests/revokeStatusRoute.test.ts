import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/base/revoke-status/route";
import * as revokeService from "../lib/baseRevokeStatus";
import { resetApiProtectionForTests } from "../lib/apiProtection";
import type { RevokeVerificationRequest } from "../lib/revokeVerification";

const owner = "0x1111111111111111111111111111111111111111";
const token = "0x3333333333333333333333333333333333333333";
const delegate = "0x2222222222222222222222222222222222222222";
const hash = `0x${"ab".repeat(32)}` as const;

function payload(): RevokeVerificationRequest {
  return {
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
  };
}

function request(body: unknown = payload(), ip = "198.51.100.40") {
  return new NextRequest("https://baseguardian.example/api/base/revoke-status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://baseguardian.example",
      "x-vercel-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetApiProtectionForTests();
  vi.restoreAllMocks();
});

describe("revoke status route", () => {
  it("rejects RPC-shaped fields before the private provider is called", async () => {
    const provider = vi.spyOn(revokeService, "getPrivateBaseRevokeStatus");
    const response = await POST(request({ ...payload(), method: "eth_call" }));

    expect(response.status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });

  it("returns a no-store pending response with polling guidance", async () => {
    vi.spyOn(revokeService, "getPrivateBaseRevokeStatus").mockResolvedValue({
      status: "pending",
      transactionHashes: [hash],
      retryAfter: 3,
    });
    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(response.headers.get("Retry-After")).toBe("3");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("sanitizes private-provider failures", async () => {
    vi.spyOn(revokeService, "getPrivateBaseRevokeStatus").mockRejectedValue(
      new revokeService.BaseRevokeProviderError(
        "The private Base provider is busy.",
        503,
        3
      )
    );
    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("3");
    await expect(response.json()).resolves.toEqual({
      error: "The private Base provider is busy.",
      retryAfter: 3,
    });
  });

  it("rate-limits polling before another Alchemy request is made", async () => {
    const provider = vi
      .spyOn(revokeService, "getPrivateBaseRevokeStatus")
      .mockResolvedValue({
        status: "pending",
        transactionHashes: [hash],
        retryAfter: 3,
      });
    for (let index = 0; index < 20; index += 1) {
      expect((await POST(request())).status).toBe(202);
    }

    const denied = await POST(request());
    expect(denied.status).toBe(429);
    expect(provider).toHaveBeenCalledTimes(20);
  });
});
