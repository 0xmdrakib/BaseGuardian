"use client";

import { useState } from "react";
import { Card } from "@/components/shared/Card";
import type { BaseNftCollectionSummary, NftHealth } from "@/lib/baseNft";

export default function NftScannerCard() {
  const [contract, setContract] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<BaseNftCollectionSummary | null>(null);

  const handleScan = async () => {
    setError(null);
    setInfo(null);

    const trimmed = contract.trim();
    if (!trimmed) {
      setError("Paste a Base NFT contract address (0x…).");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/api/base/nft?contract=${encodeURIComponent(trimmed)}`
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to fetch NFT info");
      }
      setInfo(body as BaseNftCollectionSummary);
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="NFT scanner"
      description="Volume, holders and basic health for Base NFT collections."
    >
      <div className="space-y-3 text-[11px]">
        <div className="flex gap-2">
          <input
            placeholder="0x... (Base NFT contract)"
            className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            value={contract}
            onChange={(e) => setContract(e.target.value)}
          />
          <button
            onClick={handleScan}
            disabled={loading || !contract}
            className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-900 disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {loading ? "Scanning…" : "Scan NFT"}
          </button>
        </div>

        <p className="text-[10px] text-neutral-500">
          Paste any Base NFT contract. Always verify contracts from a trusted
          source before minting or buying.
        </p>

        {error && <p className="text-[11px] text-red-400">{error}</p>}

        {info && <NftSummaryPanel info={info} />}

        {!info && !error && !loading && (
          <p className="text-[10px] text-neutral-500">
            Example: try a known Base collection like The Warplets. Scores are
            heuristics, not financial advice.
          </p>
        )}
      </div>
    </Card>
  );
}

function getHealthBadgeProps(health: NftHealth) {
  switch (health) {
    case "good":
      return {
        label: "Good",
        badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-600/40",
      };
    case "medium":
      return {
        label: "Medium",
        badgeClass: "bg-amber-500/10 text-amber-300 border-amber-500/40",
      };
    default:
      return {
        label: "Risky",
        badgeClass: "bg-rose-500/10 text-rose-300 border-rose-500/40",
      };
  }
}

function NftSummaryPanel({ info }: { info: BaseNftCollectionSummary }) {
  const shortAddress =
    info.contractAddress.slice(0, 6) +
    "..." +
    info.contractAddress.slice(-4);

  const { label, badgeClass } = getHealthBadgeProps(info.health);

  const standardLabel =
    info.tokenStandard === "unknown" ? "Unknown" : info.tokenStandard;

  const totalSupplyLabel =
    info.totalSupply != null ? info.totalSupply.toLocaleString() : "Unknown";

  const floorLabel =
    info.floorPriceNative != null
      ? `${info.floorPriceNative} ${info.floorPriceSymbol || "ETH"}`
      : "No market data";

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-neutral-50">
              {info.name ?? "Unknown collection"}
            </span>
          </div>

          <div className="mt-0.5 text-[10px] text-neutral-500">
            {shortAddress}
          </div>

          {info.symbol && (
            <div className="mt-1 text-[10px] text-neutral-500">
              Symbol: <span className="font-medium">{info.symbol}</span>
            </div>
          )}

          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-neutral-300">
            <MetricLine label="Token standard" value={standardLabel} />
            <MetricLine label="Total supply" value={totalSupplyLabel} />
            <MetricLine label="Floor price" value={floorLabel} />
            <MetricLine label="Storage" value="Onchain" />
          </div>

          {info.reasons && info.reasons.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[10px] text-neutral-500">
              {info.reasons.map((r, idx) => (
                <li key={idx}>• {r}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0">
          <span
            className={
              "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium " +
              badgeClass
            }
          >
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}

function MetricLine({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-neutral-500">{label}</span>
      <span className="text-[11px] font-medium text-neutral-100">
        {value}
      </span>
    </div>
  );
}
