import type { BaseApprovalItem, BaseApprovalScan } from "@/lib/approvalTypes";

// Invalidate scans created by the former newest-250 transaction discovery.
export const APPROVAL_SCAN_CACHE_VERSION = 2;
export const APPROVAL_SCAN_CACHE_MAX_AGE_MS = 10 * 60_000;

export type ApprovalScanRequestState = {
  activeRequestId: number | null;
  error: string | null;
  phase: "idle" | "loading" | "refreshing";
  query: string;
  scan: BaseApprovalScan | null;
};

export type ApprovalScanRequestAction =
  | {
      type: "start";
      requestId: number;
      query: string;
      cachedScan?: BaseApprovalScan | null;
    }
  | {
      type: "success";
      requestId: number;
      query: string;
      scan: BaseApprovalScan;
    }
  | {
      type: "failure";
      requestId: number;
      query: string;
      error: string;
    }
  | { type: "validation-failure"; query: string; error: string }
  | { type: "cancel"; requestId: number }
  | { type: "reset" }
  | { type: "replace"; query: string; scan: BaseApprovalScan };

export const initialApprovalScanRequestState: ApprovalScanRequestState = {
  activeRequestId: null,
  error: null,
  phase: "idle",
  query: "",
  scan: null,
};

export function normalizeApprovalScanQuery(input: string) {
  return input.trim().toLowerCase();
}

export function approvalScanRequestReducer(
  state: ApprovalScanRequestState,
  action: ApprovalScanRequestAction
): ApprovalScanRequestState {
  switch (action.type) {
    case "start": {
      const retainedScan =
        action.cachedScan ?? (state.query === action.query ? state.scan : null);
      return {
        activeRequestId: action.requestId,
        error: null,
        phase: retainedScan ? "refreshing" : "loading",
        query: action.query,
        scan: retainedScan,
      };
    }
    case "success":
      if (
        state.activeRequestId !== action.requestId ||
        state.query !== action.query
      ) {
        return state;
      }
      return {
        activeRequestId: null,
        error: null,
        phase: "idle",
        query: action.query,
        scan: action.scan,
      };
    case "failure":
      if (
        state.activeRequestId !== action.requestId ||
        state.query !== action.query
      ) {
        return state;
      }
      return {
        ...state,
        activeRequestId: null,
        error: action.error,
        phase: "idle",
      };
    case "validation-failure":
      return {
        activeRequestId: null,
        error: action.error,
        phase: "idle",
        query: action.query,
        scan: null,
      };
    case "cancel":
      if (state.activeRequestId !== action.requestId) return state;
      return {
        ...state,
        activeRequestId: null,
        error: null,
        phase: "idle",
      };
    case "reset":
      return initialApprovalScanRequestState;
    case "replace":
      if (state.query !== action.query) return state;
      return { ...state, scan: action.scan };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isTransactionHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isApprovalItem(value: unknown): value is BaseApprovalItem {
  if (!isRecord(value)) return false;
  const token = value.token;
  const delegate = value.delegate;
  const approvalValue = value.value;
  const lastApproval = value.lastApproval;
  return (
    typeof value.id === "string" &&
    ["erc20", "erc721-token", "nft-operator"].includes(String(value.kind)) &&
    isRecord(token) &&
    isAddress(token.address) &&
    isNullableString(token.name) &&
    isNullableString(token.symbol) &&
    (token.decimals === null || isNonNegativeInteger(token.decimals)) &&
    ["ERC-20", "ERC-721", "ERC-721/ERC-1155"].includes(
      String(token.standard)
    ) &&
    isRecord(delegate) &&
    isAddress(delegate.address) &&
    ["contract", "eoa", "unknown"].includes(String(delegate.type)) &&
    isNullableString(value.tokenId) &&
    isRecord(approvalValue) &&
    isNullableString(approvalValue.raw) &&
    isNullableString(approvalValue.display) &&
    typeof approvalValue.unlimited === "boolean" &&
    ["high", "medium", "unknown"].includes(String(value.exposure)) &&
    Array.isArray(value.reasons) &&
    value.reasons.every((reason) => typeof reason === "string") &&
    ["verified", "unverified"].includes(String(value.verification)) &&
    typeof value.permit2 === "boolean" &&
    isRecord(lastApproval) &&
    isNonNegativeInteger(lastApproval.blockNumber) &&
    isTransactionHash(lastApproval.transactionHash)
  );
}

export function isBaseApprovalScan(value: unknown): value is BaseApprovalScan {
  if (!isRecord(value)) return false;
  const coverage = value.coverage;
  const summary = value.summary;
  const permit2 = value.permit2;
  return (
    isAddress(value.address) &&
    value.chain === "base-mainnet" &&
    isNonNegativeInteger(value.snapshotBlock) &&
    isRecord(coverage) &&
    ["complete", "partial"].includes(String(coverage.status)) &&
    coverage.fromBlock === 0 &&
    isNonNegativeInteger(coverage.toBlock) &&
    coverage.standardApprovals === true &&
    coverage.permit2 === "flag-only" &&
    typeof coverage.message === "string" &&
    isRecord(summary) &&
    isNonNegativeInteger(summary.active) &&
    isNonNegativeInteger(summary.unlimited) &&
    isNonNegativeInteger(summary.nftOperators) &&
    isNonNegativeInteger(summary.highExposure) &&
    isNonNegativeInteger(summary.unverified) &&
    Array.isArray(value.approvals) &&
    value.approvals.every(isApprovalItem) &&
    isRecord(permit2) &&
    typeof permit2.detected === "boolean" &&
    typeof permit2.note === "string"
  );
}

type ApprovalScanCacheEnvelope = {
  version: typeof APPROVAL_SCAN_CACHE_VERSION;
  savedAt: number;
  scan: BaseApprovalScan;
  requiresFresh: boolean;
};

export function serializeApprovalScanCache(
  scan: BaseApprovalScan,
  savedAt = Date.now(),
  requiresFresh = false
) {
  const envelope: ApprovalScanCacheEnvelope = {
    version: APPROVAL_SCAN_CACHE_VERSION,
    savedAt,
    scan,
    requiresFresh,
  };
  return JSON.stringify(envelope);
}

export function parseApprovalScanCache(
  raw: string,
  now = Date.now(),
  maxAgeMs = APPROVAL_SCAN_CACHE_MAX_AGE_MS
): ApprovalScanCacheEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== APPROVAL_SCAN_CACHE_VERSION) return null;
    if (typeof parsed.savedAt !== "number" || !Number.isFinite(parsed.savedAt)) {
      return null;
    }
    if (parsed.savedAt > now || now - parsed.savedAt > maxAgeMs) return null;
    if (!isBaseApprovalScan(parsed.scan)) return null;
    return {
      version: APPROVAL_SCAN_CACHE_VERSION,
      savedAt: parsed.savedAt,
      scan: parsed.scan,
      requiresFresh: parsed.requiresFresh === true,
    };
  } catch {
    return null;
  }
}

export function approvalScanRequestUrl(input: string, fresh = false) {
  return `/api/base/approvals?address=${encodeURIComponent(input)}${fresh ? "&fresh=1" : ""}`;
}

function retryAfterLabel(value: string | null, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return `${Math.max(1, Math.ceil(seconds))} seconds`;
  }
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return null;
  return `${Math.max(1, Math.ceil((retryAt - now) / 1000))} seconds`;
}

export async function parseApprovalScanResponse(response: Response) {
  const raw = await response.text();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    // Cloudflare and other gateways can return plain-text error responses.
  }

  if (!response.ok) {
    const jsonMessage =
      isRecord(parsed) && typeof parsed.error === "string"
        ? parsed.error.trim()
        : "";
    const plainMessage =
      raw && !raw.trimStart().startsWith("<")
        ? raw.replace(/\s+/g, " ").trim().slice(0, 180)
        : "";
    const detail = jsonMessage || plainMessage;
    const retryAfter = retryAfterLabel(response.headers.get("Retry-After"));
    const baseMessage = detail
      ? `Approval scan failed (HTTP ${response.status}): ${detail}`
      : `Approval scan failed with HTTP ${response.status}.`;
    throw new Error(
      response.status === 429 && retryAfter
        ? `${baseMessage} Try again in ${retryAfter}.`
        : baseMessage
    );
  }

  if (!isBaseApprovalScan(parsed)) {
    throw new Error("The approval service returned an invalid response.");
  }
  return parsed;
}

export function removeApprovalItems(
  scan: BaseApprovalScan,
  ids: readonly string[]
): BaseApprovalScan {
  const removed = new Set(ids);
  const approvals = scan.approvals.filter(
    (approval) => !removed.has(approval.id)
  );
  return {
    ...scan,
    approvals,
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
  };
}
