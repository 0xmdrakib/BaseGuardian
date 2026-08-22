import { NextRequest } from "next/server";
import {
  getBaseWalletActivitySummary,
  formatCategoryLabel,
  type BaseWalletActivitySummary,
} from "@/lib/alchemyBase";
import { resolveBaseAddressOrName } from "@/lib/baseNameResolve";
import { protectBaseApi } from "@/lib/apiProtection";
import { errorJson, publicJson } from "@/lib/apiResponses";
import { validateWalletAddressOrName } from "@/lib/apiValidation";

type WalletActivity = {
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

// Simple in-memory cache to keep Alchemy calls under control
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

type CacheEntry = {
  value: BaseWalletActivitySummary;
  expiresAt: number;
};

const walletCache = new Map<string, CacheEntry>();

function getCachedSummary(address: string): BaseWalletActivitySummary | null {
  const entry = walletCache.get(address.toLowerCase());
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    walletCache.delete(address.toLowerCase());
    return null;
  }
  return entry.value;
}

function setCachedSummary(address: string, summary: BaseWalletActivitySummary) {
  walletCache.set(address.toLowerCase(), {
    value: summary,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export async function GET(req: NextRequest) {
  const denied = await protectBaseApi(req, "wallet");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const input = validateWalletAddressOrName(searchParams.get("address"));
  if (!input.ok) return errorJson(input.error, 400);

  try {
    // Accept 0x address OR .base.eth name, resolve to 0x
    const resolvedAddress = await resolveBaseAddressOrName(input.value);

    // Try cache
    let summary = getCachedSummary(resolvedAddress);
    if (!summary) {
      summary = await getBaseWalletActivitySummary(resolvedAddress);
      setCachedSummary(resolvedAddress, summary);
    }

    const payload: WalletActivity = {
      address: resolvedAddress,
      chain: "base-mainnet",
      summary: {
        last30dGasEth: Number(summary.last30dGasEth.toFixed(6)),
        lifetimeGasEth: Number(summary.lifetimeGasEth.toFixed(6)),
        last30dTxCount: summary.last30dTxCount,
        lifetimeTxCount: summary.lifetimeTxCount,
        mostCommonTxType: formatCategoryLabel(summary.mostCommonCategory),
        activeDaysLast30d: summary.activeDaysLast30d,
        avgTxPerActiveDay30d: Number(
          summary.avgTxPerActiveDay30d.toFixed(2)
        ),
      },
    };

    return publicJson(payload, 120);
  } catch (err: unknown) {
    console.error("Error in Base wallet summary", err);
    return errorJson("Failed to fetch Base wallet summary", 500);
  }
}
