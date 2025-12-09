const ALCHEMY_BASE_API_KEY = process.env.ALCHEMY_BASE_API_KEY;

const BASE_RPC_URL = ALCHEMY_BASE_API_KEY
  ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_BASE_API_KEY}`
  : "";

const PRICES_URL = ALCHEMY_BASE_API_KEY
  ? `https://api.g.alchemy.com/prices/v1/${ALCHEMY_BASE_API_KEY}/tokens/by-address`
  : "";

type AlchemyError = {
  code: number;
  message: string;
};

type TokenBalanceItem = {
  contractAddress: string;
  tokenBalance: string;
  error?: string | null;
};

type TokenBalancesResult = {
  address: string;
  tokenBalances: TokenBalanceItem[];
};

type TokenBalancesResponse = {
  jsonrpc: string;
  id: number;
  result?: TokenBalancesResult;
  error?: AlchemyError;
};

type TokenMetadata = {
  name?: string;
  symbol?: string;
  decimals?: number;
  logo?: string;
};

type TokenMetadataResponse = {
  jsonrpc: string;
  id: number;
  result?: TokenMetadata;
  error?: AlchemyError;
};

type PriceItem = {
  network: string;
  address: string;
  prices?: Array<{
    currency: string;
    value: string;
    lastUpdatedAt: string;
  }>;
  error?: string | null;
};

type PricesResponse = {
  data?: PriceItem[];
};

export type TokenHealth = "good" | "medium" | "risky";

export type BaseTokenSummary = {
  contractAddress: string;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  decimals: number | null;
  rawBalance: string;
  balance: string; // human-readable
  priceUsd: number | null;
  valueUsd: number | null;
  health: TokenHealth;
  reasons: string[];
};

async function rpcRequest(body: any): Promise<any> {
  if (!BASE_RPC_URL) {
    throw new Error("ALCHEMY_BASE_API_KEY is not configured in .env.local");
  }

  const res = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await res.text();
  let json: any;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `Alchemy RPC returned non-JSON (status ${res.status}): ${text.slice(
        0,
        200
      )}`
    );
  }

  if (!res.ok || json.error) {
    const msg =
      json.error?.message ??
      (typeof text === "string" ? text.slice(0, 200) : "Unknown error");
    throw new Error(
      `Alchemy RPC error (status ${res.status}): ${msg}`
    );
  }

  return json;
}

async function fetchTokenBalances(
  address: string
): Promise<TokenBalanceItem[]> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "alchemy_getTokenBalances",
    // "erc20" → সব ERC20 token balances 
    params: [address, "erc20"],
  };

  const json = (await rpcRequest(body)) as TokenBalancesResponse;
  return json.result?.tokenBalances ?? [];
}

async function fetchTokenMetadata(
  contractAddress: string
): Promise<TokenMetadata | null> {
  const body = {
    jsonrpc: "2.0",
    id: 2,
    method: "alchemy_getTokenMetadata",
    params: [contractAddress],
  };

  const json = (await rpcRequest(body)) as TokenMetadataResponse;
  return json.result ?? null;
}

async function fetchPricesByAddress(
  addresses: string[]
): Promise<Record<string, number | null>> {
  if (!PRICES_URL) {
    return {};
  }

  const unique = Array.from(new Set(addresses.map((a) => a.toLowerCase())));

  if (unique.length === 0) {
    return {};
  }

  const res = await fetch(PRICES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      addresses: unique.map((addr) => ({
        network: "base-mainnet",
        address: addr,
      })),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    console.error(
      "Alchemy Prices error",
      res.status,
      await res.text()
    );
    return {};
  }

  const json = (await res.json()) as PricesResponse;
  const out: Record<string, number | null> = {};

  const data = Array.isArray(json.data) ? json.data : [];
  for (const item of data) {
    const addr = (item.address ?? "").toLowerCase();
    if (!addr) continue;
    const prices = Array.isArray(item.prices) ? item.prices : [];
    const usd = prices.find((p) => p.currency === "USD");
    if (usd && typeof usd.value === "string") {
      const v = parseFloat(usd.value);
      out[addr] = Number.isFinite(v) ? v : null;
    } else {
      out[addr] = null;
    }
  }

  return out;
}

function formatBalance(
  rawBalance: string,
  decimals: number | null
): { numeric: number | null; label: string } {
  if (!decimals && decimals !== 0) {
    return { numeric: null, label: "0" };
  }
  try {
    const big = BigInt(rawBalance);
    const numeric = Number(big) / Math.pow(10, decimals);
    if (!Number.isFinite(numeric)) {
      return { numeric: null, label: "0" };
    }

    if (numeric === 0) {
      return { numeric: 0, label: "0" };
    }

    if (numeric >= 1) {
      return { numeric, label: numeric.toFixed(4) };
    }

    if (numeric >= 0.0001) {
      return { numeric, label: numeric.toFixed(6) };
    }

    return { numeric, label: "< 0.0001" };
  } catch {
    return { numeric: null, label: "0" };
  }
}

function scoreToken(
  symbol: string | null,
  valueUsd: number | null
): { health: TokenHealth; reasons: string[] } {
  const reasons: string[] = [];
  const upper = (symbol ?? "").toUpperCase();

  const isStable = ["USDC", "USDBC", "USDT", "DAI"].includes(upper);
  const isEthLike = ["WETH", "CBETH"].includes(upper);

  if (isStable) {
    reasons.push("Looks like a stablecoin on Base.");
  }
  if (isEthLike) {
    reasons.push("ETH-like wrapped asset.");
  }

  // যদি price+holding বড় হয় → Good
  if (valueUsd != null && valueUsd >= 100) {
    reasons.push("Tracked price and sizeable position.");
    return { health: "good", reasons };
  }

  // ছোট হলেও price থাকলে → Medium
  if (valueUsd != null && valueUsd > 0) {
    reasons.push("Tracked price but smaller position.");
    return { health: "medium", reasons };
  }

  // price নাই, কিন্তু stablecoin মনে হচ্ছে → Medium
  if (isStable) {
    reasons.push(
      "Treating as a major stablecoin even though onchain price feed is missing."
    );
    return { health: "medium", reasons };
  }

  // অন্য সবার জন্য, price নাই = বেশি সন্দেহজনক
  reasons.push(
    "No price data; may be low-liquidity or off main listings."
  );
  return { health: "risky", reasons };
}

export async function getBaseTokenPortfolio(
  address: string
): Promise<BaseTokenSummary[]> {
  const balances = await fetchTokenBalances(address);

  // Filter out errored + zero balances
  const nonZero = balances.filter((b) => {
    if (b.error) return false;
    if (!b.tokenBalance || b.tokenBalance === "0x" || b.tokenBalance === "0x0") {
      return false;
    }
    try {
      const v = BigInt(b.tokenBalance);
      return v > 0n;
    } catch {
      return false;
    }
  });

  if (nonZero.length === 0) {
    return [];
  }

  // Sort by raw balance (desc) and limit to top 20 contracts
  const sorted = [...nonZero].sort((a, b) => {
    try {
      const av = BigInt(a.tokenBalance);
      const bv = BigInt(b.tokenBalance);
      if (av === bv) return 0;
      return av > bv ? -1 : 1;
    } catch {
      return 0;
    }
  });

  const limited = sorted.slice(0, 20);

  // Fetch metadata in parallel
  const metaPromises = limited.map((b) =>
    fetchTokenMetadata(b.contractAddress)
  );
  const metaResults = await Promise.all(metaPromises);

  const metaMap = new Map<string, TokenMetadata | null>();
  limited.forEach((b, i) => {
    metaMap.set(b.contractAddress.toLowerCase(), metaResults[i]);
  });

  // Fetch prices for these tokens
  const priceMap = await fetchPricesByAddress(
    limited.map((b) => b.contractAddress)
  );

  const tokens: BaseTokenSummary[] = [];

  for (const bal of limited) {
    const addrLower = bal.contractAddress.toLowerCase();
    const meta = metaMap.get(addrLower) ?? null;

    const decimals =
      typeof meta?.decimals === "number" ? meta.decimals : null;
    const { numeric: numericBalance, label: balanceLabel } = formatBalance(
      bal.tokenBalance,
      decimals
    );

    if (!numericBalance || numericBalance === 0) {
      // skip dust
      continue;
    }

    const priceUsd =
      typeof priceMap[addrLower] === "number"
        ? priceMap[addrLower]
        : null;

    const valueUsd =
      priceUsd != null ? numericBalance * priceUsd : null;

    const { health, reasons } = scoreToken(
      meta?.symbol ?? null,
      valueUsd
    );

    tokens.push({
      contractAddress: bal.contractAddress,
      symbol: meta?.symbol ?? null,
      name: meta?.name ?? null,
      logo: typeof meta?.logo === "string" ? meta.logo : null,
      decimals,
      rawBalance: bal.tokenBalance,
      balance: balanceLabel,
      priceUsd,
      valueUsd:
        valueUsd != null ? Number(valueUsd.toFixed(2)) : null,
      health,
      reasons,
    });
  }

  // Sort by USD value desc, fallback balance
  tokens.sort((a, b) => {
    const va = a.valueUsd ?? 0;
    const vb = b.valueUsd ?? 0;
    if (va === vb) {
      return 0;
    }
    return vb - va;
  });

  return tokens;
}

export type BaseSingleTokenInfo = {
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

type DexscreenerPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  quoteToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  priceUsd?: string;
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  volume?: {
    h24?: number;
    [key: string]: number | undefined;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
};

const DEXSCREENER_BASE_URL = "https://api.dexscreener.com/tokens/v1";

async function fetchDexscreenerBasePairs(
  contractAddress: string
): Promise<DexscreenerPair[] | null> {
  try {
    const res = await fetch(
      `${DEXSCREENER_BASE_URL}/base/${contractAddress}`
    );

    if (!res.ok) {
      console.warn("DexScreener request failed:", res.status, res.statusText);
      return null;
    }

    const data = (await res.json()) as unknown;

    if (!Array.isArray(data)) {
      console.warn("DexScreener response is not an array");
      return null;
    }

    // Base chain এর pair গুলো শুধু রাখলাম
    const pairs = (data as DexscreenerPair[]).filter((p) =>
      (p.chainId ?? "").toLowerCase().includes("base")
    );

    return pairs.length > 0 ? pairs : null;
  } catch (err) {
    console.error("Error calling DexScreener:", err);
    return null;
  }
}

function pickBestPair(pairs: DexscreenerPair[]): DexscreenerPair | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((best, p) => {
    const liq = p.liquidity?.usd ?? 0;
    const bestLiq = best.liquidity?.usd ?? 0;
    return liq > bestLiq ? p : best;
  }, pairs[0]);
}

// Stablecoin detection – আগের মতই, নতুন scoring এ ব্যবহার করব
function isStableSymbol(symbol: string | null): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  return ["USDC", "USDBC", "USDT", "DAI"].includes(upper);
}

function scoreFromDexData(params: {
  symbol: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  pairCreatedAt: number | null;
}): { health: TokenHealth; reasons: string[] } {
  const reasons: string[] = [];
  let score = 65;

  const {
    symbol,
    priceUsd,
    liquidityUsd,
    volume24hUsd,
    fdvUsd,
    marketCapUsd,
    pairCreatedAt,
  } = params;

  const isStable = isStableSymbol(symbol);
  if (isStable) {
    reasons.push("Looks like a major stablecoin on Base.");
    score += 5;
  }

  // Liquidity
  if (liquidityUsd == null) {
    reasons.push("No DEX liquidity data; treated as illiquid.");
    score -= 20;
  } else if (liquidityUsd < 5_000) {
    reasons.push("Very low liquidity (< $5k); hard to enter/exit safely.");
    score -= 25;
  } else if (liquidityUsd < 50_000) {
    reasons.push("Moderate liquidity; fine for small position sizes.");
    score -= 5;
  } else {
    reasons.push("Strong liquidity; easier to trade in size.");
    score += 10;
  }

  // Volume 24h
  if (volume24hUsd != null) {
    if (volume24hUsd < 5_000) {
      reasons.push("Low 24h volume; limited recent trading activity.");
      score -= 10;
    } else if (volume24hUsd < 50_000) {
      reasons.push("Healthy but not huge 24h volume.");
    } else {
      reasons.push("High 24h volume; actively traded.");
      score += 5;
    }
  }

  // FDV vs liquidity ratio
  if (fdvUsd != null && liquidityUsd != null && liquidityUsd > 0) {
    const ratio = fdvUsd / liquidityUsd;
    if (ratio > 1000) {
      reasons.push(
        "FDV is extremely high vs liquidity; could be heavily overvalued or concentrated."
      );
      score -= 15;
    } else if (ratio > 200) {
      reasons.push("FDV significantly higher than liquidity; be cautious.");
      score -= 5;
    }
  }

  // Market cap size (if available)
  const size = marketCapUsd ?? fdvUsd;
  if (size != null) {
    if (size < 1_000_000) {
      reasons.push("Smaller-cap token; more volatile and higher risk.");
      score -= 5;
    } else if (size > 10_000_000) {
      reasons.push("Larger-cap token; generally more mature.");
      score += 5;
    }
  }

  // Age
  if (pairCreatedAt != null && pairCreatedAt > 0) {
    const ageMs = Date.now() - pairCreatedAt;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 3) {
      reasons.push("Very new pool (< 3 days); high launch risk.");
      score -= 15;
    } else if (ageDays < 14) {
      reasons.push("Newish pool (< 2 weeks); still early.");
      score -= 5;
    } else {
      reasons.push("Pool has been live for a while; not a fresh launch.");
      score += 5;
    }
  }

  // Price data missing
  if (priceUsd == null) {
    reasons.push("No reliable USD price; may be off major listings.");
    score -= 10;
  }

  // Final clamp
  score = Math.max(0, Math.min(100, score));

  let health: TokenHealth = "medium";
  if (score >= 75) health = "good";
  else if (score <= 45) health = "risky";

  return { health, reasons };
}

export async function getBaseSingleTokenInfo(
  contractAddress: string
): Promise<BaseSingleTokenInfo | null> {
  // ১) DexScreener থেকে market data
  const pairs = await fetchDexscreenerBasePairs(contractAddress);
  const bestPair = pairs ? pickBestPair(pairs) : null;

  const dexPrice =
    bestPair?.priceUsd != null ? Number(bestPair.priceUsd) : null;
  const liquidityUsd = bestPair?.liquidity?.usd ?? null;
  const volume24hUsd = bestPair?.volume?.h24 ?? null;
  const fdvUsd = bestPair?.fdv ?? null;
  const marketCapUsd = bestPair?.marketCap ?? null;
  const pairUrl = bestPair?.url ?? null;
  const pairCreatedAt = bestPair?.pairCreatedAt ?? null;

  const symbol =
    bestPair?.baseToken?.symbol != null
      ? bestPair.baseToken.symbol
      : null;
  const name =
    bestPair?.baseToken?.name != null ? bestPair.baseToken.name : null;

  // ২) Optional: Alchemy metadata থেকে logo/decimals (যদি আগেই লেখা থাকে)
  let logo: string | null = null;
  let decimals: number | null = null;

  try {
    // যদি তোমার আগের কোডে fetchTokenMetadata থাকে, এটা ব্যবহার করতে পারো
    // না থাকলে এই try ব্লকটা safe ignore করতে পারো
    // @ts-ignore
    if (typeof fetchTokenMetadata === "function") {
      // @ts-ignore
      const meta = await fetchTokenMetadata(contractAddress);
      if (meta) {
        if (!symbol && meta.symbol) {
          // @ts-ignore
          (symbol as any) = meta.symbol;
        }
        if (!name && meta.name) {
          // @ts-ignore
          (name as any) = meta.name;
        }
        logo =
          typeof meta.logo === "string" ? (meta.logo as string) : null;
        decimals =
          typeof meta.decimals === "number"
            ? (meta.decimals as number)
            : null;
      }
    }
  } catch (e) {
    console.warn("Failed to fetch Alchemy token metadata:", e);
  }

  if (!bestPair && !symbol && !name) {
    // একেবারেই কোনো ডাটা পাইনি
    return null;
  }

  const { health, reasons } = scoreFromDexData({
    symbol,
    priceUsd: dexPrice,
    liquidityUsd,
    volume24hUsd,
    fdvUsd,
    marketCapUsd,
    pairCreatedAt,
  });

  return {
    contractAddress,
    symbol,
    name,
    logo,
    decimals,
    priceUsd: dexPrice,
    liquidityUsd,
    fdvUsd,
    marketCapUsd,
    volume24hUsd,
    pairUrl,
    pairCreatedAt: pairCreatedAt ?? null,
    health,
    reasons,
  };
}

