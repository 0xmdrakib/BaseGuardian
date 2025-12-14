"use client";

import { useState } from "react";
import { Card } from "@/components/shared/Card";
import { ScoreBadge } from "@/components/shared/ScoreBadge";

type WalletSummary = {
  address: string;
  chain: "base-mainnet";
  summary: {
    last30dGasEth: number;
    lifetimeGasEth: number;
    last30dTxCount: number;
    lifetimeTxCount: number;
    mostCommonTxType: string;
    activeDaysLast30d: number;
    avgTxPerActiveDay30d: number;
  };
};

export function OverviewTab() {
  // ---------- Wallet analysis ----------
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletSummary, setWalletSummary] =
    useState<WalletSummary | null>(null);

  // ---------- Wallet overview ----------
  const handleAnalyzeWallet = async () => {
    setWalletError(null);
    setWalletSummary(null);

    const trimmed = walletAddress.trim();
    if (!trimmed) {
      setWalletError(
        "Paste a Base wallet address 0x... (Base wallet address)."
      );
      return;
    }

    setWalletLoading(true);
    try {
      const res = await fetch(
        `/api/base/wallet?address=${encodeURIComponent(trimmed)}`
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to analyze wallet");
      }
      setWalletSummary(body as WalletSummary);
    } catch (err: any) {
      console.error("Error fetching wallet summary", err);
      setWalletError(err?.message ?? "Unexpected error");
    } finally {
      setWalletLoading(false);
    }
  };

  const walletHealth = walletSummary
    ? computeWalletHealth(walletSummary.summary)
    : null;

  const onchainSnapshot = walletSummary
    ? computeOnchainSnapshot(walletSummary.summary)
    : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Wallet overview (Base) */}
      <Card
        title="Wallet overview (Base)"
        description="Paste a Base address to get estimate wallet health and activity score."
      >
        <div className="space-y-3 text-[11px]">
          <div className="flex gap-2">
            <input
              placeholder="0x... (Base wallet address)"
              className="input flex-1"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
            />
            <button
              onClick={handleAnalyzeWallet}
              disabled={walletLoading}
              className="btn btn-primary"
            >
              {walletLoading ? "Analyzing…" : "Analyze"}
            </button>
          </div>

          {walletError && (
            <p className="text-[11px] text-rose-300">{walletError}</p>
          )}

          {walletSummary && (
            <div className="grid grid-cols-2 gap-2">
              <Metric
                label="Gas (30d)"
                value={`${walletSummary.summary.last30dGasEth} ETH`}
              />
              <Metric
                label="Tx count (30d)"
                value={String(walletSummary.summary.last30dTxCount)}
              />
              <Metric
                label="Gas (lifetime)"
                value={`${walletSummary.summary.lifetimeGasEth} ETH`}
              />
              <Metric
                label="Tx count (lifetime)"
                value={String(walletSummary.summary.lifetimeTxCount)}
              />
            </div>
          )}

          {!walletSummary && !walletError && !walletLoading && (
            <p className="text-[11px] text-white/50">
              This looks is your recent activity on Base chain (last ~30 days),
              plus full lifetime history yet.
            </p>
          )}
        </div>
      </Card>

      {/* Wallet health – only after analysis */}
      {walletHealth && (
        <Card
          title="Wallet health"
          description="Very rough score based on recent activity on Base. Does not yet read approvals or simulate risk."
          footer="Scores are heuristics, not financial advice. Always double-check contracts and approvals."
        >
          <div className="flex items-center justify-between">
            <div>
              <ScoreBadge label="Health score" score={walletHealth.score} />
              <ul className="mt-2 space-y-1 text-[11px] text-white/60">
                {walletHealth.reasons.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* Onchain resume snapshot */}
      {onchainSnapshot && (
        <Card
          title="Onchain resume (Base)"
          description="Snapshot of your recent activity on Base (last ~30 days)."
        >
          <div className="grid grid-cols-2 gap-2 text-[11px] text-white/70">
            <div>
              <div className="text-white/50">Activity tier</div>
              <div className="font-medium">
                {onchainSnapshot.activityTier}
              </div>
            </div>
            <div>
              <div className="text-white/50">Est. active days</div>
              <div className="font-medium">
                {onchainSnapshot.estimatedActiveDays}
              </div>
            </div>
            <div>
              <div className="text-white/50">Avg. tx / active day</div>
              <div className="font-medium">
                {onchainSnapshot.avgTxPerActiveDay}
              </div>
            </div>
            <div>
              <div className="text-white/50">Focus</div>
              <div className="font-medium">
                {onchainSnapshot.focusLabel}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="text-[10px] text-white/50">{label}</div>
      <div className="text-xs font-medium text-white/90">{value}</div>
    </div>
  );
}

function computeWalletHealth(summary: WalletSummary["summary"]) {
  let score = 80;
  const reasons: string[] = [];

  const tx30 = summary.last30dTxCount;
  const txLife = summary.lifetimeTxCount;
  const gasLife = summary.lifetimeGasEth;
  const activeDays = summary.activeDaysLast30d;
  const avg30 = summary.avgTxPerActiveDay30d;

  // Lifetime experience
  if (txLife < 20) {
    score -= 15;
    reasons.push("Very little lifetime activity on Base so far.");
  } else if (txLife < 200) {
    reasons.push("Some lifetime activity on Base.");
  } else {
    score += 5;
    reasons.push("Significant lifetime activity on Base.");
  }

  // Recent activity (last 30d)
  if (tx30 < 5) {
    score -= 20;
    reasons.push("Very low recent activity on Base in the last 30 days.");
  } else if (tx30 < 30) {
    score -= 5;
    reasons.push("Moderate recent activity on Base.");
  } else {
    score += 5;
    reasons.push("High recent activity on Base.");
  }

  // Consistency across days
  if (!activeDays || activeDays < 3) {
    score -= 10;
    reasons.push("Active on only a few days over the last month.");
  } else if (activeDays < 10) {
    reasons.push("Activity spread over some days, but not extremely regular.");
  } else {
    score += 5;
    reasons.push("Consistent activity across many days in the last month.");
  }

  // Tx per active day
  if (avg30 > 40) {
    score -= 10;
    reasons.push(
      "Very high transactions per active day; behavior may be more degen or bot-like."
    );
  } else if (avg30 >= 5) {
    reasons.push("Healthy transaction velocity on active days.");
  } else if (avg30 > 0) {
    reasons.push("Low transaction count on most active days.");
  }

  // Gas usage lifetime
  if (gasLife > 1) {
    score -= 5;
    reasons.push("Relatively high estimated lifetime gas usage on Base.");
  } else if (gasLife > 0.1) {
    reasons.push("Noticeable lifetime gas usage on Base.");
  } else {
    reasons.push("Light overall gas usage on Base so far.");
  }

  score = Math.max(0, Math.min(100, score));

  return { score, reasons };
}

function computeOnchainSnapshot(summary: WalletSummary["summary"]) {
  const tx = summary.last30dTxCount;

  let activityTier = "Low";
  if (tx >= 100) activityTier = "High";
  else if (tx >= 20) activityTier = "Medium";

  const activeDays =
    summary.activeDaysLast30d && summary.activeDaysLast30d > 0
      ? summary.activeDaysLast30d
      : Math.max(1, Math.round(tx / 4));

  const baseAvg =
    summary.avgTxPerActiveDay30d && summary.avgTxPerActiveDay30d > 0
      ? summary.avgTxPerActiveDay30d
      : tx / activeDays;

  const avgTxPerActiveDay = baseAvg.toFixed(1);

  let focusLabel = "Mixed usage";
  if (summary.mostCommonTxType.includes("Native")) {
    focusLabel = "Simple transfers";
  } else if (summary.mostCommonTxType.toLowerCase().includes("erc-20")) {
    focusLabel = "Token transfers";
  } else if (summary.mostCommonTxType.toLowerCase().includes("nft")) {
    focusLabel = "NFT-heavy activity";
  }

  return {
    activityTier,
    estimatedActiveDays: activeDays,
    avgTxPerActiveDay,
    focusLabel,
  };
}
