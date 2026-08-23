import {
  decodeFunctionResult,
  encodeFunctionData,
  isAddressEqual,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import type { BaseApprovalItem } from "./approvalTypes";

export const erc20ApprovalAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
export const erc721ApprovalAbi = parseAbi([
  "function approve(address approved, uint256 tokenId)",
  "function getApproved(uint256 tokenId) view returns (address)",
]);
export const nftOperatorApprovalAbi = parseAbi([
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
]);
export const multicall3Abi = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);
export const BASE_MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export type RevokeCall = {
  to: `0x${string}`;
  data: Hex;
  label: string;
};

export type RevokeVerificationDescriptor = Pick<
  BaseApprovalItem,
  "id" | "kind" | "tokenId"
> & {
  token: Pick<BaseApprovalItem["token"], "address">;
  delegate: Pick<BaseApprovalItem["delegate"], "address">;
};

export type DecodedRevokeState = "cleared" | "active" | "unverified";

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

export function createRevokeVerificationCall(
  approval: RevokeVerificationDescriptor,
  owner: Address
): Pick<RevokeCall, "to" | "data"> {
  if (approval.kind === "erc20") {
    return {
      to: approval.token.address,
      data: encodeFunctionData({
        abi: erc20ApprovalAbi,
        functionName: "allowance",
        args: [owner, approval.delegate.address],
      }),
    };
  }
  if (approval.kind === "erc721-token") {
    if (approval.tokenId === null) throw new Error("NFT token ID is missing.");
    return {
      to: approval.token.address,
      data: encodeFunctionData({
        abi: erc721ApprovalAbi,
        functionName: "getApproved",
        args: [BigInt(approval.tokenId)],
      }),
    };
  }
  return {
    to: approval.token.address,
    data: encodeFunctionData({
      abi: nftOperatorApprovalAbi,
      functionName: "isApprovedForAll",
      args: [owner, approval.delegate.address],
    }),
  };
}

export function isRevokeStateCleared(
  approval: RevokeVerificationDescriptor,
  result: Hex | undefined
) {
  return decodeRevokeState(approval, result) === "cleared";
}

export function decodeRevokeState(
  approval: RevokeVerificationDescriptor,
  result: Hex | undefined
): DecodedRevokeState {
  if (!result) return "unverified";
  try {
    if (approval.kind === "erc20") {
      return (
        decodeFunctionResult({
          abi: erc20ApprovalAbi,
          functionName: "allowance",
          data: result,
        }) === 0n
      )
        ? "cleared"
        : "active";
    }
    if (approval.kind === "erc721-token") {
      const approved = decodeFunctionResult({
        abi: erc721ApprovalAbi,
        functionName: "getApproved",
        data: result,
      });
      return isAddressEqual(approved, zeroAddress) ? "cleared" : "active";
    }
    return (
      decodeFunctionResult({
        abi: nftOperatorApprovalAbi,
        functionName: "isApprovedForAll",
        data: result,
      }) === false
    )
      ? "cleared"
      : "active";
  } catch {
    return "unverified";
  }
}

export function createRevokeVerificationBatch(
  approvals: readonly RevokeVerificationDescriptor[],
  owner: Address
) {
  return approvals.map((approval) => {
    const call = createRevokeVerificationCall(approval, owner);
    return {
      target: call.to,
      allowFailure: true,
      callData: call.data,
    } as const;
  });
}

export function clearedApprovalIdsFromVerificationBatch(
  approvals: readonly RevokeVerificationDescriptor[],
  results: readonly { success: boolean; returnData: Hex }[]
) {
  return approvals.flatMap((approval, index) => {
    const result = results[index];
    return result?.success &&
      isRevokeStateCleared(approval, result.returnData)
      ? [approval.id]
      : [];
  });
}
