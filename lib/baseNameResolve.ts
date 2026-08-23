import {
  createPublicClient,
  getAddress,
  http,
  toCoinType,
  type Address,
} from "viem";
import { normalize } from "viem/ens";
import { base, mainnet } from "viem/chains";
import { getAlchemyEthereumRpcUrl } from "@/lib/alchemyConfig";

type ResolveName = (name: string) => Promise<Address | null>;

export class BaseNameResolutionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 502
  ) {
    super(message);
    this.name = "BaseNameResolutionError";
  }
}

let ethereumClient: ReturnType<typeof createPublicClient> | null = null;

function getEthereumClient() {
  if (ethereumClient) return ethereumClient;
  ethereumClient = createPublicClient({
    chain: mainnet,
    transport: http(getAlchemyEthereumRpcUrl(), {
      // Resolution and approval discovery share one API-route deadline.
      retryCount: 0,
      timeout: 6_000,
    }),
  });
  return ethereumClient;
}

async function resolveNameOnEthereum(name: string): Promise<Address | null> {
  const client = getEthereumClient();
  const normalized = normalize(name);
  const baseAddress = await client.getEnsAddress({
    name: normalized,
    coinType: toCoinType(base.id),
  });
  if (baseAddress) return baseAddress;

  // Preserve the common case where an ENS profile uses one EVM address and
  // has not configured a separate Base coin-type record.
  return client.getEnsAddress({ name: normalized });
}

export async function resolveBaseAddressOrName(
  input: string,
  resolveName: ResolveName = resolveNameOnEthereum
): Promise<string> {
  const trimmed = input.trim();

  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return getAddress(trimmed).toLowerCase();
  }

  const lower = trimmed.toLowerCase();
  if (!lower.endsWith(".base.eth") && !lower.endsWith(".eth")) {
    throw new BaseNameResolutionError(
      "Enter a valid EVM address, .eth name, or .base.eth name.",
      400
    );
  }

  try {
    const resolved = await resolveName(lower);
    if (!resolved) {
      throw new BaseNameResolutionError(
        `No Base address was found for ${lower}.`,
        404
      );
    }
    return getAddress(resolved).toLowerCase();
  } catch (error) {
    if (error instanceof BaseNameResolutionError) throw error;
    console.error("Base name resolution failed", error);
    throw new BaseNameResolutionError(
      `Could not resolve ${lower} right now. Please try again.`,
      502
    );
  }
}
