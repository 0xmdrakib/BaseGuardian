import { JsonRpcProvider } from "ethers";

let provider: JsonRpcProvider | null = null;

function getProvider(): JsonRpcProvider {
  if (provider) return provider;

  const key = process.env.ALCHEMY_BASE_API_KEY;
  if (!key) {
    throw new Error("ALCHEMY_BASE_API_KEY is not set");
  }

  provider = new JsonRpcProvider(
    `https://base-mainnet.g.alchemy.com/v2/${key}`
  );
  return provider;
}

/**
 * Accepts:
 *  - 0x addresses
 *  - .base.eth / .eth names (e.g. 0xmdrakib.base.eth)
 * Returns normalized 0x address (lowercase).
 */
export async function resolveBaseAddressOrName(
  input: string
): Promise<string> {
  const trimmed = input.trim();

  // Plain 0x address
  if (trimmed.startsWith("0x") && trimmed.length === 42) {
    return trimmed.toLowerCase();
  }

  const lower = trimmed.toLowerCase();

  // Accept name forms like "0xmdrakib.base.eth"
  if (lower.endsWith(".base.eth") || lower.endsWith(".eth")) {
    const p = getProvider();
    try {
      const resolved = await p.resolveName(lower);
      if (!resolved) {
        throw new Error(`Could not resolve name ${lower}`);
      }
      return resolved.toLowerCase();
    } catch (err) {
      console.error("Name resolution error", err);
      throw new Error(`Failed to resolve name: ${lower}`);
    }
  }

  throw new Error("Input must be a 0x address or .base.eth name");
}
