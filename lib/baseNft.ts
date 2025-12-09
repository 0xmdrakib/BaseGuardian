// lib/baseNft.ts
// Simple Base NFT collection summary using only Alchemy RPC (no OpenSea).

const ALCHEMY_BASE_API_KEY = process.env.ALCHEMY_BASE_API_KEY;

const BASE_URL = ALCHEMY_BASE_API_KEY
  ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_BASE_API_KEY}`
  : "";

async function callAlchemy(body: any): Promise<any> {
  if (!BASE_URL) {
    throw new Error("Missing ALCHEMY_BASE_API_KEY env");
  }

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    throw new Error(`Alchemy HTTP ${res.status}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(
      `Alchemy error: ${json.error.message ?? json.error.code ?? "unknown"}`
    );
  }

  return json.result;
}

export type NftHealth = "good" | "medium" | "risky";

export type BaseNftCollectionSummary = {
  contractAddress: string;
  name: string | null;
  symbol: string | null;
  tokenStandard: "ERC721" | "ERC1155" | "unknown";
  totalSupply: number | null;
  numOwners: number | null;
  floorPriceNative: number | null;
  floorPriceSymbol: string | null;
  marketCap: number | null;
  sampleTokenId: string | null;
  health: NftHealth;
  reasons: string[];
};

export async function getBaseNftCollectionSummary(
  contractAddress: string
): Promise<BaseNftCollectionSummary> {
  const addr = contractAddress.toLowerCase();

  // Basic ERC-style calls for metadata
  const [name, symbol, totalSupply] = await Promise.all([
    tryReadString(addr, "0x06fdde03"), // name()
    tryReadString(addr, "0x95d89b41"), // symbol()
    tryReadUint(addr, "0x18160ddd"), // totalSupply()
  ]);

  // NFT transfers on Base for this contract
  const transfers = await fetchNftTransfers(addr);

  const owners = new Set<string>();
  let sampleTokenId: string | null = null;

  for (const t of transfers) {
    if (t.to) {
      owners.add((t.to as string).toLowerCase());
    }
    const tokenId: string | undefined =
      (t.erc721TokenId as string | undefined) ??
      (t.erc1155Metadata &&
        t.erc1155Metadata[0] &&
        (t.erc1155Metadata[0].tokenId as string));

    if (!sampleTokenId && tokenId) {
      sampleTokenId = tokenId;
    }
  }

  const numOwners = owners.size > 0 ? owners.size : null;
  const tokenStandard = inferTokenStandard(transfers);

  const { health, reasons } = scoreCollection({
    numOwners,
    totalSupply,
  });

  return {
    contractAddress: addr,
    name,
    symbol,
    tokenStandard,
    totalSupply,
    numOwners,
    floorPriceNative: null, // no off-chain price here
    floorPriceSymbol: "ETH",
    marketCap: null,
    sampleTokenId,
    health,
    reasons,
  };
}

/* ----------------- helpers ----------------- */

// Scan erc721 / erc1155 transfers for the contract
async function fetchNftTransfers(contractAddress: string): Promise<any[]> {
  const transfers: any[] = [];
  let pageKey: string | undefined;
  const maxPages = 3;

  for (let page = 0; page < maxPages; page++) {
    const result = await callAlchemy({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getAssetTransfers",
      params: [
        {
          fromBlock: "0x0",
          toBlock: "latest",
          category: ["erc721", "erc1155"],
          contractAddresses: [contractAddress],
          withMetadata: true,
          excludeZeroValue: false,
          maxCount: "0x64",
          pageKey,
        },
      ],
    });

    const chunk = (result?.transfers ?? []) as any[];
    transfers.push(...chunk);

    pageKey = result?.pageKey as string | undefined;
    if (!pageKey) break;
  }

  return transfers;
}

function inferTokenStandard(
  transfers: any[]
): "ERC721" | "ERC1155" | "unknown" {
  let count721 = 0;
  let count1155 = 0;

  for (const t of transfers) {
    const cat = (t.category as string | undefined) ?? "";
    if (cat === "erc721") count721++;
    else if (cat === "erc1155") count1155++;
  }

  if (count721 === 0 && count1155 === 0) return "unknown";
  if (count721 >= count1155) return "ERC721";
  return "ERC1155";
}

async function ethCall(to: string, data: string): Promise<string | null> {
  try {
    const result = await callAlchemy({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    });

    if (typeof result !== "string") return null;
    const hex: string = result;
    if (!hex || hex === "0x") return null;
    return hex;
  } catch {
    return null;
  }
}

async function tryReadString(
  contractAddress: string,
  selector: string
): Promise<string | null> {
  const raw = await ethCall(contractAddress, selector);
  if (!raw) return null;
  return decodeAbiString(raw);
}

async function tryReadUint(
  contractAddress: string,
  selector: string
): Promise<number | null> {
  const raw = await ethCall(contractAddress, selector);
  if (!raw) return null;
  return decodeAbiUint(raw);
}

// basic ABI string decode
function decodeAbiString(data: string): string | null {
  if (!data || data === "0x") return null;
  const hex = data.slice(2);
  if (hex.length < 128) return null;

  const lengthHex = hex.slice(64, 128);
  const length = parseInt(lengthHex, 16);
  if (!Number.isFinite(length) || length <= 0) return null;

  const stringHex = hex.slice(128, 128 + length * 2);
  if (!stringHex) return null;

  let out = "";
  for (let i = 0; i < stringHex.length; i += 2) {
    const byte = parseInt(stringHex.slice(i, i + 2), 16);
    if (!Number.isFinite(byte) || byte === 0) continue;
    out += String.fromCharCode(byte);
  }
  return out || null;
}

function decodeAbiUint(data: string): number | null {
  if (!data || data === "0x") return null;
  const hex = data.slice(2);
  if (hex.length < 64) return null;
  const lastWord = hex.slice(hex.length - 64);
  let bn: bigint;
  try {
    bn = BigInt("0x" + lastWord);
  } catch {
    return null;
  }
  if (bn > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(bn);
}

function scoreCollection(input: {
  numOwners: number | null;
  totalSupply: number | null;
}): { health: NftHealth; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (input.totalSupply != null) {
    if (input.totalSupply <= 5000) {
      score += 2;
      reasons.push("Relatively low total supply collection.");
    } else if (input.totalSupply <= 20000) {
      score += 1;
      reasons.push("Moderate total supply.");
    } else {
      reasons.push("High total supply; may be more diluted.");
    }
  } else {
    reasons.push("Total supply not reported by contract.");
  }

  if (input.numOwners != null) {
    if (input.numOwners >= 1000) {
      score += 2;
      reasons.push("Large holder base; widely held.");
    } else if (input.numOwners >= 200) {
      score += 1;
      reasons.push("Moderate number of unique holders.");
    } else {
      reasons.push("Few holders detected; may be illiquid.");
    }
  } else {
    reasons.push("Could not estimate unique holder count.");
  }

  let health: NftHealth = "medium";
  if (score <= 1) health = "risky";
  else if (score >= 4) health = "good";

  return { health, reasons };
}
