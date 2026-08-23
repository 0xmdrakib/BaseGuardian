"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  useCapabilities,
  useConfig,
  useSendCalls,
  useWriteContract,
} from "wagmi";
import { waitForCallsStatus } from "wagmi/actions";
import { Card } from "@/components/shared/Card";
import { useSmartWalletInput } from "@/components/wallet/useSmartWalletInput";
import { useWallet } from "@/components/wallet/WalletContext";
import {
  createRevokeCall,
  erc20ApprovalAbi,
  erc721ApprovalAbi,
  nftOperatorApprovalAbi,
} from "@/lib/approvalActions";
import {
  approvalScanRequestReducer,
  approvalScanRequestUrl,
  initialApprovalScanRequestState,
  normalizeApprovalScanQuery,
  parseApprovalScanCache,
  parseApprovalScanResponse,
  removeApprovalItems,
  serializeApprovalScanCache,
} from "@/lib/approvalScanClient";
import {
  areAllApprovalIdsSelected,
  canRevokeSelectedApprovals,
  getAtomicCapabilityStatus,
  pruneSelectedApprovalIds,
  toggleAllApprovalIds,
} from "@/lib/approvalSelection";
import type { BaseApprovalItem, BaseApprovalScan } from "@/lib/approvalTypes";
import { getBuilderCodeDataSuffix } from "@/lib/builderCode";
import { BASE_MAINNET_CHAIN_ID } from "@/lib/baseChain";
import {
  createRevokeVerificationRequest,
  waitForPrivateRevokeVerification,
  type RevokeVerificationRequest,
} from "@/lib/revokeVerification";

type Confirmation = {
  approvals: BaseApprovalItem[];
  mode: "single" | "batch";
};

type ActionNotice = {
  kind: "pending" | "success" | "error";
  message: string;
  href?: string;
};

type PendingVerification = {
  request: RevokeVerificationRequest;
  approvals: BaseApprovalItem[];
  href: string;
};

const APPROVAL_CACHE_PREFIX = "baseguardian:approval-scan:v2:";
const APPROVAL_SCAN_TIMEOUT_MS = 55_000;

function readCachedApprovalScan(input: string) {
  if (typeof window === "undefined") return null;
  const key = `${APPROVAL_CACHE_PREFIX}${input}`;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const cached = parseApprovalScanCache(raw);
    if (!cached) window.localStorage.removeItem(key);
    return cached;
  } catch {
    return null;
  }
}

function writeCachedApprovalScan(
  keys: string[],
  scan: BaseApprovalScan,
  requiresFresh = false
) {
  if (typeof window === "undefined") return;
  try {
    const value = serializeApprovalScanCache(scan, Date.now(), requiresFresh);
    for (const key of new Set(keys.map(normalizeApprovalScanQuery))) {
      window.localStorage.setItem(`${APPROVAL_CACHE_PREFIX}${key}`, value);
    }
  } catch {
    // Storage is an optional speed-up; scans still work when it is unavailable.
  }
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function friendlyActionError(error: unknown) {
  if (!(error instanceof Error)) return "The wallet request failed.";
  if (error.name === "TimeoutError") {
    return "Base confirmation is taking longer than expected.";
  }
  const lower = error.message.toLowerCase();
  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("request rejected")
  ) {
    return "Wallet request cancelled.";
  }
  const firstLine = error.message.split("\n")[0]?.trim();
  return firstLine && firstLine.length <= 180
    ? firstLine
    : "The wallet request failed.";
}

function friendlyScanError(error: unknown) {
  if (!(error instanceof Error)) return "Approval scan failed.";
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return "The scan took too long. Please wait a moment and try again.";
  }
  return error.message || "Approval scan failed.";
}

export function SecurityTab() {
  const wallet = useWallet();
  const {
    connectedAddress,
    differsFromConnectedWallet,
    setValue: setApprovalAddress,
    useConnectedWallet: applyConnectedWallet,
    value: approvalAddress,
  } = useSmartWalletInput();
  const [scanState, dispatchScan] = useReducer(
    approvalScanRequestReducer,
    initialApprovalScanRequestState
  );
  const requestSequenceRef = useRef(0);
  const actionInFlightRef = useRef(false);
  const activeScanRef = useRef<{
    controller: AbortController;
    query: string;
    requestId: number;
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [pendingVerification, setPendingVerification] =
    useState<PendingVerification | null>(null);
  const config = useConfig();
  const writeContract = useWriteContract();
  const sendCalls = useSendCalls();
  const builderCodeDataSuffix = getBuilderCodeDataSuffix();
  const capabilities = useCapabilities({
    chainId: BASE_MAINNET_CHAIN_ID,
    query: {
      enabled: wallet.isConnected && wallet.isBase,
      retry: false,
      staleTime: 60_000,
    },
  });

  const currentInput = normalizeApprovalScanQuery(approvalAddress);
  const observedInputRef = useRef(currentInput);
  const visibleScan = scanState.query === currentInput ? scanState.scan : null;
  const visibleError =
    scanState.query === currentInput ? scanState.error : null;
  const loading = scanState.phase !== "idle";
  const scannedWalletConnected = Boolean(
    visibleScan &&
      connectedAddress &&
      visibleScan.address.toLowerCase() === connectedAddress.toLowerCase()
  );
  const canManageApprovals = scannedWalletConnected && wallet.isBase;
  const atomicStatus = getAtomicCapabilityStatus(capabilities.data?.atomic);
  const batchSupported =
    atomicStatus === "supported" || atomicStatus === "ready";
  const batchCapabilityChecking =
    wallet.isConnected &&
    wallet.isBase &&
    !atomicStatus &&
    (capabilities.isPending || capabilities.isFetching);
  const batchCapabilityError = capabilities.isError && !atomicStatus;
  const actionableApprovals = useMemo(
    () =>
      visibleScan?.approvals.filter(
        (approval) => approval.verification === "verified"
      ) ?? [],
    [visibleScan]
  );
  const pendingVerificationIds = useMemo(
    () =>
      new Set(
        pendingVerification?.approvals.map((approval) => approval.id) ?? []
      ),
    [pendingVerification]
  );
  const selectableApprovals = useMemo(
    () =>
      actionableApprovals.filter(
        (approval) => !pendingVerificationIds.has(approval.id)
      ),
    [actionableApprovals, pendingVerificationIds]
  );
  const selectedApprovals = useMemo(
    () => selectableApprovals.filter((approval) => selected.has(approval.id)),
    [selectableApprovals, selected]
  );
  const revokeUrl = visibleScan
    ? `https://revoke.cash/address/${visibleScan.address}?chain=base`
    : currentInput
      ? `https://revoke.cash/address/${encodeURIComponent(approvalAddress.trim())}?chain=base`
      : "https://revoke.cash/?chain=base";

  const cancelActiveScan = useCallback(() => {
    const active = activeScanRef.current;
    if (!active) return;
    activeScanRef.current = null;
    active.controller.abort();
    dispatchScan({ type: "cancel", requestId: active.requestId });
  }, []);

  const clearForInputChange = useCallback(
    (nextInput: string) => {
      const normalized = normalizeApprovalScanQuery(nextInput);
      if (normalized === observedInputRef.current) return;
      observedInputRef.current = normalized;
      cancelActiveScan();
      dispatchScan({ type: "reset" });
      setSelected(new Set());
      setConfirmation(null);
      setNotice(null);
      setPendingVerification(null);
    },
    [cancelActiveScan]
  );

  useEffect(() => {
    if (observedInputRef.current !== currentInput) {
      clearForInputChange(approvalAddress);
    }
  }, [approvalAddress, clearForInputChange, currentInput]);

  useEffect(
    () => () => {
      activeScanRef.current?.controller.abort();
      activeScanRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (canManageApprovals) return;
    // External wallet account/network changes invalidate any pending selection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set());
    setConfirmation(null);
    if (
      pendingVerification &&
      (!connectedAddress ||
        pendingVerification.request.owner.toLowerCase() !==
          connectedAddress.toLowerCase())
    ) {
      setPendingVerification(null);
      setNotice(null);
    }
  }, [canManageApprovals, connectedAddress, pendingVerification]);

  const runScan = useCallback(
    async (forceFresh = false) => {
      const trimmed = approvalAddress.trim();
      const normalizedInput = normalizeApprovalScanQuery(trimmed);
      setSelected(new Set());
      setNotice(null);
      if (!trimmed) {
        dispatchScan({
          type: "validation-failure",
          query: normalizedInput,
          error: "Paste a Base wallet address or supported name.",
        });
        return;
      }

      const currentRequest = activeScanRef.current;
      if (currentRequest?.query === normalizedInput) return;
      if (currentRequest) {
        currentRequest.controller.abort();
        dispatchScan({
          type: "cancel",
          requestId: currentRequest.requestId,
        });
      }

      const cached = readCachedApprovalScan(normalizedInput);
      const requiresFresh = forceFresh || cached?.requiresFresh === true;
      const requestId = ++requestSequenceRef.current;
      const controller = new AbortController();
      activeScanRef.current = { controller, query: normalizedInput, requestId };
      dispatchScan({
        type: "start",
        requestId,
        query: normalizedInput,
        cachedScan: cached?.scan,
      });

      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, APPROVAL_SCAN_TIMEOUT_MS);
      try {
        const response = await fetch(
          approvalScanRequestUrl(trimmed, requiresFresh),
          { signal: controller.signal }
        );
        const body = await parseApprovalScanResponse(response);
        if (
          controller.signal.aborted ||
          activeScanRef.current?.requestId !== requestId
        ) {
          return;
        }
        dispatchScan({
          type: "success",
          requestId,
          query: normalizedInput,
          scan: body,
        });
        writeCachedApprovalScan(
          [normalizedInput, body.address],
          body
        );
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return;
        const message = timedOut
          ? "The scan took too long. Please wait a moment and try again."
          : friendlyScanError(error);
        dispatchScan({
          type: "failure",
          requestId,
          query: normalizedInput,
          error: cached
            ? `${message} Showing the most recent saved scan.`
            : message,
        });
      } finally {
        window.clearTimeout(timeoutId);
        if (activeScanRef.current?.requestId === requestId) {
          activeScanRef.current = null;
        }
      }
    },
    [approvalAddress]
  );
  const closeConfirmation = useCallback(() => setConfirmation(null), []);

  const removeApprovals = useCallback(
    (ids: string[], expectedOwner: string) => {
      if (
        !scanState.scan ||
        scanState.scan.address.toLowerCase() !== expectedOwner.toLowerCase()
      ) {
        return;
      }
      const updated = removeApprovalItems(scanState.scan, ids);
      dispatchScan({
        type: "replace",
        query: scanState.query,
        scan: updated,
      });
      writeCachedApprovalScan(
        [scanState.query, updated.address],
        updated,
        true
      );
      setSelected((current) => pruneSelectedApprovalIds(current, ids));
    },
    [scanState.query, scanState.scan]
  );

  const openConfirmation = (approvals: BaseApprovalItem[]) => {
    if (!scannedWalletConnected) {
      setNotice({
        kind: "error",
        message: "Connect the scanned wallet before revoking permissions.",
      });
      return;
    }
    if (!wallet.isBase) {
      setNotice({ kind: "error", message: "Switch the wallet to Base first." });
      return;
    }
    const actionable = approvals.filter(
      (approval) => approval.verification === "verified"
    );
    if (!actionable.length) return;
    setConfirmation({
      approvals: actionable,
      mode: actionable.length > 1 ? "batch" : "single",
    });
    setNotice(null);
  };

  const confirmRevoke = async () => {
    if (
      actionInFlightRef.current ||
      !confirmation ||
      !wallet.address
    ) {
      return;
    }
    if (!scannedWalletConnected) {
      setConfirmation(null);
      setNotice({
        kind: "error",
        message: "The connected wallet no longer matches the scanned address.",
      });
      return;
    }
    if (!wallet.isBase) {
      setConfirmation(null);
      setNotice({ kind: "error", message: "Switch the wallet to Base first." });
      return;
    }
    const pendingConfirmation = confirmation;
    const owner = wallet.address;
    const connector = wallet.connector;
    const calls = pendingConfirmation.approvals.map(createRevokeCall);
    if (calls.length > 1 && !batchSupported) {
      setConfirmation(null);
      setNotice({
        kind: "error",
        message:
          "This wallet does not support atomic batches. Revoke one item at a time.",
      });
      return;
    }

    const submittedIds = pendingConfirmation.approvals.map(
      (approval) => approval.id
    );
    actionInFlightRef.current = true;
    setActionPending(true);
    setConfirmation(null);
    setNotice({ kind: "pending", message: "Opening your wallet…" });
    let submittedTransactionHref: string | undefined;
    let verificationRetryAvailable = false;
    try {
      if (calls.length === 1) {
        const approval = pendingConfirmation.approvals[0];
        setNotice({
          kind: "pending",
          message: "Confirm the revoke in your wallet…",
        });
        const hash =
          approval.kind === "erc20"
            ? await writeContract.writeContractAsync({
                address: approval.token.address,
                abi: erc20ApprovalAbi,
                functionName: "approve",
                args: [approval.delegate.address, 0n],
                account: owner,
                chainId: BASE_MAINNET_CHAIN_ID,
                ...(builderCodeDataSuffix
                  ? { dataSuffix: builderCodeDataSuffix }
                  : {}),
              })
            : approval.kind === "erc721-token"
              ? await writeContract.writeContractAsync({
                  address: approval.token.address,
                  abi: erc721ApprovalAbi,
                  functionName: "approve",
                  args: [
                    "0x0000000000000000000000000000000000000000",
                    BigInt(approval.tokenId!),
                  ],
                  account: owner,
                  chainId: BASE_MAINNET_CHAIN_ID,
                  ...(builderCodeDataSuffix
                    ? { dataSuffix: builderCodeDataSuffix }
                    : {}),
                })
              : await writeContract.writeContractAsync({
                  address: approval.token.address,
                  abi: nftOperatorApprovalAbi,
                  functionName: "setApprovalForAll",
                  args: [approval.delegate.address, false],
                  account: owner,
                  chainId: BASE_MAINNET_CHAIN_ID,
                  ...(builderCodeDataSuffix
                    ? { dataSuffix: builderCodeDataSuffix }
                    : {}),
                });
        submittedTransactionHref = `https://basescan.org/tx/${hash}`;
        const verificationRequest = createRevokeVerificationRequest(
          [hash],
          owner,
          pendingConfirmation.approvals
        );
        setPendingVerification({
          request: verificationRequest,
          approvals: pendingConfirmation.approvals,
          href: submittedTransactionHref,
        });
        verificationRetryAvailable = true;
        setNotice({
          kind: "pending",
          message: "Revoke submitted. Waiting for Base confirmation…",
          href: submittedTransactionHref,
        });
        const verification = await waitForPrivateRevokeVerification(
          verificationRequest
        );
        if (verification.status === "reverted") {
          verificationRetryAvailable = false;
          setPendingVerification(null);
          throw new Error("The revoke transaction reverted.");
        }
        const clearedIds = verification.clearedIds;
        if (clearedIds.length !== submittedIds.length) {
          if (
            !verification.approvals.some(
              (approval) => approval.state === "unverified"
            )
          ) {
            verificationRetryAvailable = false;
            setPendingVerification(null);
          }
          throw new Error(
            "The transaction confirmed, but the permission is still active or could not be verified. It was not removed."
          );
        }
        removeApprovals(clearedIds, owner);
        verificationRetryAvailable = false;
        setPendingVerification(null);
        setNotice({
          kind: "success",
          message:
            "Approval revoked and confirmed on Base. Results updated without rescanning.",
          href: submittedTransactionHref,
        });
      } else {
        setNotice({
          kind: "pending",
          message: "Confirm the atomic batch in your wallet…",
        });
        const result = await sendCalls.sendCallsAsync({
          account: owner,
          chainId: BASE_MAINNET_CHAIN_ID,
          calls: calls.map((call) => ({ to: call.to, data: call.data })),
          forceAtomic: true,
          ...(builderCodeDataSuffix
            ? {
                capabilities: {
                  dataSuffix: {
                    value: builderCodeDataSuffix,
                    optional: true,
                  },
                },
              }
            : {}),
        });
        setNotice({
          kind: "pending",
          message: "Batch submitted. Waiting for Base confirmation…",
        });
        const status = await waitForCallsStatus(config, {
          id: result.id,
          connector,
          pollingInterval: 1_500,
          timeout: 120_000,
        });
        if (status.status !== "success") throw new Error("The batch revoke failed.");
        const transactionHashes = [
          ...new Set(
            status.receipts
              ?.map((receipt) => receipt.transactionHash)
              .filter((hash): hash is `0x${string}` => Boolean(hash)) ?? []
          ),
        ];
        if (!transactionHashes.length) {
          throw new Error(
            "The wallet confirmed the batch, but did not provide a transaction receipt for independent verification. No rows were removed."
          );
        }
        submittedTransactionHref = `https://basescan.org/tx/${transactionHashes[0]}`;
        const verificationRequest = createRevokeVerificationRequest(
          transactionHashes,
          owner,
          pendingConfirmation.approvals
        );
        setPendingVerification({
          request: verificationRequest,
          approvals: pendingConfirmation.approvals,
          href: submittedTransactionHref,
        });
        verificationRetryAvailable = true;
        setNotice({
          kind: "pending",
          message: "Batch confirmed. Verifying each permission is cleared…",
          href: submittedTransactionHref,
        });
        const verification = await waitForPrivateRevokeVerification(
          verificationRequest
        );
        if (verification.status === "reverted") {
          verificationRetryAvailable = false;
          setPendingVerification(null);
          throw new Error("The batch revoke transaction reverted.");
        }
        const clearedIds = verification.clearedIds;
        if (clearedIds.length) removeApprovals(clearedIds, owner);
        if (clearedIds.length !== submittedIds.length) {
          if (
            !verification.approvals.some(
              (approval) => approval.state === "unverified"
            )
          ) {
            verificationRetryAvailable = false;
            setPendingVerification(null);
          }
          throw new Error(
            `${submittedIds.length - clearedIds.length} permission${submittedIds.length - clearedIds.length === 1 ? " is" : "s are"} still active or could not be verified.`
          );
        }
        verificationRetryAvailable = false;
        setPendingVerification(null);
        setNotice({
          kind: "success",
          message:
            "Selected approvals were revoked and confirmed on Base. Results updated without rescanning.",
          href: submittedTransactionHref,
        });
      }
    } catch (error) {
      setConfirmation(null);
      const message = friendlyActionError(error);
      setNotice({
        kind: "error",
        message: verificationRetryAvailable
          ? `${message} The permission remains visible until private-RPC verification succeeds.`
          : message,
        href: submittedTransactionHref,
      });
    } finally {
      actionInFlightRef.current = false;
      setActionPending(false);
    }
  };

  const retryPendingVerification = async () => {
    if (!pendingVerification || actionInFlightRef.current) return;
    const pending = pendingVerification;
    let retryAvailable = true;
    actionInFlightRef.current = true;
    setActionPending(true);
    setNotice({
      kind: "pending",
      message: "Retrying confirmation through the private Base RPC…",
      href: pending.href,
    });
    try {
      const verification = await waitForPrivateRevokeVerification(
        pending.request
      );
      if (verification.status === "reverted") {
        retryAvailable = false;
        setPendingVerification(null);
        throw new Error("The revoke transaction reverted.");
      }

      if (verification.clearedIds.length) {
        removeApprovals(verification.clearedIds, pending.request.owner);
      }
      if (verification.clearedIds.length !== pending.approvals.length) {
        retryAvailable = verification.approvals.some(
          (approval) => approval.state === "unverified"
        );
        if (!retryAvailable) setPendingVerification(null);
        throw new Error(
          `${pending.approvals.length - verification.clearedIds.length} permission${pending.approvals.length - verification.clearedIds.length === 1 ? " is" : "s are"} still active or could not be verified.`
        );
      }

      retryAvailable = false;
      setPendingVerification(null);
      setNotice({
        kind: "success",
        message:
          "Approval state confirmed through the private Base RPC. Results updated without rescanning.",
        href: pending.href,
      });
    } catch (error) {
      const message = friendlyActionError(error);
      setNotice({
        kind: "error",
        message: retryAvailable
          ? `${message} No transaction was resent; you can retry verification safely.`
          : message,
        href: pending.href,
      });
    } finally {
      actionInFlightRef.current = false;
      setActionPending(false);
    }
  };

  const actionableApprovalIds = selectableApprovals.map(
    (approval) => approval.id
  );
  const allActionableSelected = areAllApprovalIdsSelected(
    actionableApprovalIds,
    selected
  );
  const transactionBusy = actionPending || Boolean(pendingVerification);
  const busy = transactionBusy || loading;
  const canRevokeSelected = canRevokeSelectedApprovals({
    batchSupported,
    busy,
    canManageApprovals,
    selectedCount: selectedApprovals.length,
  });
  const selectedAllForBatch =
    allActionableSelected && selectedApprovals.length > 1;
  const batchCapabilityMessage = batchCapabilityChecking
    ? "Checking one-click revoke-all support…"
    : batchCapabilityError
      ? "Could not check one-click revoke-all support. Individual Revoke buttons still work."
      : atomicStatus === "ready"
        ? `${wallet.connector?.name ?? "Your wallet"} may ask to enable atomic batching, then revoke all in one confirmation.`
        : atomicStatus === "supported"
          ? "One-click atomic revoke-all is available."
          : selectedApprovals.length > 1
            ? `${wallet.connector?.name ?? "This wallet"} reported no atomic revoke-all support. Use each row’s Revoke button.`
            : selectedApprovals.length === 1
              ? "Single revoke ready."
              : "Select one or more permissions.";

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="Approval Guardian"
        description="Find active standard token and NFT permissions on Base."
        footer="Exposure labels describe permission scope, not whether a delegate is malicious."
      >
        <div className="space-y-3 text-[11px]">
          <p className="text-white/55">
            Scan any wallet without connecting. Connect the same wallet only when
            you want to revoke a verified permission.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              placeholder="0x… or name.base.eth"
              className="input flex-1"
              value={approvalAddress}
              onChange={(event) => {
                const nextValue = event.target.value;
                clearForInputChange(nextValue);
                setApprovalAddress(nextValue);
              }}
              disabled={actionPending}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !loading &&
                  !actionPending
                ) {
                  void runScan(Boolean(visibleScan));
                }
              }}
            />
            <button
              type="button"
              onClick={() => void runScan(Boolean(visibleScan))}
              disabled={loading || actionPending}
              className="btn btn-primary"
            >
              {loading
                ? visibleScan
                  ? "Refreshing…"
                  : "Scanning…"
                : visibleScan
                  ? "Refresh scan"
                  : "Scan approvals"}
            </button>
          </div>

          {connectedAddress && differsFromConnectedWallet && (
            <button
              type="button"
              onClick={() => {
                clearForInputChange(connectedAddress);
                applyConnectedWallet();
              }}
              className="text-[10px] font-medium text-blue-300 transition hover:text-blue-200"
            >
              Use connected wallet
            </button>
          )}
          {loading && (
            <div
              className="subpanel flex items-center gap-2 text-white/60"
              role="status"
            >
              <span className="wallet-spinner" aria-hidden="true" />
              {visibleScan
                ? "Refreshing current permissions in the background…"
                : "Discovering history and verifying current permissions…"}
            </div>
          )}
          {visibleError && (
            <p
              className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-rose-200"
              role="alert"
            >
              {visibleError}
            </p>
          )}
        </div>
      </Card>

      {pendingVerification && (
        <div
          className="subpanel flex flex-col gap-2 border-blue-400/20 bg-blue-400/5 text-[11px] sm:flex-row sm:items-center"
          role="status"
        >
          <div className="min-w-0 flex-1">
            <strong className="text-white/80">
              {actionPending
                ? "Checking the confirmed transaction…"
                : "Transaction submitted; state verification needs another check."}
            </strong>
            <p className="mt-0.5 text-white/50">
              No transaction will be sent again. The permission stays visible
              until its current onchain state is confirmed.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <a
              className="btn btn-ghost text-[10px]"
              href={pendingVerification.href}
              target="_blank"
              rel="noreferrer"
            >
              View transaction
            </a>
            <button
              type="button"
              className="btn btn-ghost text-[10px]"
              onClick={() => void retryPendingVerification()}
              disabled={actionPending}
            >
              Retry check
            </button>
            {!actionPending && (
              <button
                type="button"
                className="btn btn-ghost text-[10px]"
                onClick={() => {
                  setPendingVerification(null);
                  setNotice(null);
                }}
              >
                Stop tracking
              </button>
            )}
          </div>
        </div>
      )}

      {visibleScan && (
        <>
          <ApprovalSummary scan={visibleScan} />

          {visibleScan.approvals.length === 0 &&
            visibleScan.coverage.status === "complete" && (
              <Card
                title="No active standard approvals found"
                description="Current standard ERC-20 and NFT permissions from the scanned history are clear."
              >
                <p className="text-[11px] text-white/55">
                  Permit2 internal permissions and non-standard approval systems are
                  outside this scan.
                </p>
              </Card>
            )}

          {visibleScan.approvals.length > 0 && (
            <Card
              title="Active permissions"
              description={`${visibleScan.approvals.length} current permission${visibleScan.approvals.length === 1 ? "" : "s"} found.`}
            >
              <div className="space-y-2">
                {visibleScan.approvals.map((approval) => (
                  <ApprovalRow
                    key={approval.id}
                    approval={approval}
                    checked={selected.has(approval.id)}
                    canAct={canManageApprovals}
                    busy={busy || pendingVerificationIds.has(approval.id)}
                    onChecked={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(approval.id);
                        else next.delete(approval.id);
                        return next;
                      })
                    }
                    onRevoke={() => openConfirmation([approval])}
                  />
                ))}
              </div>

              {selectableApprovals.length > 0 && canManageApprovals && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-pressed={allActionableSelected}
                    onClick={() =>
                      setSelected((current) =>
                        toggleAllApprovalIds(actionableApprovalIds, current)
                      )
                    }
                    disabled={busy}
                  >
                    {allActionableSelected ? "Unselect all" : "Select all"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!canRevokeSelected}
                    onClick={() => openConfirmation(selectedApprovals)}
                    aria-describedby="revoke-batch-capability"
                  >
                    {`${selectedAllForBatch ? "Revoke all" : "Revoke selected"} (${selectedApprovals.length})`}
                  </button>
                  <span
                    id="revoke-batch-capability"
                    className="text-[10px] text-white/45"
                    aria-live="polite"
                  >
                    {batchCapabilityMessage}
                  </span>
                  {batchCapabilityError && (
                    <button
                      type="button"
                      className="text-[10px] font-medium text-blue-300 hover:text-blue-200"
                      onClick={() => void capabilities.refetch()}
                    >
                      Retry support check
                    </button>
                  )}
                </div>
              )}

              {!wallet.isConnected && (
                <button
                  type="button"
                  className="btn btn-ghost mt-3"
                  onClick={wallet.openWalletPicker}
                >
                  Connect scanned wallet to revoke
                </button>
              )}
              {wallet.isConnected && !scannedWalletConnected && (
                <p className="mt-3 text-[10px] text-amber-200/80">
                  Connected wallet does not match the scanned address. Read-only
                  results remain available.
                </p>
              )}
              {scannedWalletConnected && !wallet.isBase && (
                <button
                  type="button"
                  className="btn btn-ghost mt-3"
                  onClick={() => void wallet.switchToBase()}
                >
                  Switch to Base to revoke
                </button>
              )}
            </Card>
          )}

          <a
            href={revokeUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost self-start text-[10px]"
          >
            Advanced check on revoke.cash ↗
          </a>
        </>
      )}

      {notice &&
        typeof document !== "undefined" &&
        createPortal(
          <ActionNoticeToast
            notice={notice}
            onDismiss={() => setNotice(null)}
          />,
          document.body
        )}

      {confirmation &&
        typeof document !== "undefined" &&
        createPortal(
          <RevokeConfirmation
            confirmation={confirmation}
            batchSupported={batchSupported}
            onCancel={closeConfirmation}
            onConfirm={() => void confirmRevoke()}
          />,
          document.body
        )}
    </div>
  );
}

function ActionNoticeToast({
  notice,
  onDismiss,
}: {
  notice: ActionNotice;
  onDismiss: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-4 z-[80] mx-auto max-w-[520px]">
      <div
        className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3 text-[11px] shadow-2xl backdrop-blur-xl ${
          notice.kind === "error"
            ? "border-rose-400/30 bg-[#24171d]/95 text-rose-100"
            : notice.kind === "success"
              ? "border-emerald-400/30 bg-[#13231d]/95 text-emerald-100"
              : "border-blue-400/30 bg-[#121d2e]/95 text-blue-100"
        }`}
        role={notice.kind === "error" ? "alert" : "status"}
        aria-live={notice.kind === "error" ? "assertive" : "polite"}
      >
        {notice.kind === "pending" && (
          <span className="wallet-spinner mt-0.5 shrink-0" aria-hidden="true" />
        )}
        <p className="min-w-0 flex-1">
          {notice.message}{" "}
          {notice.href && (
            <a
              className="link whitespace-nowrap"
              href={notice.href}
              target="_blank"
              rel="noreferrer"
            >
              View transaction
            </a>
          )}
        </p>
        {notice.kind !== "pending" && (
          <button
            type="button"
            className="-my-1 shrink-0 rounded-lg px-2 py-1 text-white/55 hover:bg-white/10 hover:text-white"
            onClick={onDismiss}
            aria-label="Dismiss message"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function ApprovalSummary({ scan }: { scan: BaseApprovalScan }) {
  const partialWithoutFindings =
    scan.coverage.status === "partial" && scan.approvals.length === 0;
  const metric = (value: number) => (partialWithoutFindings ? "—" : value);
  const suffix = scan.coverage.status === "partial" ? " found" : "";
  return (
    <Card
      title="Approval exposure"
      description={`Snapshot at Base block ${scan.snapshotBlock.toLocaleString()}`}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryMetric
          label={`Active${suffix}`}
          value={metric(scan.summary.active)}
        />
        <SummaryMetric
          label={`High exposure${suffix}`}
          value={metric(scan.summary.highExposure)}
        />
        <SummaryMetric
          label={`Unlimited${suffix}`}
          value={metric(scan.summary.unlimited)}
        />
        <SummaryMetric
          label={`NFT operators${suffix}`}
          value={metric(scan.summary.nftOperators)}
        />
      </div>
      <div
        className={`mt-3 rounded-xl border p-3 text-[10px] leading-relaxed ${
          scan.coverage.status === "partial"
            ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
            : "border-emerald-300/15 bg-emerald-300/5 text-white/55"
        }`}
      >
        <strong className="block text-white/80">
          {scan.coverage.status === "complete"
            ? "Standard scan complete"
            : "Partial scan — more approvals may exist"}
        </strong>
        {scan.coverage.message}
        {scan.permit2.detected && (
          <span className="mt-1 block text-blue-200">{scan.permit2.note}</span>
        )}
      </div>
    </Card>
  );
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="metric">
      <div className="text-[9px] text-white/45">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-white/90">{value}</div>
    </div>
  );
}

function ApprovalRow({
  approval,
  busy,
  canAct,
  checked,
  onChecked,
  onRevoke,
}: {
  approval: BaseApprovalItem;
  busy: boolean;
  canAct: boolean;
  checked: boolean;
  onChecked: (checked: boolean) => void;
  onRevoke: () => void;
}) {
  const title =
    approval.token.name ??
    approval.token.symbol ??
    shortAddress(approval.token.address);
  const scope =
    approval.kind === "nft-operator"
      ? "All collection NFTs"
      : approval.kind === "erc721-token"
        ? `NFT #${approval.tokenId}`
        : approval.value.unlimited
          ? "Unlimited allowance"
          : `${approval.value.display ?? approval.value.raw ?? "Unknown"} ${approval.token.symbol ?? "tokens"}`;
  const actionable = approval.verification === "verified";

  return (
    <article className="subpanel space-y-2">
      <div className="flex items-start gap-2">
        {actionable && canAct && (
          <input
            type="checkbox"
            checked={checked}
            disabled={busy}
            onChange={(event) => onChecked(event.target.checked)}
            aria-label={`Select ${title} approval`}
            className="mt-1 h-4 w-4 accent-blue-500"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="truncate text-[11px] text-white/90">
              {title}
            </strong>
            <span
              className={`badge ${
                approval.exposure === "high"
                  ? "border-rose-300/20 bg-rose-300/10 text-rose-200"
                  : approval.exposure === "medium"
                    ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
                    : "border-white/10 bg-white/5 text-white/55"
              }`}
            >
              {approval.exposure === "unknown"
                ? "Unverified"
                : `${approval.exposure} exposure`}
            </span>
            {approval.permit2 && (
              <span className="badge border-blue-300/20 bg-blue-300/10 text-blue-100">
                Permit2
              </span>
            )}
          </div>
          <p className="mt-1 text-[10px] text-white/55">{scope}</p>
        </div>
        {actionable && canAct && (
          <button
            type="button"
            className="btn btn-ghost shrink-0 px-2 py-1 text-[10px] text-rose-100"
            onClick={onRevoke}
            disabled={busy}
          >
            Revoke
          </button>
        )}
      </div>
      <dl className="grid gap-1 text-[9px] text-white/45 sm:grid-cols-2">
        <div>
          <dt className="inline">Delegate: </dt>
          <dd className="inline text-white/65" title={approval.delegate.address}>
            {shortAddress(approval.delegate.address)} · {approval.delegate.type}
          </dd>
        </div>
        <div>
          <dt className="inline">Asset: </dt>
          <dd className="inline text-white/65">
            <a
              className="link"
              href={`https://basescan.org/address/${approval.token.address}`}
              target="_blank"
              rel="noreferrer"
            >
              {approval.token.standard} · {shortAddress(approval.token.address)}
            </a>
          </dd>
        </div>
      </dl>
      <ul className="space-y-0.5 text-[9px] text-white/45">
        {approval.reasons.map((reason) => (
          <li key={reason}>• {reason}</li>
        ))}
      </ul>
      <a
        className="link inline-block text-[9px] text-blue-200/80"
        href={`https://basescan.org/tx/${approval.lastApproval.transactionHash}`}
        target="_blank"
        rel="noreferrer"
      >
        Last approval transaction ↗
      </a>
    </article>
  );
}

function RevokeConfirmation({
  batchSupported,
  confirmation,
  onCancel,
  onConfirm,
}: {
  batchSupported: boolean;
  confirmation: Confirmation;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex='-1'])"
        ) ?? []
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

  const calls = confirmation.approvals.map(createRevokeCall);
  return (
    <div
      className="wallet-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="wallet-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="revoke-confirm-title"
      >
        <div className="wallet-modal-header">
          <div>
            <span>ONCHAIN CONFIRMATION</span>
            <h2 id="revoke-confirm-title">
              {calls.length === 1
                ? "Revoke permission"
                : "Revoke selected permissions"}
            </h2>
            <p>Review the exact changes before opening your wallet.</p>
          </div>
          <button
            className="wallet-modal-close"
            onClick={onCancel}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="space-y-2 px-[18px] pb-4">
          {calls.map((call, index) => (
            <div key={`${call.to}:${index}`} className="subpanel text-[11px]">
              <strong className="text-white/85">{call.label}</strong>
              <dl className="mt-2 grid gap-1 text-[9px] text-white/50">
                <div>
                  <dt className="inline text-white/35">Asset: </dt>
                  <dd className="inline text-white/65">
                    {confirmation.approvals[index].token.name ??
                      confirmation.approvals[index].token.symbol ??
                      shortAddress(call.to)}{" "}
                    ({confirmation.approvals[index].token.standard})
                  </dd>
                </div>
                <div className="break-all">
                  <dt className="inline text-white/35">Delegate: </dt>
                  <dd className="inline text-white/65">
                    {confirmation.approvals[index].delegate.address}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-white/35">Operation: </dt>
                  <dd className="inline font-mono text-white/65">
                    {confirmation.approvals[index].kind === "erc20"
                      ? "approve(delegate, 0)"
                      : confirmation.approvals[index].kind === "erc721-token"
                        ? `approve(0x0, #${confirmation.approvals[index].tokenId})`
                        : "setApprovalForAll(delegate, false)"}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-white/35">Network / value: </dt>
                  <dd className="inline text-white/65">Base mainnet · 0 ETH</dd>
                </div>
              </dl>
            </div>
          ))}
          {calls.length > 1 && !batchSupported && (
            <p className="text-[10px] text-amber-200">
              This wallet does not support atomic batches. Revoke items
              individually.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 px-[18px] py-4">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={calls.length > 1 && !batchSupported}
          >
            Continue in wallet
          </button>
        </div>
      </div>
    </div>
  );
}
