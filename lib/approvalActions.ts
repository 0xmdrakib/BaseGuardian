import { encodeFunctionData, parseAbi, zeroAddress, type Hex } from "viem";
import type { BaseApprovalItem } from "./approvalTypes";

export const erc20ApprovalAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);
export const erc721ApprovalAbi = parseAbi([
  "function approve(address approved, uint256 tokenId)",
]);
export const nftOperatorApprovalAbi = parseAbi([
  "function setApprovalForAll(address operator, bool approved)",
]);

export type RevokeCall = {
  to: `0x${string}`;
  data: Hex;
  label: string;
};

export function createRevokeCall(approval: BaseApprovalItem): RevokeCall {
  if (approval.verification !== "verified") {
    throw new Error("Unverified approvals cannot be revoked in-app.");
  }

  if (approval.kind === "erc20") {
    return {
      to: approval.token.address,
      data: encodeFunctionData({
        abi: erc20ApprovalAbi,
        functionName: "approve",
        args: [approval.delegate.address, 0n],
      }),
      label: `Set ${approval.token.symbol ?? "token"} allowance to zero`,
    };
  }

  if (approval.kind === "erc721-token") {
    if (approval.tokenId === null) throw new Error("NFT token ID is missing.");
    return {
      to: approval.token.address,
      data: encodeFunctionData({
        abi: erc721ApprovalAbi,
        functionName: "approve",
        args: [zeroAddress, BigInt(approval.tokenId)],
      }),
      label: `Clear approval for NFT #${approval.tokenId}`,
    };
  }

  return {
    to: approval.token.address,
    data: encodeFunctionData({
      abi: nftOperatorApprovalAbi,
      functionName: "setApprovalForAll",
      args: [approval.delegate.address, false],
    }),
    label: "Disable collection-wide operator",
  };
}
