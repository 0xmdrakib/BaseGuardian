"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useCapabilities,
  useConfig,
  usePublicClient,
  useSendCalls,
  useWriteContract,
} from "wagmi";
import { waitForCallsStatus } from "wagmi/actions";
import { base } from "wagmi/chains";
import { Card } from "@/components/shared/Card";
import { useSmartWalletInput } from "@/components/wallet/useSmartWalletInput";
import { useWallet } from "@/components/wallet/WalletContext";
import {
  createRevokeCall,
  erc20ApprovalAbi,
  erc721ApprovalAbi,
  nftOperatorApprovalAbi,
} from "@/lib/approvalActions";
import type { BaseApprovalItem, BaseApprovalScan } from "@/lib/approvalTypes";

type Confirmation = {
  approvals: BaseApprovalItem[];
  mode: "single" | "batch";
};

type ActionNotice = {
  kind: "pending" | "success" | "error";
  message: string;
  href?: string;
};

const APPROVAL_CACHE_PREFIX = "baseguardian:approval-scan:";
const APPROVAL_CACHE_FRESH_MS = 2 * 60_000;
const APPROVAL_CACHE_MAX_AGE_MS = 10 * 60_000;

type CachedApprovalScan = {
  savedAt: number;
  scan: BaseApprovalScan;
};

function readCachedApprovalScan(input: string): CachedApprovalScan | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      `${APPROVAL_CACHE_PREFIX}${input.toLowerCase()}`
    );
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedApprovalScan;
    if (
      !cached?.scan?.address ||
      !Array.isArray(cached.scan.approvals) ||
      Date.now() - cached.savedAt > APPROVAL_CACHE_MAX_AGE_MS
    ) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

function writeCachedApprovalScan(keys: string[], scan: BaseApprovalScan) {
  if (typeof window === "undefined") return;
  try {
    const value = JSON.stringify({ savedAt: Date.now(), scan });
    for (const key of new Set(keys.map((item) => item.toLowerCase()))) {
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

export function SecurityTab() {
  const wallet = useWallet();
  const {
    connectedAddress,
    differsFromConnectedWallet,
    setValue: setApprovalAddress,
    useConnectedWallet: applyConnectedWallet,
    value: approvalAddress,
  } = useSmartWalletInput();
  const [scan, setScan] = useState<BaseApprovalScan | null>(null);
  const [scanFor, setScanFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const config = useConfig();
  const publicClient = usePublicClient({ chainId: base.id });
  const writeContract = useWriteContract();
  const sendCalls = useSendCalls();
  const capabilities = useCapabilities({
    chainId: base.id,
    query: { enabled: wallet.isConnected && wallet.isBase },
  });

  const currentInput = approvalAddress.trim().toLowerCase();
  const visibleScan = scanFor === currentInput ? scan : null;
  const visibleError = scanFor === currentInput ? scanError : null;
  const scannedWalletConnected = Boolean(
    visibleScan &&
      connectedAddress &&
      visibleScan.address.toLowerCase() === connectedAddress.toLowerCase()
  );
  const atomicStatus = capabilities.data?.atomic?.status;
  const batchSupported =
    atomicStatus === "supported" || atomicStatus === "ready";
  const selectedApprovals = useMemo(
    () =>
      visibleScan?.approvals.filter((approval) => selected.has(approval.id)) ?? [],
    [selected, visibleScan]
  );
  const revokeUrl = visibleScan
    ? `https://revoke.cash/address/${visibleScan.address}?chain=base`
    : currentInput
      ? `https://revoke.cash/address/${encodeURIComponent(approvalAddress.trim())}?chain=base`
      : "https://revoke.cash/?chain=base";

  const runScan = useCallback(
    async () => {
      const trimmed = approvalAddress.trim();
      const normalizedInput = trimmed.toLowerCase();
      const isSameQuery = scanFor === normalizedInput;
      setScanFor(normalizedInput);
      setScanError(null);
      setSelected(new Set());
      setNotice(null);
      if (!isSameQuery) setScan(null);
      if (!trimmed) {
        setScan(null);
        setScanError("Paste a Base wallet address or supported name.");
        return;
      }

      const cached = readCachedApprovalScan(normalizedInput);
      if (cached) setScan(cached.scan);
      if (
        cached?.scan.coverage.status === "complete" &&
        Date.now() - cached.savedAt <= APPROVAL_CACHE_FRESH_MS
      ) {
        return;
      }

      setLoading(true);
      try {
        const response = await fetch(
          `/api/base/approvals?address=${encodeURIComponent(trimmed)}`
        );
        const body = (await response.json()) as BaseApprovalScan & {
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "Approval scan failed.");
        setScan(body);
        writeCachedApprovalScan(
          [normalizedInput, body.address.toLowerCase()],
          body
        );
      } catch (error) {
        if (!cached) setScan(null);
        setScanError(
          cached
            ? "Could not refresh right now. Showing the most recent saved scan."
            : error instanceof Error
              ? error.message
              : "Approval scan failed."
        );
      } finally {
        setLoading(false);
      }
    },
    [approvalAddress, scanFor]
  );
  const closeConfirmation = useCallback(() => setConfirmation(null), []);

  const removeApprovals = useCallback(
    (ids: string[]) => {
      setScan((current) => {
        if (!current) return current;
        const approvals = current.approvals.filter(
          (approval) => !ids.includes(approval.id)
        );
        const updated = {
          ...current,
          approvals,
          summary: {
            active: approvals.length,
            unlimited: approvals.filter((approval) => approval.value.unlimited)
              .length,
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
        writeCachedApprovalScan(
          [scanFor, updated.address.toLowerCase()],
          updated
        );
        return updated;
      });
      setSelected(new Set());
    },
    [scanFor]
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
    if (!confirmation || !wallet.address || !publicClient) return;
    const calls = confirmation.approvals.map(createRevokeCall);
    if (calls.length > 1 && !batchSupported) {
      setConfirmation(null);
      setNotice({
        kind: "error",
        message:
          "This wallet does not support atomic batches. Revoke one item at a time.",
      });
      return;
    }

    const submittedIds = confirmation.approvals.map((approval) => approval.id);
    setActionPending(true);
    setNotice({ kind: "pending", message: "Checking revoke call…" });
    try {
      for (const call of calls) {
        await publicClient.call({
          account: wallet.address,
          to: call.to,
          data: call.data,
        });
      }

      setConfirmation(null);
      if (calls.length === 1) {
        const approval = confirmation.approvals[0];
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
                chainId: base.id,
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
                  chainId: base.id,
                })
              : await writeContract.writeContractAsync({
                  address: approval.token.address,
                  abi: nftOperatorApprovalAbi,
                  functionName: "setApprovalForAll",
                  args: [approval.delegate.address, false],
                  chainId: base.id,
                });
        setNotice({
          kind: "pending",
          message: "Revoke submitted. Waiting for Base confirmation…",
          href: `https://basescan.org/tx/${hash}`,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("The revoke transaction reverted.");
        }
        removeApprovals(submittedIds);
        setNotice({
          kind: "success",
          message:
            "Approval revoked and confirmed on Base. Results updated without rescanning.",
          href: `https://basescan.org/tx/${hash}`,
        });
      } else {
        setNotice({
          kind: "pending",
          message: "Confirm the atomic batch in your wallet…",
        });
        const result = await sendCalls.sendCallsAsync({
          account: wallet.address,
          chainId: base.id,
          calls: calls.map((call) => ({ to: call.to, data: call.data })),
          forceAtomic: true,
        });
        setNotice({
          kind: "pending",
          message: "Batch submitted. Waiting for Base confirmation…",
        });
        const status = await waitForCallsStatus(config, {
          id: result.id,
          connector: wallet.connector,
          pollingInterval: 1_500,
          timeout: 120_000,
        });
        if (status.status !== "success") throw new Error("The batch revoke failed.");
        const transactionHash = status.receipts?.[0]?.transactionHash;
        removeApprovals(submittedIds);
        setNotice({
          kind: "success",
          message:
            "Selected approvals were revoked and confirmed on Base. Results updated without rescanning.",
          href: transactionHash
            ? `https://basescan.org/tx/${transactionHash}`
            : undefined,
        });
      }
    } catch (error) {
      setConfirmation(null);
      setNotice({ kind: "error", message: friendlyActionError(error) });
    } finally {
      setActionPending(false);
    }
  };

  const actionableApprovals =
    visibleScan?.approvals.filter(
      (approval) => approval.verification === "verified"
    ) ?? [];
  const busy = actionPending;

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
                setApprovalAddress(event.target.value);
                setSelected(new Set());
                setNotice(null);
              }}
              disabled={actionPending}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !loading) void runScan();
              }}
            />
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={loading || actionPending}
              className="btn btn-primary"
            >
              {loading ? "Scanning…" : "Scan approvals"}
            </button>
          </div>

          {connectedAddress && differsFromConnectedWallet && (
            <button
              type="button"
              onClick={() => {
                applyConnectedWallet();
                setSelected(new Set());
                setNotice(null);
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

      {visibleScan && (
        <>
          <ApprovalSummary scan={visibleScan} />

          {notice && (
            <div
              className={`rounded-xl border p-3 text-[11px] ${
                notice.kind === "error"
                  ? "border-rose-400/20 bg-rose-400/10 text-rose-200"
                  : notice.kind === "success"
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                    : "border-blue-400/20 bg-blue-400/10 text-blue-100"
              }`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.message}{" "}
              {notice.href && (
                <a
                  className="link"
                  href={notice.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction
                </a>
              )}
            </div>
          )}

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
                    canAct={scannedWalletConnected && wallet.isBase}
                    busy={busy}
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

              {actionableApprovals.length > 1 && scannedWalletConnected && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      setSelected(
                        new Set(
                          actionableApprovals.map((approval) => approval.id)
                        )
                      )
                    }
                    disabled={busy}
                  >
                    Select verified
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      busy ||
                      !wallet.isBase ||
                      selectedApprovals.length < 2 ||
                      !batchSupported
                    }
                    onClick={() => openConfirmation(selectedApprovals)}
                  >
                    Revoke selected ({selectedApprovals.length})
                  </button>
                  <span className="text-[10px] text-white/45">
                    {batchSupported
                      ? "Atomic batch supported"
                      : "This wallet requires one-at-a-time revokes"}
                  </span>
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

      {confirmation && (
        <RevokeConfirmation
          confirmation={confirmation}
          batchSupported={batchSupported}
          onCancel={closeConfirmation}
          onConfirm={() => void confirmRevoke()}
        />
      )}
    </div>
  );
}

function ApprovalSummary({ scan }: { scan: BaseApprovalScan }) {
  return (
    <Card
      title="Approval exposure"
      description={`Snapshot at Base block ${scan.snapshotBlock.toLocaleString()}`}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryMetric label="Active" value={scan.summary.active} />
        <SummaryMetric label="High exposure" value={scan.summary.highExposure} />
        <SummaryMetric label="Unlimited" value={scan.summary.unlimited} />
        <SummaryMetric label="NFT operators" value={scan.summary.nftOperators} />
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

function SummaryMetric({ label, value }: { label: string; value: number }) {
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
              <p className="mt-1 text-[9px] text-white/45">
                Contract {shortAddress(call.to)} · Base mainnet
              </p>
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
