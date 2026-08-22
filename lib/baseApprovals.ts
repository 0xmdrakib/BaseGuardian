import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddressEqual,
  maxUint256,
  pad,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  getAlchemyTransactionHistoryUrl,
  requireAlchemyBaseConfig,
} from "./alchemyConfig";
import type {
  ApprovalExposure,
  ApprovalKind,
  BaseApprovalItem,
  BaseApprovalScan,
} from "./approvalTypes";

export const APPROVAL_TOPIC =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
export const APPROVAL_FOR_ALL_TOPIC =
  "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";
export const PERMIT2_ADDRESS = getAddress(
  "0x000000000022D473030F116dDEE9F6B43aC78BA3"
);

const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const erc721Abi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
]);
const operatorAbi = parseAbi([
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
]);

type RpcLog = {
  address: Hex;
  blockNumber: Hex;
  data: Hex;
  logIndex: Hex;
  removed?: boolean;
  topics: Hex[];
  transactionHash: Hex;
};

export type ApprovalCandidate = {
  id: string;
  kind: ApprovalKind;
  tokenAddress: Address;
  delegateAddress: Address;
  tokenId: bigint | null;
  eventValue: bigint | boolean;
  blockNumber: number;
  logIndex: number;
  transactionHash: Hex;
};

type RpcRequest = {
  id: number;
  jsonrpc: "2.0";
  method: string;
  params: unknown[];
};

type RpcResponse = {
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type ScanOptions = {
  rpcUrl?: string;
  historyUrl?: string;
  deadlineMs?: number;
  maxLogRequests?: number;
  maxTransferPages?: number;
  requestTimeoutMs?: number;
};

const LOG_LIMIT = 10_000;
const DEFAULT_DEADLINE_MS = 42_000;
const DEFAULT_MAX_LOG_REQUESTS = 64;
const DEFAULT_REQUEST_TIMEOUT_MS = 9_000;
const MIN_SPLIT_SPAN = 2_000;
const MAX_VERIFIED_CANDIDATES = 250;
const HISTORY_PAGE_SIZE = 50;
const DEFAULT_MAX_HISTORY_PAGES = 200;
const DEFAULT_MAX_TRANSFER_PAGES = 100;
const MAX_TRANSFER_RECEIPTS = 5_000;

type HistoryLog = {
  contractAddress?: string;
  logIndex?: string | number;
  data?: string;
  removed?: boolean;
  topics?: string[];
};

type HistoryTransaction = {
  hash?: string;
  blockNumber?: string | number;
  logs?: HistoryLog[];
};

type HistoryResponse = {
  after?: string | null;
  pageKey?: string | null;
  transactions?: HistoryTransaction[];
};

type AssetTransfer = {
  blockNum?: string;
  hash?: string;
};

type AssetTransferPage = {
  pageKey?: string;
  transfers?: AssetTransfer[];
};

type RpcReceipt = {
  logs?: RpcLog[];
};

function toNumber(value: Hex) {
  return Number(BigInt(value));
}

function toHexBlock(value: number) {
  return `0x${value.toString(16)}` as Hex;
}

function historyNumber(value: string | number | undefined) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value) return null;
  try {
    return Number(BigInt(value));
  } catch {
    return null;
  }
}

function historyHex(value: string | number | undefined): Hex | null {
  const parsed = historyNumber(value);
  return parsed == null ? null : toHexBlock(parsed);
}

function approvalLogsFromHistoryPage(
  transactions: HistoryTransaction[],
  ownerTopic: Hex,
  snapshotBlock: number
) {
  const logs: RpcLog[] = [];
  for (const transaction of transactions) {
    const blockNumber = historyNumber(transaction.blockNumber);
    const transactionHash = transaction.hash;
    if (
      blockNumber == null ||
      blockNumber > snapshotBlock ||
      typeof transactionHash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)
    ) {
      continue;
    }

    for (const log of transaction.logs ?? []) {
      const topics = log.topics;
      const logIndex = historyHex(log.logIndex);
      const topic0 = topics?.[0]?.toLowerCase();
      if (
        !Array.isArray(topics) ||
        topics.length < 3 ||
        topics[1]?.toLowerCase() !== ownerTopic.toLowerCase() ||
        (topic0 !== APPROVAL_TOPIC && topic0 !== APPROVAL_FOR_ALL_TOPIC) ||
        typeof log.contractAddress !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(log.contractAddress) ||
        !logIndex
      ) {
        continue;
      }

      logs.push({
        address: log.contractAddress as Hex,
        blockNumber: toHexBlock(blockNumber),
        data:
          typeof log.data === "string" && /^0x[0-9a-fA-F]*$/.test(log.data)
            ? (log.data as Hex)
            : "0x",
        logIndex,
        removed: log.removed,
        topics: topics as Hex[],
        transactionHash: transactionHash as Hex,
      });
    }
  }
  return logs;
}

/**
 * Uses Alchemy's address index instead of walking every Base block. The same
 * API key embedded in ALCHEMY_BASE_RPC_URL authenticates this endpoint.
 */
export async function fetchApprovalLogsFromAlchemyHistory(
  historyUrl: string,
  owner: Address,
  snapshotBlock: number,
  options: Pick<ScanOptions, "deadlineMs" | "requestTimeoutMs"> & {
    maxPages?: number;
  } = {}
) {
  const deadlineAt = Date.now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxPages = options.maxPages ?? DEFAULT_MAX_HISTORY_PAGES;
  const ownerTopic = pad(owner, { size: 32 });
  const logs: RpcLog[] = [];
  const seenCursors = new Set<string>();
  let after: string | undefined;
  let pages = 0;
  let complete = false;

  while (pages < maxPages && Date.now() < deadlineAt) {
    const response = await fetch(historyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        addresses: [{ address: owner, networks: ["base-mainnet"] }],
        limit: HISTORY_PAGE_SIZE,
        ...(after ? { after } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(
        Math.min(timeoutMs, Math.max(1, deadlineAt - Date.now()))
      ),
    });
    if (!response.ok) {
      throw new Error(`Alchemy history returned HTTP ${response.status}.`);
    }
    const body = (await response.json()) as HistoryResponse;
    if (!Array.isArray(body.transactions)) {
      throw new Error("Alchemy history returned an invalid response.");
    }

    pages += 1;
    logs.push(
      ...approvalLogsFromHistoryPage(
        body.transactions,
        ownerTopic,
        snapshotBlock
      )
    );

    const next = body.after ?? body.pageKey ?? undefined;
    if (!next) {
      complete = true;
      break;
    }
    if (seenCursors.has(next)) break;
    seenCursors.add(next);
    after = next;
  }

  const unique = new Map<string, RpcLog>();
  for (const log of logs) {
    unique.set(`${log.transactionHash.toLowerCase()}:${log.logIndex}`, log);
  }
  return { complete, logs: [...unique.values()], pages };
}

/**
 * Alchemy's Transfers index includes zero-value external contract calls when
 * requested explicitly. Fetching those transaction receipts finds ordinary
 * approve/setApprovalForAll calls without a full-chain eth_getLogs walk.
 */
export async function fetchApprovalLogsFromAlchemyTransfers(
  rpcUrl: string,
  owner: Address,
  snapshotBlock: number,
  options: Pick<
    ScanOptions,
    "deadlineMs" | "maxTransferPages" | "requestTimeoutMs"
  > = {}
) {
  const deadlineAt = Date.now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxPages = options.maxTransferPages ?? DEFAULT_MAX_TRANSFER_PAGES;
  const transactionHashes = new Map<Hex, number>();
  let pageKey: string | undefined;
  let pages = 0;
  let complete = false;

  while (pages < maxPages && Date.now() < deadlineAt) {
    const result = await rpcCall<AssetTransferPage>(
      rpcUrl,
      "alchemy_getAssetTransfers",
      [
        {
          fromBlock: "0x0",
          toBlock: toHexBlock(snapshotBlock),
          fromAddress: owner,
          category: ["external", "internal", "erc20", "erc721", "erc1155"],
          excludeZeroValue: false,
          order: "asc",
          maxCount: "0x3e8",
          ...(pageKey ? { pageKey } : {}),
        },
      ],
      Math.min(timeoutMs, Math.max(1, deadlineAt - Date.now()))
    );
    if (!Array.isArray(result.transfers)) {
      throw new Error("Alchemy transfers returned an invalid response.");
    }
    pages += 1;
    for (const transfer of result.transfers) {
      const blockNumber = historyNumber(transfer.blockNum);
      if (
        blockNumber == null ||
        blockNumber > snapshotBlock ||
        typeof transfer.hash !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(transfer.hash)
      ) {
        continue;
      }
      transactionHashes.set(transfer.hash as Hex, blockNumber);
    }
    if (!result.pageKey) {
      complete = true;
      break;
    }
    if (result.pageKey === pageKey) break;
    pageKey = result.pageKey;
  }

  const receiptOverflow = transactionHashes.size > MAX_TRANSFER_RECEIPTS;
  const hashes = [...transactionHashes.keys()].slice(0, MAX_TRANSFER_RECEIPTS);
  const requests = hashes.map((hash, index) => ({
    id: index + 1,
    method: "eth_getTransactionReceipt",
    params: [hash],
  }));
  const responses = requests.length
    ? await rpcBatch(rpcUrl, requests, timeoutMs)
    : new Map<number, RpcResponse>();
  const ownerTopic = pad(owner, { size: 32 }).toLowerCase();
  const logs: RpcLog[] = [];
  let missingReceipt = false;

  for (let index = 0; index < hashes.length; index += 1) {
    const response = responses.get(index + 1);
    const receipt = response?.result as RpcReceipt | undefined;
    if (!receipt || !Array.isArray(receipt.logs)) {
      missingReceipt = true;
      continue;
    }
    for (const log of receipt.logs) {
      const topic0 = log.topics?.[0]?.toLowerCase();
      if (
        log.topics?.[1]?.toLowerCase() === ownerTopic &&
        (topic0 === APPROVAL_TOPIC || topic0 === APPROVAL_FOR_ALL_TOPIC)
      ) {
        logs.push(log);
      }
    }
  }

  const unique = new Map<string, RpcLog>();
  for (const log of logs) {
    unique.set(`${log.transactionHash.toLowerCase()}:${log.logIndex}`, log);
  }
  return {
    complete: complete && !receiptOverflow && !missingReceipt,
    logs: [...unique.values()],
    pages,
    receipts: hashes.length,
  };
}

function topicAddress(topic?: Hex): Address | null {
  if (!topic || topic.length !== 66) return null;
  return getAddress(`0x${topic.slice(-40)}`);
}

function safeBigInt(value?: Hex) {
  try {
    return value ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
}

export function decodeApprovalLog(log: RpcLog): ApprovalCandidate | null {
  if (log.removed || log.topics.length < 3) return null;

  const topic0 = log.topics[0]?.toLowerCase();
  const tokenAddress = getAddress(log.address);
  const delegateAddress = topicAddress(log.topics[2]);
  if (!delegateAddress) return null;

  const blockNumber = toNumber(log.blockNumber);
  const logIndex = toNumber(log.logIndex);

  if (topic0 === APPROVAL_TOPIC && log.topics.length >= 4) {
    const tokenId = safeBigInt(log.topics[3]);
    return {
      id: `erc721-token:${tokenAddress.toLowerCase()}:${delegateAddress.toLowerCase()}:${tokenId}`,
      kind: "erc721-token",
      tokenAddress,
      delegateAddress,
      tokenId,
      eventValue: !isAddressEqual(delegateAddress, zeroAddress),
      blockNumber,
      logIndex,
      transactionHash: log.transactionHash,
    };
  }

  if (topic0 === APPROVAL_TOPIC) {
    const value = safeBigInt(log.data);
    return {
      id: `erc20:${tokenAddress.toLowerCase()}:${delegateAddress.toLowerCase()}`,
      kind: "erc20",
      tokenAddress,
      delegateAddress,
      tokenId: null,
      eventValue: value,
      blockNumber,
      logIndex,
      transactionHash: log.transactionHash,
    };
  }

  if (topic0 === APPROVAL_FOR_ALL_TOPIC) {
    const approved = safeBigInt(log.data) !== 0n;
    return {
      id: `nft-operator:${tokenAddress.toLowerCase()}:${delegateAddress.toLowerCase()}`,
      kind: "nft-operator",
      tokenAddress,
      delegateAddress,
      tokenId: null,
      eventValue: approved,
      blockNumber,
      logIndex,
      transactionHash: log.transactionHash,
    };
  }

  return null;
}

export function reduceApprovalCandidates(logs: RpcLog[]) {
  const candidates = new Map<string, ApprovalCandidate>();
  const ordered = [...logs].sort((a, b) => {
    const blockDifference = toNumber(a.blockNumber) - toNumber(b.blockNumber);
    return blockDifference || toNumber(a.logIndex) - toNumber(b.logIndex);
  });

  for (const log of ordered) {
    let candidate: ApprovalCandidate | null = null;
    try {
      candidate = decodeApprovalLog(log);
    } catch {
      candidate = null;
    }
    if (candidate) candidates.set(candidate.id, candidate);
  }

  return [...candidates.values()].filter((candidate) =>
    typeof candidate.eventValue === "bigint"
      ? candidate.eventValue > 0n
      : candidate.eventValue
  );
}

async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Alchemy RPC returned HTTP ${response.status}.`);
  const body = (await response.json()) as RpcResponse;
  if (body.error) throw new Error(body.error.message || "Alchemy RPC request failed.");
  return body.result as T;
}

async function rpcBatch(
  rpcUrl: string,
  requests: Omit<RpcRequest, "jsonrpc">[],
  timeoutMs: number
) {
  const output = new Map<number, RpcResponse>();
  const chunks: RpcRequest[][] = [];
  for (let offset = 0; offset < requests.length; offset += 50) {
    chunks.push(
      requests.slice(offset, offset + 50).map((request) => ({
        ...request,
        jsonrpc: "2.0" as const,
      }))
    );
  }
  let nextChunk = 0;
  async function worker() {
    while (nextChunk < chunks.length) {
      const chunk = chunks[nextChunk++];
      try {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk),
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) continue;
        const bodies = (await response.json()) as RpcResponse[];
        for (const body of bodies) output.set(body.id, body);
      } catch {
        // Missing batch entries are handled as unverified candidates.
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, chunks.length) }, () => worker())
  );
  return output;
}

export async function fetchApprovalLogsAdaptive(
  rpcUrl: string,
  owner: Address,
  snapshotBlock: number,
  options: Pick<
    ScanOptions,
    "deadlineMs" | "maxLogRequests" | "requestTimeoutMs"
  > = {}
) {
  const deadlineAt = Date.now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const maxRequests = options.maxLogRequests ?? DEFAULT_MAX_LOG_REQUESTS;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const ownerTopic = pad(owner, { size: 32 });
  const ranges: Array<[number, number]> = [[0, snapshotBlock]];
  const logs: RpcLog[] = [];
  let requests = 0;
  let complete = true;

  while (ranges.length > 0) {
    if (Date.now() >= deadlineAt || requests >= maxRequests) {
      complete = false;
      break;
    }

    const [fromBlock, toBlock] = ranges.pop()!;
    requests += 1;
    try {
      const result = await rpcCall<RpcLog[]>(
        rpcUrl,
        "eth_getLogs",
        [
          {
            fromBlock: toHexBlock(fromBlock),
            toBlock: toHexBlock(toBlock),
            topics: [[APPROVAL_TOPIC, APPROVAL_FOR_ALL_TOPIC], ownerTopic],
          },
        ],
        Math.min(timeoutMs, Math.max(1, deadlineAt - Date.now()))
      );

      if (result.length >= LOG_LIMIT) {
        if (toBlock > fromBlock) {
          const middle = Math.floor((fromBlock + toBlock) / 2);
          ranges.push([middle + 1, toBlock], [fromBlock, middle]);
        } else {
          logs.push(...result);
          complete = false;
        }
      } else {
        logs.push(...result);
      }
    } catch {
      const span = toBlock - fromBlock + 1;
      if (span > MIN_SPLIT_SPAN && Date.now() < deadlineAt) {
        const middle = Math.floor((fromBlock + toBlock) / 2);
        ranges.push([middle + 1, toBlock], [fromBlock, middle]);
      } else {
        complete = false;
      }
    }
  }

  if (ranges.length > 0) complete = false;

  const unique = new Map<string, RpcLog>();
  for (const log of logs) {
    unique.set(`${log.transactionHash.toLowerCase()}:${log.logIndex}`, log);
  }
  return { complete, logs: [...unique.values()], requests };
}

function decodeResult<T>(
  response: RpcResponse | undefined,
  abi: typeof erc20Abi | typeof erc721Abi | typeof operatorAbi,
  functionName: string
): T | null {
  if (!response?.result || response.error) return null;
  try {
    return decodeFunctionResult({
      abi,
      functionName: functionName as never,
      data: response.result as Hex,
    }) as T;
  } catch {
    return null;
  }
}

function cleanString(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned ? cleaned.slice(0, 80) : null;
}

function formatTokenValue(value: bigint, decimals: number | null) {
  if (decimals == null || decimals < 0 || decimals > 255) return value.toString();
  try {
    const formatted = formatUnits(value, decimals);
    const [whole, fraction] = formatted.split(".");
    if (!fraction) return whole;
    return `${whole}.${fraction.slice(0, 6).replace(/0+$/, "")}`.replace(/\.$/, "");
  } catch {
    return value.toString();
  }
}

function exposureFor(
  candidate: ApprovalCandidate,
  verified: boolean,
  unlimited: boolean,
  delegateType: BaseApprovalItem["delegate"]["type"]
): { exposure: ApprovalExposure; reasons: string[] } {
  if (!verified) {
    return {
      exposure: "unknown",
      reasons: ["Current permission could not be verified onchain."],
    };
  }

  const reasons: string[] = [];
  if (candidate.kind === "nft-operator") {
    reasons.push("This operator can manage every NFT in this collection.");
  } else if (unlimited) {
    reasons.push("The ERC-20 allowance is unlimited.");
  } else if (candidate.kind === "erc721-token") {
    reasons.push("This delegate can transfer the approved NFT.");
  } else {
    reasons.push("This delegate has a finite ERC-20 allowance.");
  }
  if (delegateType === "eoa") {
    reasons.push("The delegate is an externally owned account, not a contract.");
  }

  return {
    exposure:
      candidate.kind === "nft-operator" || unlimited || delegateType === "eoa"
        ? "high"
        : "medium",
    reasons,
  };
}

export async function verifyApprovalCandidates(
  rpcUrl: string,
  owner: Address,
  snapshotBlock: number,
  candidates: ApprovalCandidate[],
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
) {
  const blockTag = toHexBlock(snapshotBlock);
  let nextId = 1;
  const requests: Omit<RpcRequest, "jsonrpc">[] = [];
  const candidateCalls = new Map<
    string,
    { primary: number; secondary?: number; code: number }
  >();
  const metadataCalls = new Map<
    string,
    { name: number; symbol: number; decimals?: number }
  >();

  for (const candidate of candidates) {
    const primary = nextId++;
    let secondary: number | undefined;
    let data: Hex;

    if (candidate.kind === "erc20") {
      data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, candidate.delegateAddress],
      });
    } else if (candidate.kind === "erc721-token") {
      data = encodeFunctionData({
        abi: erc721Abi,
        functionName: "ownerOf",
        args: [candidate.tokenId!],
      });
      secondary = nextId++;
      requests.push({
        id: secondary,
        method: "eth_call",
        params: [
          {
            to: candidate.tokenAddress,
            data: encodeFunctionData({
              abi: erc721Abi,
              functionName: "getApproved",
              args: [candidate.tokenId!],
            }),
          },
          blockTag,
        ],
      });
    } else {
      data = encodeFunctionData({
        abi: operatorAbi,
        functionName: "isApprovedForAll",
        args: [owner, candidate.delegateAddress],
      });
    }

    requests.push({
      id: primary,
      method: "eth_call",
      params: [{ to: candidate.tokenAddress, data }, blockTag],
    });
    const code = nextId++;
    requests.push({
      id: code,
      method: "eth_getCode",
      params: [candidate.delegateAddress, blockTag],
    });
    candidateCalls.set(candidate.id, { primary, secondary, code });

    const metadataKey = `${candidate.kind === "erc20" ? "erc20" : "nft"}:${candidate.tokenAddress.toLowerCase()}`;
    if (!metadataCalls.has(metadataKey)) {
      const abi = candidate.kind === "erc20" ? erc20Abi : erc721Abi;
      const name = nextId++;
      const symbol = nextId++;
      requests.push({
        id: name,
        method: "eth_call",
        params: [
          {
            to: candidate.tokenAddress,
            data: encodeFunctionData({ abi, functionName: "name" }),
          },
          blockTag,
        ],
      });
      requests.push({
        id: symbol,
        method: "eth_call",
        params: [
          {
            to: candidate.tokenAddress,
            data: encodeFunctionData({ abi, functionName: "symbol" }),
          },
          blockTag,
        ],
      });
      let decimals: number | undefined;
      if (candidate.kind === "erc20") {
        decimals = nextId++;
        requests.push({
          id: decimals,
          method: "eth_call",
          params: [
            {
              to: candidate.tokenAddress,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "decimals",
              }),
            },
            blockTag,
          ],
        });
      }
      metadataCalls.set(metadataKey, { name, symbol, decimals });
    }
  }

  const responses = await rpcBatch(rpcUrl, requests, timeoutMs);
  const items: BaseApprovalItem[] = [];

  for (const candidate of candidates) {
    const calls = candidateCalls.get(candidate.id)!;
    const primaryResponse = responses.get(calls.primary);
    let verified = false;
    let active = true;
    let currentValue: bigint | null = null;

    if (candidate.kind === "erc20") {
      currentValue = decodeResult<bigint>(
        primaryResponse,
        erc20Abi,
        "allowance"
      );
      verified = currentValue !== null;
      active = currentValue === null ? true : currentValue > 0n;
    } else if (candidate.kind === "erc721-token") {
      const currentOwner = decodeResult<Address>(
        primaryResponse,
        erc721Abi,
        "ownerOf"
      );
      const approved = decodeResult<Address>(
        calls.secondary ? responses.get(calls.secondary) : undefined,
        erc721Abi,
        "getApproved"
      );
      verified = currentOwner !== null && approved !== null;
      active = verified
        ? isAddressEqual(currentOwner!, owner) &&
          isAddressEqual(approved!, candidate.delegateAddress)
        : true;
    } else {
      const approved = decodeResult<boolean>(
        primaryResponse,
        operatorAbi,
        "isApprovedForAll"
      );
      verified = approved !== null;
      active = approved ?? true;
    }

    if (!active) continue;

    const codeResult = responses.get(calls.code)?.result;
    const delegateType: BaseApprovalItem["delegate"]["type"] =
      typeof codeResult !== "string"
        ? "unknown"
        : codeResult === "0x" || codeResult === "0x0"
          ? "eoa"
          : "contract";
    const metadataKey = `${candidate.kind === "erc20" ? "erc20" : "nft"}:${candidate.tokenAddress.toLowerCase()}`;
    const metadata = metadataCalls.get(metadataKey)!;
    const abi = candidate.kind === "erc20" ? erc20Abi : erc721Abi;
    const name = cleanString(
      decodeResult<string>(responses.get(metadata.name), abi, "name")
    );
    const symbol = cleanString(
      decodeResult<string>(responses.get(metadata.symbol), abi, "symbol")
    );
    const decimals = metadata.decimals
      ? decodeResult<number>(responses.get(metadata.decimals), erc20Abi, "decimals")
      : null;
    const eventValue =
      typeof candidate.eventValue === "bigint" ? candidate.eventValue : null;
    const rawValue = currentValue ?? eventValue;
    const unlimited = currentValue === maxUint256;
    const exposure = exposureFor(candidate, verified, unlimited, delegateType);

    items.push({
      id: candidate.id,
      kind: candidate.kind,
      token: {
        address: candidate.tokenAddress,
        name,
        symbol,
        decimals: typeof decimals === "number" ? decimals : null,
        standard:
          candidate.kind === "erc20"
            ? "ERC-20"
            : candidate.kind === "erc721-token"
              ? "ERC-721"
              : "ERC-721/ERC-1155",
      },
      delegate: { address: candidate.delegateAddress, type: delegateType },
      tokenId: candidate.tokenId?.toString() ?? null,
      value: {
        raw: rawValue?.toString() ?? null,
        display:
          candidate.kind === "erc20" && rawValue !== null
            ? formatTokenValue(
                rawValue,
                typeof decimals === "number" ? decimals : null
              )
            : null,
        unlimited,
      },
      exposure: exposure.exposure,
      reasons: exposure.reasons,
      verification: verified ? "verified" : "unverified",
      permit2:
        candidate.kind === "erc20" &&
        isAddressEqual(candidate.delegateAddress, PERMIT2_ADDRESS),
      lastApproval: {
        blockNumber: candidate.blockNumber,
        transactionHash: candidate.transactionHash,
      },
    });
  }

  return items.sort((a, b) => {
    const rank = { high: 0, medium: 1, unknown: 2 } as const;
    return (
      rank[a.exposure] - rank[b.exposure] ||
      b.lastApproval.blockNumber - a.lastApproval.blockNumber
    );
  });
}

export async function getBaseApprovalScan(
  owner: Address,
  options: ScanOptions = {}
): Promise<BaseApprovalScan> {
  const configured = options.rpcUrl ? null : requireAlchemyBaseConfig();
  const rpcUrl = options.rpcUrl ?? configured!.rpcUrl;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const snapshotHex = await rpcCall<Hex>(rpcUrl, "eth_blockNumber", [], timeoutMs);
  const snapshotBlock = toNumber(snapshotHex);
  let discovery: { complete: boolean; logs: RpcLog[] };
  const historyUrl =
    options.historyUrl ??
    (configured ? getAlchemyTransactionHistoryUrl(configured) : null);
  if (historyUrl) {
    let indexedLogs: RpcLog[] = [];
    try {
      const indexed = await fetchApprovalLogsFromAlchemyHistory(
        historyUrl,
        owner,
        snapshotBlock,
        options
      );
      indexedLogs = indexed.logs;
    } catch (error) {
      console.error("Alchemy address-history approval discovery failed.", error);
    }
    try {
      const transfers = await fetchApprovalLogsFromAlchemyTransfers(
        rpcUrl,
        owner,
        snapshotBlock,
        options
      );
      discovery = {
        complete: transfers.complete,
        logs: [...indexedLogs, ...transfers.logs],
      };
    } catch (error) {
      console.error("Alchemy transfer-receipt approval discovery failed.", error);
      const fallback = await fetchApprovalLogsAdaptive(
        rpcUrl,
        owner,
        snapshotBlock,
        options
      );
      discovery = {
        complete: fallback.complete,
        logs: [...indexedLogs, ...fallback.logs],
      };
    }
  } else {
    discovery = await fetchApprovalLogsAdaptive(
      rpcUrl,
      owner,
      snapshotBlock,
      options
    );
  }
  const candidates = reduceApprovalCandidates(discovery.logs);
  const candidateOverflow = candidates.length > MAX_VERIFIED_CANDIDATES;
  const candidatesToVerify = [...candidates]
    .sort((a, b) =>
      b.blockNumber - a.blockNumber || b.logIndex - a.logIndex
    )
    .slice(0, MAX_VERIFIED_CANDIDATES);
  const approvals = await verifyApprovalCandidates(
    rpcUrl,
    owner,
    snapshotBlock,
    candidatesToVerify,
    timeoutMs
  );
  const permit2Detected = approvals.some((approval) => approval.permit2);
  const verificationIncomplete = approvals.some(
    (approval) => approval.verification === "unverified"
  );
  const complete =
    discovery.complete && !candidateOverflow && !verificationIncomplete;

  return {
    address: owner,
    chain: "base-mainnet",
    snapshotBlock,
    coverage: {
      status: complete ? "complete" : "partial",
      fromBlock: 0,
      toBlock: snapshotBlock,
      standardApprovals: true,
      permit2: "flag-only",
      message: complete
        ? "Standard ERC-20, ERC-721 and ERC-1155 approval events were scanned and current permissions were checked."
        : candidateOverflow
          ? "This wallet has more approval relationships than the verification budget. The newest visible permissions were checked, but additional approvals may exist."
          : verificationIncomplete
            ? "Approval history was found, but one or more current permissions could not be verified. Treat this scan as incomplete."
            : "The historical scan was incomplete. Visible permissions were checked, but additional approvals may exist.",
    },
    summary: {
      active: approvals.length,
      unlimited: approvals.filter((approval) => approval.value.unlimited).length,
      nftOperators: approvals.filter(
        (approval) => approval.kind === "nft-operator"
      ).length,
      highExposure: approvals.filter(
        (approval) => approval.exposure === "high"
      ).length,
      unverified: approvals.filter(
        (approval) => approval.verification === "unverified"
      ).length,
    },
    approvals,
    permit2: {
      detected: permit2Detected,
      note: permit2Detected
        ? "A token delegates to Permit2. This scan does not inspect Permit2's internal spending permissions."
        : "Permit2 internal spending permissions are outside this version's coverage.",
    },
  };
}
