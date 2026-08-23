import { describe, expect, it, vi } from "vitest";
import { encodeFunctionResult } from "viem";
import {
  erc20ApprovalAbi,
  multicall3Abi,
  nftOperatorApprovalAbi,
} from "../lib/approvalActions";
import {
  BaseRevokeProviderError,
  getPrivateBaseRevokeStatus,
} from "../lib/baseRevokeStatus";
import type { RevokeVerificationRequest } from "../lib/revokeVerification";

const owner = "0x1111111111111111111111111111111111111111";
const delegate = "0x2222222222222222222222222222222222222222";
const tokenA = "0x3333333333333333333333333333333333333333";
const tokenB = "0x4444444444444444444444444444444444444444";
const hash = `0x${"ab".repeat(32)}` as const;
const privateRpc = "https://base-mainnet.g.alchemy.com/v2/test-only";

function request(): RevokeVerificationRequest {
  return {
    owner,
    transactionHashes: [hash],
    approvals: [
      {
        id: `erc20:${tokenA}:${delegate}`,
        kind: "erc20",
        token: { address: tokenA },
        delegate: { address: delegate },
        tokenId: null,
      },
      {
        id: `nft-operator:${tokenB}:${delegate}`,
        kind: "nft-operator",
        token: { address: tokenB },
        delegate: { address: delegate },
        tokenId: null,
      },
    ],
  };
}

function receipt(status: "0x0" | "0x1" = "0x1") {
  return {
    transactionHash: hash,
    blockNumber: "0x7b",
    status,
    from: owner,
  };
}

describe("private Base revoke status", () => {
  it("returns pending after one batched private receipt request", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json([{ jsonrpc: "2.0", id: 1, result: null }]));

    await expect(
      getPrivateBaseRevokeStatus(request(), { rpcUrl: privateRpc, fetchFn })
    ).resolves.toMatchObject({ status: "pending", retryAfter: 3 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const rpcBody = JSON.parse(String(fetchFn.mock.calls[0][1]?.body));
    expect(rpcBody).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [hash],
      },
    ]);
  });

  it("stops before state reads when the transaction reverted", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([{ jsonrpc: "2.0", id: 1, result: receipt("0x0") }])
    );

    await expect(
      getPrivateBaseRevokeStatus(request(), { rpcUrl: privateRpc, fetchFn })
    ).resolves.toMatchObject({ status: "reverted" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("uses one fixed Multicall at the confirmed receipt block and distinguishes states", async () => {
    const aggregateResult = encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: [
        {
          success: true,
          returnData: encodeFunctionResult({
            abi: erc20ApprovalAbi,
            functionName: "allowance",
            result: 0n,
          }),
        },
        {
          success: true,
          returnData: encodeFunctionResult({
            abi: nftOperatorApprovalAbi,
            functionName: "isApprovedForAll",
            result: true,
          }),
        },
      ],
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([{ jsonrpc: "2.0", id: 1, result: receipt() }])
      )
      .mockResolvedValueOnce(
        Response.json({ jsonrpc: "2.0", id: 1, result: aggregateResult })
      );

    await expect(
      getPrivateBaseRevokeStatus(request(), { rpcUrl: privateRpc, fetchFn })
    ).resolves.toMatchObject({
      status: "confirmed",
      blockNumber: 123,
      clearedIds: [`erc20:${tokenA}:${delegate}`],
      approvals: [
        { id: `erc20:${tokenA}:${delegate}`, state: "cleared" },
        { id: `nft-operator:${tokenB}:${delegate}`, state: "active" },
      ],
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const callBody = JSON.parse(String(fetchFn.mock.calls[1][1]?.body));
    expect(callBody.method).toBe("eth_call");
    expect(callBody.params[0]).toMatchObject({
      to: "0xcA11bde05977b3631167028862bE2a173976CA11",
      gas: "0x4c4b40",
    });
    expect(callBody.params[1]).toBe("0x7b");
  });

  it("matches out-of-order receipt batches by ID and reports the newest receipt block", async () => {
    const secondHash = `0x${"cd".repeat(32)}` as const;
    const aggregateResult = encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: [
        {
          success: true,
          returnData: encodeFunctionResult({
            abi: erc20ApprovalAbi,
            functionName: "allowance",
            result: 0n,
          }),
        },
        {
          success: false,
          returnData: "0x",
        },
      ],
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([
          {
            jsonrpc: "2.0",
            id: 2,
            result: {
              ...receipt(),
              transactionHash: secondHash,
              blockNumber: "0x7c",
            },
          },
          { jsonrpc: "2.0", id: 1, result: receipt() },
        ])
      )
      .mockResolvedValueOnce(
        Response.json({ jsonrpc: "2.0", id: 1, result: aggregateResult })
      );

    const result = await getPrivateBaseRevokeStatus(
      { ...request(), transactionHashes: [hash, secondHash] },
      { rpcUrl: privateRpc, fetchFn }
    );
    expect(result).toMatchObject({ status: "confirmed", blockNumber: 124 });
    const callBody = JSON.parse(String(fetchFn.mock.calls[1][1]?.body));
    expect(callBody.params[1]).toBe("0x7c");
  });

  it("accepts smart-account receipts whose outer sender differs from the logical owner", async () => {
    const aggregateResult = encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: [
        {
          success: true,
          returnData: encodeFunctionResult({
            abi: erc20ApprovalAbi,
            functionName: "allowance",
            result: 0n,
          }),
        },
        {
          success: true,
          returnData: encodeFunctionResult({
            abi: nftOperatorApprovalAbi,
            functionName: "isApprovedForAll",
            result: false,
          }),
        },
      ],
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([
          {
            jsonrpc: "2.0",
            id: 1,
            result: {
              ...receipt(),
              from: "0x9999999999999999999999999999999999999999",
            },
          },
        ])
      )
      .mockResolvedValueOnce(
        Response.json({ jsonrpc: "2.0", id: 1, result: aggregateResult })
      );

    await expect(
      getPrivateBaseRevokeStatus(request(), { rpcUrl: privateRpc, fetchFn })
    ).resolves.toMatchObject({
      status: "confirmed",
      clearedIds: [
        `erc20:${tokenA}:${delegate}`,
        `nft-operator:${tokenB}:${delegate}`,
      ],
    });
  });

  it("marks failed Multicall children unverified instead of cleared", async () => {
    const aggregateResult = encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: [
        { success: false, returnData: "0x" },
        { success: false, returnData: "0x" },
      ],
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([{ jsonrpc: "2.0", id: 1, result: receipt() }])
      )
      .mockResolvedValueOnce(
        Response.json({ jsonrpc: "2.0", id: 1, result: aggregateResult })
      );

    await expect(
      getPrivateBaseRevokeStatus(request(), { rpcUrl: privateRpc, fetchFn })
    ).resolves.toMatchObject({
      status: "confirmed",
      clearedIds: [],
      approvals: [
        { state: "unverified" },
        { state: "unverified" },
      ],
    });
  });

  it("treats receipt-block propagation errors as retryable", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([{ jsonrpc: "2.0", id: 1, result: receipt() }])
      )
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32000, message: "header not found" },
        })
      );

    const error = await getPrivateBaseRevokeStatus(request(), {
      rpcUrl: privateRpc,
      fetchFn,
    }).catch((cause) => cause);
    expect(error).toBeInstanceOf(BaseRevokeProviderError);
    expect(error).toMatchObject({ status: 503, retryAfter: 3 });
    expect(String(error)).not.toContain("header not found");
  });

  it("sanitizes provider throttling without exposing the private URL", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("provider secret detail", { status: 429 }));

    const error = await getPrivateBaseRevokeStatus(request(), {
      rpcUrl: privateRpc,
      fetchFn,
    }).catch((cause) => cause);
    expect(error).toBeInstanceOf(BaseRevokeProviderError);
    expect(error).toMatchObject({ status: 503, retryAfter: 3 });
    expect(String(error)).not.toContain(privateRpc);
    expect(String(error)).not.toContain("provider secret detail");
  });
});
