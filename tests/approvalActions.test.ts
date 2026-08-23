import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import {
  clearedApprovalIdsFromVerificationBatch,
  createRevokeCall,
  createRevokeVerificationBatch,
  createRevokeVerificationCall,
  erc20ApprovalAbi,
  erc721ApprovalAbi,
  isRevokeStateCleared,
  nftOperatorApprovalAbi,
} from "../lib/approvalActions";
import type { BaseApprovalItem } from "../lib/approvalTypes";

function approval(
  kind: BaseApprovalItem["kind"],
  overrides: Partial<BaseApprovalItem> = {}
): BaseApprovalItem {
  return {
    id: "approval-id",
    kind,
    token: {
      address: "0x3333333333333333333333333333333333333333",
      name: "Asset",
      symbol: "AST",
      decimals: kind === "erc20" ? 18 : null,
      standard:
        kind === "erc20"
          ? "ERC-20"
          : kind === "erc721-token"
            ? "ERC-721"
            : "ERC-721/ERC-1155",
    },
    delegate: {
      address: "0x2222222222222222222222222222222222222222",
      type: "contract",
    },
    tokenId: kind === "erc721-token" ? "42" : null,
    value: { raw: "1", display: "1", unlimited: false },
    exposure: "medium",
    reasons: [],
    verification: "verified",
    permit2: false,
    lastApproval: {
      blockNumber: 10,
      transactionHash: `0x${"ab".repeat(32)}`,
    },
    ...overrides,
  };
}

describe("approval revoke calls", () => {
  it("sets an ERC-20 allowance to zero", () => {
    const call = createRevokeCall(approval("erc20"));
    expect(decodeFunctionData({ abi: erc20ApprovalAbi, data: call.data })).toMatchObject({
      functionName: "approve",
      args: ["0x2222222222222222222222222222222222222222", 0n],
    });
  });

  it("clears an ERC-721 token approval", () => {
    const call = createRevokeCall(approval("erc721-token"));
    expect(decodeFunctionData({ abi: erc721ApprovalAbi, data: call.data })).toMatchObject({
      functionName: "approve",
      args: ["0x0000000000000000000000000000000000000000", 42n],
    });
  });

  it("disables an NFT operator", () => {
    const call = createRevokeCall(approval("nft-operator"));
    expect(
      decodeFunctionData({ abi: nftOperatorApprovalAbi, data: call.data })
    ).toMatchObject({
      functionName: "setApprovalForAll",
      args: ["0x2222222222222222222222222222222222222222", false],
    });
  });

  it("refuses to build a call for an unverified permission", () => {
    expect(() =>
      createRevokeCall(
        approval("erc20", { verification: "unverified", exposure: "unknown" })
      )
    ).toThrow("Unverified approvals cannot be revoked");
  });

  it("verifies ERC-20 state instead of trusting receipt success", () => {
    const item = approval("erc20");
    const call = createRevokeVerificationCall(
      item,
      "0x1111111111111111111111111111111111111111"
    );
    expect(
      decodeFunctionData({ abi: erc20ApprovalAbi, data: call.data })
    ).toMatchObject({
      functionName: "allowance",
      args: [
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
      ],
    });
    expect(
      isRevokeStateCleared(
        item,
        encodeFunctionResult({
          abi: erc20ApprovalAbi,
          functionName: "allowance",
          result: 0n,
        })
      )
    ).toBe(true);
    expect(
      isRevokeStateCleared(
        item,
        encodeFunctionResult({
          abi: erc20ApprovalAbi,
          functionName: "allowance",
          result: 1n,
        })
      )
    ).toBe(false);
  });

  it("verifies cleared NFT token and operator permissions", () => {
    expect(
      isRevokeStateCleared(
        approval("erc721-token"),
        encodeFunctionResult({
          abi: erc721ApprovalAbi,
          functionName: "getApproved",
          result: "0x0000000000000000000000000000000000000000",
        })
      )
    ).toBe(true);
    expect(
      isRevokeStateCleared(
        approval("nft-operator"),
        encodeFunctionResult({
          abi: nftOperatorApprovalAbi,
          functionName: "isApprovedForAll",
          result: false,
        })
      )
    ).toBe(true);
  });

  it("builds one verification batch and keeps only cleared approvals", () => {
    const owner = "0x1111111111111111111111111111111111111111";
    const approvals = [
      approval("erc20", { id: "cleared-token" }),
      approval("nft-operator", { id: "active-operator" }),
    ];
    const calls = createRevokeVerificationBatch(approvals, owner);

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.allowFailure)).toBe(true);
    expect(calls.map((call) => call.target)).toEqual([
      approvals[0].token.address,
      approvals[1].token.address,
    ]);

    const clearedIds = clearedApprovalIdsFromVerificationBatch(approvals, [
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
    ]);

    expect(clearedIds).toEqual(["cleared-token"]);
  });
});
