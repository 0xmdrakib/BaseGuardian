"use client";

import { useState } from "react";
import { Card } from "@/components/shared/Card";
import NftScannerCard from "@/components/NftScannerCard";

import type { TokenHealth } from "@/lib/alchemyTokens";

type SingleTokenInfoClient = {
  contractAddress: string;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  decimals: number | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  pairUrl: string | null;
  pairCreatedAt: number | null;
  health: TokenHealth;
  reasons: string[];
};

export function AssetsTab() {
  const [tokenAddress, setTokenAddress] = useState<string>("");
  const [tokenInfoLoading, setTokenInfoLoading] = useState(false);
  const [tokenInfoError, setTokenInfoError] = useState<string | null>(null);
  const [tokenInfo, setTokenInfo] =
    useState<SingleTokenInfoClient | null>(null);

  const handleCheckSingleToken = async () => {
    setTokenInfoError(null);
    setTokenInfo(null);

    const trimmed = tokenAddress.trim();
    if (!trimmed) {
      setTokenInfoError("Paste a Base token contract address (0x…).");
      return;
    }

    setTokenInfoLoading(true);
    try {
      const res = await fetch(
        `/api/base/token-info?address=${encodeURIComponent(trimmed)}`
      );
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error ?? "Failed to fetch token info");
      }

      setTokenInfo(body as SingleTokenInfoClient);
    } catch (err: any) {
      console.error(err);
      setTokenInfoError(err.message ?? "Unexpected error");
    } finally {
      setTokenInfoLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Token scanner – single token only */}
      <Card
        title="Token scanner"
        description="Check basic health hints for a single Base token."
      >
        <div className="space-y-3 text-[11px]">
          <p className="text-neutral-400">
            Paste any Base ERC-20 contract. Uses DexScreener market data.
            Scores are heuristics, not
            financial advice.
          </p>

          <div className="flex gap-2">
            <input
              placeholder="0x... (Base token contract)"
              className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-500"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
            />
            <button
              onClick={handleCheckSingleToken}
              disabled={tokenInfoLoading || !tokenAddress}
              className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-900 disabled:cursor-not-allowed disabled:bg-neutral-400"
            >
              {tokenInfoLoading ? "Checking…" : "Check token"}
            </button>
          </div>

          {tokenInfoError && (
            <p className="text-[11px] text-red-400">{tokenInfoError}</p>
          )}

          {tokenInfo && <SingleTokenPanel token={tokenInfo} />}

          {!tokenInfo && !tokenInfoError && !tokenInfoLoading && (
            <p className="text-[10px] text-neutral-500">
              Example: Try the official USDC or WETH contract on Base, or any
              Base memecoin. Always verify contracts from a trusted source
              before interacting.
            </p>
          )}
        </div>
      </Card>

      {/* New NFT scanner card (the one we built with OpenSea) */}
      <NftScannerCard />
    </div>
  );
}

function getHealthBadgeProps(health: TokenHealth) {
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

function SingleTokenPanel({ token }: { token: SingleTokenInfoClient }) {
  const shortAddress =
    token.contractAddress.slice(0, 6) +
    "..." +
    token.contractAddress.slice(-4);

  const { label, badgeClass } = getHealthBadgeProps(token.health);

  const createdAtLabel =
    token.pairCreatedAt && token.pairCreatedAt > 0
      ? `${Math.floor(
        (Date.now() - token.pairCreatedAt) / (1000 * 60 * 60 * 24)
      )} days ago`
      : "Unknown";

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-neutral-50">
              {token.symbol ?? "Unknown"}
            </span>
            {token.name && (
              <span className="truncate text-[11px] text-neutral-500">
                {token.name}
              </span>
            )}
          </div>
          <div className="text-[10px] text-neutral-600">{shortAddress}</div>

          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-neutral-300">
            <MetricLine
              label="Price"
              value={
                token.priceUsd != null
                  ? `$${token.priceUsd.toFixed(6)}`
                  : "No price data"
              }
            />
            <MetricLine
              label="Liquidity"
              value={
                token.liquidityUsd != null
                  ? `$${token.liquidityUsd.toLocaleString()}`
                  : "Unknown"
              }
            />
            <MetricLine
              label="Market cap"
              value={
                token.marketCapUsd != null
                  ? `$${token.marketCapUsd.toLocaleString()}`
                  : token.fdvUsd != null
                    ? `FDV $${token.fdvUsd.toLocaleString()}`
                    : "Unknown"
              }
            />
            <MetricLine
              label="24h volume"
              value={
                token.volume24hUsd != null
                  ? `$${token.volume24hUsd.toLocaleString()}`
                  : "Unknown"
              }
            />
            <MetricLine label="Pool age" value={createdAtLabel} />
            <MetricLine
              label="DEX link"
              value={
                token.pairUrl ? (
                  <a
                    href={token.pairUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    Open on DexScreener
                  </a>
                ) : (
                  "N/A"
                )
              }
            />
          </div>

          {token.reasons && token.reasons.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[10px] text-neutral-500">
              {token.reasons.map((r, idx) => (
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
