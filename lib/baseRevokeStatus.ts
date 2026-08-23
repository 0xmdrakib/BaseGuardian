import {
  decodeFunctionResult,
  encodeFunctionData,
  toHex,
  type Hex,
} from "viem";
import {
  BASE_MULTICALL3_ADDRESS,
  createRevokeVerificationBatch,
  decodeRevokeState,
  multicall3Abi,
} from "./approvalActions";
import { requireAlchemyBaseConfig } from "./alchemyConfig";
import type {
  RevokeVerificationRequest,
  RevokeVerificationResult,
} from "./revokeVerification";

type RpcResponse = {
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type RpcReceipt = {
  transactionHash: Hex;
  blockNumber: Hex;
  status: Hex;
};

export class BaseRevokeProviderError extends Error {
  constructor(
    message: string,
    readonly status: 502 | 503,
    readonly retryAfter?: number
  ) {
    super(message);
    this.name = "BaseRevokeProviderError";
  }
}

type VerifyOptions = {
  fetchFn?: typeof fetch;
  rpcUrl?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function rpcFetch(
  body: unknown,
  options: Required<Pick<VerifyOptions, "fetchFn" | "rpcUrl" | "timeoutMs">> &
    Pick<VerifyOptions, "signal">
) {
  let response: Response;
  try {
    response = await options.fetchFn(options.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: timeoutSignal(options.signal, options.timeoutMs),
    });
  } catch {
    throw new BaseRevokeProviderError(
      "The private Base provider is temporarily unavailable.",
      503,
      3
    );
  }

  if (!response.ok) {
    throw new BaseRevokeProviderError(
      response.status === 429 || response.status >= 500
        ? "The private Base provider is busy."
        : "The private Base provider rejected the request.",
      response.status === 429 || response.status >= 500 ? 503 : 502,
      response.status === 429 || response.status >= 500 ? 3 : undefined
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new BaseRevokeProviderError(
      "The private Base provider returned an invalid response.",
      502
    );
  }
}

function rpcResult(response: RpcResponse | undefined) {
  if (response?.error) {
    // Every RPC method and calldata in this route is fixed server-side. A
    // provider-level JSON-RPC error therefore represents a transient provider
    // or block-propagation failure, not invalid user-supplied RPC input.
    throw new BaseRevokeProviderError(
      "The private Base provider could not verify the transaction yet.",
      503,
      3
    );
  }
  if (!response || !("result" in response)) {
    throw new BaseRevokeProviderError(
      "The private Base provider could not verify the transaction.",
      502
    );
  }
  return response.result;
}

function parseReceipt(value: unknown, expectedHash: Hex): RpcReceipt | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    throw new BaseRevokeProviderError(
      "The private Base provider returned an invalid receipt.",
      502
    );
  }
  const receipt = value as Partial<RpcReceipt>;
  if (
    typeof receipt.transactionHash !== "string" ||
    receipt.transactionHash.toLowerCase() !== expectedHash.toLowerCase() ||
    typeof receipt.blockNumber !== "string" ||
    !/^0x[0-9a-f]+$/i.test(receipt.blockNumber) ||
    (receipt.status !== "0x0" && receipt.status !== "0x1")
  ) {
    throw new BaseRevokeProviderError(
      "The private Base provider returned an invalid receipt.",
      502
    );
  }
  return receipt as RpcReceipt;
}

export async function getPrivateBaseRevokeStatus(
  request: RevokeVerificationRequest,
  options: VerifyOptions = {}
): Promise<RevokeVerificationResult> {
  const rpcUrl = options.rpcUrl ?? requireAlchemyBaseConfig().rpcUrl;
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 7_000;
  const rpcOptions = { fetchFn, rpcUrl, timeoutMs, signal: options.signal };

  const receiptPayload = request.transactionHashes.map((hash, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "eth_getTransactionReceipt",
    params: [hash],
  }));
  const receiptJson = await rpcFetch(receiptPayload, rpcOptions);
  if (!Array.isArray(receiptJson)) {
    throw new BaseRevokeProviderError(
      "The private Base provider returned an invalid receipt batch.",
      502
    );
  }
  if (
    receiptJson.length !== request.transactionHashes.length ||
    receiptJson.some(
      (entry) =>
        !entry ||
        typeof entry !== "object" ||
        !Number.isInteger((entry as { id?: unknown }).id)
    )
  ) {
    throw new BaseRevokeProviderError(
      "The private Base provider returned an invalid receipt batch.",
      502
    );
  }
  const receiptResponses = new Map(
    (receiptJson as RpcResponse[]).map((entry) => [entry.id, entry])
  );
  const receipts = request.transactionHashes.map((hash, index) =>
    parseReceipt(
      rpcResult(receiptResponses.get(index + 1)),
      hash
    )
  );

  if (receipts.some((receipt) => receipt === null)) {
    return {
      status: "pending",
      transactionHashes: request.transactionHashes,
      retryAfter: 3,
    };
  }
  const confirmedReceipts = receipts as RpcReceipt[];
  if (confirmedReceipts.some((receipt) => receipt.status === "0x0")) {
    return {
      status: "reverted",
      transactionHashes: request.transactionHashes,
    };
  }
  const blockNumber = confirmedReceipts.reduce((highest, receipt) => {
    const current = BigInt(receipt.blockNumber);
    return current > highest ? current : highest;
  }, 0n);
  if (blockNumber > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BaseRevokeProviderError(
      "The private Base provider returned an unsupported block number.",
      502
    );
  }
  const calls = createRevokeVerificationBatch(
    request.approvals,
    request.owner
  );
  const callData = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [calls],
  });
  const verificationJson = (await rpcFetch(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [
        {
          to: BASE_MULTICALL3_ADDRESS,
          data: callData,
          gas: toHex(5_000_000),
        },
        // Read the post-transaction state at the confirmed receipt block. If a
        // provider backend has not indexed that block yet, its retryable RPC
        // error is handled by the bounded client backoff.
        toHex(blockNumber),
      ],
    },
    rpcOptions
  )) as RpcResponse;
  const encodedResult = rpcResult(verificationJson);
  if (typeof encodedResult !== "string") {
    throw new BaseRevokeProviderError(
      "The private Base provider returned invalid verification data.",
      502
    );
  }

  let results: readonly { success: boolean; returnData: Hex }[];
  try {
    results = decodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      data: encodedResult as Hex,
    });
  } catch {
    throw new BaseRevokeProviderError(
      "The private Base provider returned invalid verification data.",
      502
    );
  }

  const approvals = request.approvals.map((approval, index) => ({
    id: approval.id,
    state: results[index]?.success
      ? decodeRevokeState(approval, results[index].returnData)
      : ("unverified" as const),
  }));
  return {
    status: "confirmed",
    transactionHashes: request.transactionHashes,
    blockNumber: Number(blockNumber),
    clearedIds: approvals.flatMap((approval) =>
      approval.state === "cleared" ? [approval.id] : []
    ),
    approvals,
  };
}
