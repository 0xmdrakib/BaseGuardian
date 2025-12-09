// lib/alchemyBase.ts
// Accurate Base-only wallet activity summary using Alchemy RPC.
// - Counts tx from alchemy_getAssetTransfers (in + out)
// - Reads tx receipts for outgoing tx to compute real gasUsed * gasPrice
// - Returns 30d + lifetime tx & gas, plus basic activity stats.

const ALCHEMY_BASE_API_KEY = process.env.ALCHEMY_BASE_API_KEY;

const BASE_RPC_URL = ALCHEMY_BASE_API_KEY
  ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_BASE_API_KEY}`
  : "";

type Direction = "fromAddress" | "toAddress";

type AlchemyTransfer = {
  blockNum: string;
  hash: string;
  from: string;
  to: string;
  asset?: string | null;
  value?: number | null;
  category?: string | null;
  metadata?: {
    blockTimestamp?: string;
  } | null;
};

type TimedTransfer = AlchemyTransfer & { _ts?: number };

type AssetTransfersResult = {
  transfers?: AlchemyTransfer[];
  pageKey?: string;
};

export type BaseWalletActivitySummary = {
  last30dTxCount: number;
  lifetimeTxCount: number;
  last30dGasEth: number;
  lifetimeGasEth: number;
  mostCommonCategory: string | null;
  activeDaysLast30d: number;
  avgTxPerActiveDay30d: number;
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ---------- Low-level RPC helper ----------

async function callAlchemy(body: unknown): Promise<any> {
  if (!BASE_RPC_URL) {
    throw new Error("ALCHEMY_BASE_API_KEY is not configured in .env.local");
  }

  const res = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Alchemy RPC error: ${res.status} ${res.statusText} – ${text}`
    );
  }

  const json = await res.json();
  if ((json as any).error) {
    const err = (json as any).error;
    throw new Error(
      `Alchemy RPC error: ${err.code ?? ""} ${err.message ?? ""}`
    );
  }

  return (json as any).result;
}

// ---------- Transfers (in + out) ----------

function attachTimestamp(t: AlchemyTransfer): TimedTransfer {
  const raw = t.metadata?.blockTimestamp;
  if (!raw) return { ...t, _ts: undefined };

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    return { ...t, _ts: undefined };
  }

  return { ...t, _ts: parsed };
}

async function fetchTransfersForDirection(
  address: string,
  direction: Direction
): Promise<TimedTransfer[]> {
  const transfers: TimedTransfer[] = [];
  let pageKey: string | undefined;
  const maxPages = 10; // up to ~10k transfers per direction

  for (let page = 0; page < maxPages; page++) {
    const result = (await callAlchemy({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getAssetTransfers",
      params: [
        {
          [direction]: address,
          category: ["external", "erc20", "erc721", "erc1155"],
          withMetadata: true,
          maxCount: "0x3e8", // 1000
          excludeZeroValue: false,
          pageKey,
        },
      ],
    })) as AssetTransfersResult;

    const chunk = (result.transfers ?? []).map(attachTimestamp);
    transfers.push(...chunk);

    pageKey = result.pageKey;
    if (!pageKey) break;
  }

  return transfers;
}

// ---------- Receipts + gas helpers ----------

async function fetchTxReceipt(txHash: string) {
  const result = await callAlchemy({
    jsonrpc: "2.0",
    id: 2,
    method: "eth_getTransactionReceipt",
    params: [txHash],
  });

  return result as {
    gasUsed?: string;
    effectiveGasPrice?: string;
    gasPrice?: string;
  } | null;
}

function hexToBigInt(hex?: string): bigint {
  if (!hex) return 0n;
  const value = hex.startsWith("0x") ? hex : `0x${hex}`;
  return BigInt(value);
}

function weiToEth(wei: bigint): number {
  const ONE_ETHER = 1_000_000_000_000_000_000n; // 1e18
  const whole = wei / ONE_ETHER;
  const fraction = wei % ONE_ETHER;
  return Number(whole) + Number(fraction) / 1e18;
}

// Simple concurrency limiter so we don't hammer Alchemy
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

async function fetchReceiptWithRetry(
  hash: string,
  attempts = 2
): Promise<{ hash: string; receipt: any | null }> {
  for (let i = 0; i < attempts; i++) {
    try {
      const receipt = await fetchTxReceipt(hash);
      return { hash, receipt };
    } catch {
      if (i === attempts - 1) {
        return { hash, receipt: null };
      }
      // small backoff between retries
      await new Promise((resolve) => setTimeout(resolve, 300 + 200 * i));
    }
  }
  return { hash, receipt: null };
}

// ---------- Main summary function ----------

export async function getBaseWalletActivitySummary(
  address: string
): Promise<BaseWalletActivitySummary> {
  const lower = address.toLowerCase();
  const now = Date.now();
  const cutoff = now - THIRTY_DAYS_MS;

  // 1) Fetch Base transfers in + out
  const [fromTransfers, toTransfers] = await Promise.all([
    fetchTransfersForDirection(lower, "fromAddress"),
    fetchTransfersForDirection(lower, "toAddress"),
  ]);

  const allTransfers = [...fromTransfers, ...toTransfers];

  // 2) Lifetime tx count (unique hashes)
  const lifetimeHashSet = new Set<string>();
  for (const t of allTransfers) {
    if (t.hash) lifetimeHashSet.add(t.hash.toLowerCase());
  }
  const lifetimeTxCount = lifetimeHashSet.size;

  // 3) 30d tx count (unique hashes in last 30 days)
  const last30dHashSet = new Set<string>();
  for (const t of allTransfers) {
    if (!t._ts || t._ts < cutoff) continue;
    if (t.hash) last30dHashSet.add(t.hash.toLowerCase());
  }
  const last30dTxCount = last30dHashSet.size;

  // 4) Active days in last 30d
  const activeDaySet = new Set<string>();
  for (const t of allTransfers) {
    if (!t._ts || t._ts < cutoff) continue;
    const d = new Date(t._ts);
    if (!Number.isNaN(d.getTime())) {
      activeDaySet.add(d.toISOString().slice(0, 10)); // YYYY-MM-DD
    }
  }
  const activeDaysLast30d = activeDaySet.size;
  const avgTxPerActiveDay30d =
    activeDaysLast30d > 0 ? last30dTxCount / activeDaysLast30d : 0;

  // 5) Activity category (prefer 30d, else lifetime)
  const categoryCounts = new Map<string, number>();
  const categorySource =
    last30dHashSet.size > 0
      ? allTransfers.filter((t) => t._ts && t._ts >= cutoff)
      : allTransfers;

  for (const t of categorySource) {
    const cat = t.category ?? "unknown";
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  }

  let mostCommonCategory: string | null = null;
  let bestCount = 0;
  for (const [cat, count] of categoryCounts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      mostCommonCategory = cat;
    }
  }

  // 6) Gas: outgoing tx only, all hashes (no manual cap)
  const uniqueOutHashes = Array.from(
    new Set(fromTransfers.map((t) => t.hash.toLowerCase()))
  );

  const receipts = await mapWithConcurrency(
    uniqueOutHashes,
    5, // max 5 concurrent RPC calls
    (hash) => fetchReceiptWithRetry(hash)
  );

  const gasByHash = new Map<string, number>();
  for (const { hash, receipt } of receipts) {
    if (!receipt?.gasUsed) continue;
    const gasUsed = hexToBigInt(receipt.gasUsed);
    const gasPrice =
      hexToBigInt(receipt.effectiveGasPrice) || hexToBigInt(receipt.gasPrice);
    if (gasPrice === 0n) continue;

    const wei = gasUsed * gasPrice;
    const eth = weiToEth(wei);
    gasByHash.set(hash.toLowerCase(), eth);
  }

  let lifetimeGasEth = 0;
  let last30dGasEth = 0;

  for (const t of fromTransfers) {
    if (!t.hash) continue;
    const hash = t.hash.toLowerCase();
    const g = gasByHash.get(hash) ?? 0;

    lifetimeGasEth += g;
    if (t._ts && t._ts >= cutoff) {
      last30dGasEth += g;
    }
  }

  const round = (x: number) => Number(x.toFixed(4));

  return {
    last30dTxCount,
    lifetimeTxCount,
    last30dGasEth: round(last30dGasEth),
    lifetimeGasEth: round(lifetimeGasEth),
    mostCommonCategory,
    activeDaysLast30d,
    avgTxPerActiveDay30d,
  };
}

// ---------- Friendly label for UI ----------

export function formatCategoryLabel(category: string | null): string {
  if (!category) return "Mixed";

  switch (category) {
    case "external":
      return "Native transfers";
    case "erc20":
      return "ERC-20 transfers";
    case "erc721":
      return "NFT trades (ERC-721)";
    case "erc1155":
      return "NFT trades (ERC-1155)";
    default:
      return "Mixed activity";
  }
}
