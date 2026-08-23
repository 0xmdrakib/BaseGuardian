import {
  getAddress,
  isAddress,
  isHash,
  maxUint256,
  type Address,
  type Hex,
} from "viem";
import type { BaseApprovalItem } from "./approvalTypes";

export const MAX_REVOKE_VERIFICATION_ITEMS = 50;
export const MAX_REVOKE_TRANSACTION_HASHES = 10;

export type RevokeVerificationItem = {
  id: string;
  kind: BaseApprovalItem["kind"];
  token: { address: Address };
  delegate: { address: Address };
  tokenId: string | null;
};

export type RevokeVerificationRequest = {
  transactionHashes: Hex[];
  owner: Address;
  approvals: RevokeVerificationItem[];
};

export type RevokeVerificationState = "cleared" | "active" | "unverified";

export type RevokeVerificationResult =
  | {
      status: "pending";
      transactionHashes: Hex[];
      retryAfter: number;
    }
  | {
      status: "reverted";
      transactionHashes: Hex[];
    }
  | {
      status: "confirmed";
      transactionHashes: Hex[];
      blockNumber: number;
      clearedIds: string[];
      approvals: { id: string; state: RevokeVerificationState }[];
    };

export function createRevokeVerificationRequest(
  transactionHashes: readonly Hex[],
  owner: Address,
  approvals: readonly BaseApprovalItem[]
): RevokeVerificationRequest {
  return {
    transactionHashes: [...transactionHashes],
    owner,
    approvals: approvals.map((approval) => ({
      id: approval.id,
      kind: approval.kind,
      token: { address: approval.token.address },
      delegate: { address: approval.delegate.address },
      tokenId: approval.tokenId,
    })),
  };
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function validTokenId(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,77})$/.test(value)) {
    return false;
  }
  try {
    return BigInt(value) <= maxUint256;
  } catch {
    return false;
  }
}

export function parseRevokeVerificationRequest(
  input: unknown
):
  | { ok: true; value: RevokeVerificationRequest }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Invalid revoke verification request." };
  }

  const body = input as Record<string, unknown>;
  if (!hasOnlyKeys(body, ["transactionHashes", "owner", "approvals"])) {
    return { ok: false, error: "Unexpected revoke verification field." };
  }
  if (
    !Array.isArray(body.transactionHashes) ||
    body.transactionHashes.length === 0 ||
    body.transactionHashes.length > MAX_REVOKE_TRANSACTION_HASHES ||
    body.transactionHashes.some(
      (hash) => typeof hash !== "string" || !isHash(hash)
    ) ||
    new Set(
      body.transactionHashes.map((hash) =>
        typeof hash === "string" ? hash.toLowerCase() : hash
      )
    ).size !== body.transactionHashes.length
  ) {
    return { ok: false, error: "Transaction hashes must be unique and valid." };
  }
  if (typeof body.owner !== "string" || !isAddress(body.owner)) {
    return { ok: false, error: "Owner must be a valid EVM address." };
  }
  if (
    !Array.isArray(body.approvals) ||
    body.approvals.length === 0 ||
    body.approvals.length > MAX_REVOKE_VERIFICATION_ITEMS
  ) {
    return {
      ok: false,
      error: `Approvals must contain 1-${MAX_REVOKE_VERIFICATION_ITEMS} items.`,
    };
  }

  const approvals: RevokeVerificationItem[] = [];
  const ids = new Set<string>();
  for (const inputItem of body.approvals) {
    if (!inputItem || typeof inputItem !== "object") {
      return { ok: false, error: "Approval verification item is invalid." };
    }
    const item = inputItem as Record<string, unknown>;
    const token = item.token as Record<string, unknown> | undefined;
    const delegate = item.delegate as Record<string, unknown> | undefined;
    if (
      !hasOnlyKeys(item, ["id", "kind", "token", "delegate", "tokenId"]) ||
      !token ||
      !hasOnlyKeys(token, ["address"]) ||
      !delegate ||
      !hasOnlyKeys(delegate, ["address"])
    ) {
      return { ok: false, error: "Unexpected approval verification field." };
    }
    if (
      typeof item.id !== "string" ||
      item.id.length === 0 ||
      item.id.length > 200 ||
      ids.has(item.id)
    ) {
      return { ok: false, error: "Approval IDs must be unique and valid." };
    }
    if (
      item.kind !== "erc20" &&
      item.kind !== "erc721-token" &&
      item.kind !== "nft-operator"
    ) {
      return { ok: false, error: "Approval kind is not supported." };
    }
    if (
      typeof token.address !== "string" ||
      !isAddress(token.address) ||
      typeof delegate.address !== "string" ||
      !isAddress(delegate.address)
    ) {
      return {
        ok: false,
        error: "Approval token and delegate addresses must be valid.",
      };
    }
    if (
      (item.kind === "erc721-token" && !validTokenId(item.tokenId)) ||
      (item.kind !== "erc721-token" && item.tokenId !== null)
    ) {
      return { ok: false, error: "Approval token ID is invalid." };
    }

    const canonicalId =
      item.kind === "erc721-token"
        ? `erc721-token:${token.address.toLowerCase()}:${item.tokenId}`
        : `${item.kind}:${token.address.toLowerCase()}:${delegate.address.toLowerCase()}`;
    if (item.id !== canonicalId) {
      return { ok: false, error: "Approval ID does not match its permission." };
    }

    ids.add(item.id);
    approvals.push({
      id: item.id,
      kind: item.kind,
      token: { address: getAddress(token.address) },
      delegate: { address: getAddress(delegate.address) },
      tokenId: item.tokenId as string | null,
    });
  }

  return {
    ok: true,
    value: {
      transactionHashes: body.transactionHashes as Hex[],
      owner: getAddress(body.owner),
      approvals,
    },
  };
}

function sameHashes(actual: unknown, expected: readonly Hex[]) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every(
      (hash, index) =>
        typeof hash === "string" &&
        hash.toLowerCase() === expected[index].toLowerCase()
    )
  );
}

function parseVerificationResult(
  input: unknown,
  request: RevokeVerificationRequest
): RevokeVerificationResult | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (!sameHashes(value.transactionHashes, request.transactionHashes)) {
    return null;
  }
  if (
    value.status === "pending" &&
    typeof value.retryAfter === "number" &&
    value.retryAfter >= 1
  ) {
    return value as RevokeVerificationResult;
  }
  if (value.status === "reverted") {
    return value as RevokeVerificationResult;
  }
  if (
    value.status !== "confirmed" ||
    typeof value.blockNumber !== "number" ||
    !Number.isSafeInteger(value.blockNumber) ||
    value.blockNumber < 0 ||
    !Array.isArray(value.clearedIds) ||
    !Array.isArray(value.approvals)
  ) {
    return null;
  }

  const expectedIds = new Set(request.approvals.map((approval) => approval.id));
  const approvals = value.approvals as Record<string, unknown>[];
  const clearedIds = value.clearedIds as unknown[];
  const clearedFromStates = approvals
    .filter((approval) => approval?.state === "cleared")
    .map((approval) => approval.id);
  if (
    approvals.length !== expectedIds.size ||
    approvals.some(
      (approval) =>
        !approval ||
        typeof approval.id !== "string" ||
        !expectedIds.has(approval.id) ||
        (approval.state !== "cleared" &&
          approval.state !== "active" &&
          approval.state !== "unverified")
    ) ||
    new Set(approvals.map((approval) => approval.id)).size !== approvals.length ||
    clearedIds.some(
      (approvalId) =>
        typeof approvalId !== "string" || !expectedIds.has(approvalId)
    ) ||
    new Set(clearedIds).size !== clearedIds.length ||
    clearedFromStates.length !== clearedIds.length ||
    clearedFromStates.some((approvalId) => !clearedIds.includes(approvalId))
  ) {
    return null;
  }
  return value as RevokeVerificationResult;
}

function wait(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForPrivateRevokeVerification(
  request: RevokeVerificationRequest,
  options: {
    fetchFn?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<Exclude<RevokeVerificationResult, { status: "pending" }>> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const verificationBackoffMs = [1_500, 3_000, 6_000, 10_000] as const;
  let unverifiedRetry = 0;
  let providerRetry = 0;

  while (!signal.aborted) {
    let response: Response;
    let json: unknown;
    try {
      response = await fetchFn("/api/base/revoke-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });
      const text = await response.text();
      if (!text) {
        json = null;
      } else {
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          json = null;
        }
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw error;
    }

    const result = parseVerificationResult(json, request);
    if (
      response.ok &&
      result?.status === "reverted"
    ) {
      return result;
    }
    if (response.ok && result?.status === "confirmed") {
      // A failed fixed-ABI child call can be caused by brief provider/indexing
      // lag after the receipt appears. Keep polling instead of presenting a
      // confirmed revoke as a permanent verification failure.
      if (!result.approvals.some((approval) => approval.state === "unverified")) {
        return result;
      }
      if (unverifiedRetry >= verificationBackoffMs.length) return result;
      await wait(verificationBackoffMs[unverifiedRetry], signal);
      unverifiedRetry += 1;
      continue;
    }

    const errorMessage =
      json &&
      typeof json === "object" &&
      typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : "Could not verify the Base transaction.";
    const retryAfterHeader = Number(response.headers.get("Retry-After"));
    const retryAfter =
      result?.status === "pending"
        ? result.retryAfter
        : Number.isFinite(retryAfterHeader) && retryAfterHeader >= 1
          ? retryAfterHeader
          : 0;
    if ((response.status === 202 || response.status === 429) && retryAfter > 0) {
      await wait(Math.min(retryAfter, 60) * 1_000, signal);
      continue;
    }
    if (
      (response.status === 502 ||
        response.status === 503 ||
        response.status === 504)
    ) {
      if (providerRetry >= verificationBackoffMs.length) {
        throw new Error(errorMessage);
      }
      const providerRetryAfter = retryAfter > 0 ? retryAfter : 3;
      const delayMs = Math.max(
        Math.min(providerRetryAfter, 60) * 1_000,
        verificationBackoffMs[providerRetry]
      );
      providerRetry += 1;
      await wait(delayMs, signal);
      continue;
    }
    throw new Error(errorMessage);
  }

  throw signal.reason;
}
