export type ApprovalKind = "erc20" | "erc721-token" | "nft-operator";
export type ApprovalExposure = "high" | "medium" | "unknown";
export type ApprovalVerification = "verified" | "unverified";

export type BaseApprovalItem = {
  id: string;
  kind: ApprovalKind;
  token: {
    address: `0x${string}`;
    name: string | null;
    symbol: string | null;
    decimals: number | null;
    standard: "ERC-20" | "ERC-721" | "ERC-721/ERC-1155";
  };
  delegate: {
    address: `0x${string}`;
    type: "contract" | "eoa" | "unknown";
  };
  tokenId: string | null;
  value: {
    raw: string | null;
    display: string | null;
    unlimited: boolean;
  };
  exposure: ApprovalExposure;
  reasons: string[];
  verification: ApprovalVerification;
  permit2: boolean;
  lastApproval: {
    blockNumber: number;
    transactionHash: `0x${string}`;
  };
};

export type BaseApprovalScan = {
  address: `0x${string}`;
  chain: "base-mainnet";
  snapshotBlock: number;
  coverage: {
    status: "complete" | "partial";
    fromBlock: 0;
    toBlock: number;
    standardApprovals: true;
    permit2: "flag-only";
    message: string;
  };
  summary: {
    active: number;
    unlimited: number;
    nftOperators: number;
    highExposure: number;
    unverified: number;
  };
  approvals: BaseApprovalItem[];
  permit2: {
    detected: boolean;
    note: string;
  };
};
