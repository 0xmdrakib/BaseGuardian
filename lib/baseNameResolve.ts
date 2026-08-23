import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  namehash,
  parseAbi,
  toCoinType,
  zeroAddress,
  type Address,
} from "viem";
import { normalize } from "viem/ens";
import { base, mainnet } from "viem/chains";
import {
  getAlchemyEthereumRpcUrl,
  requireAlchemyBaseConfig,
} from "@/lib/alchemyConfig";
import { safeServerError } from "@/lib/safeServerError";

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

const BASENAME_REGISTRY_ADDRESS = getAddress(
  "0xb94704422c2a1e396835a571837aa5ae53285a95"
);
const registryAbi = parseAbi([
  "function resolver(bytes32 node) view returns (address)",
]);
const addressResolverAbi = parseAbi([
  "function addr(bytes32 node) view returns (address)",
]);
const multicoinAddressResolverAbi = parseAbi([
  "function addr(bytes32 node, uint256 coinType) view returns (bytes)",
]);

type BaseContractReader = {
  readContract(args: {
    abi:
      | typeof registryAbi
      | typeof addressResolverAbi
      | typeof multicoinAddressResolverAbi;
    address: Address;
    functionName: "resolver" | "addr";
    args: readonly unknown[];
  }): Promise<unknown>;
};

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

function getBaseClient() {
  return createPublicClient({
    chain: base,
    transport: http(requireAlchemyBaseConfig().rpcUrl, {
      retryCount: 0,
      timeout: 6_000,
    }),
  });
}

export async function resolveBasenameOnBase(
  name: string,
  reader: BaseContractReader = getBaseClient() as BaseContractReader
): Promise<Address | null> {
  const node = namehash(normalize(name));
  const resolver = await reader.readContract({
    abi: registryAbi,
    address: BASENAME_REGISTRY_ADDRESS,
    functionName: "resolver",
    args: [node],
  });
  if (
    typeof resolver !== "string" ||
    !isAddress(resolver) ||
    isAddressEqual(resolver, zeroAddress)
  ) {
    return null;
  }

  try {
    const baseRecord = await reader.readContract({
      abi: multicoinAddressResolverAbi,
      address: getAddress(resolver),
      functionName: "addr",
      args: [node, toCoinType(base.id)],
    });
    if (
      typeof baseRecord === "string" &&
      isAddress(baseRecord) &&
      !isAddressEqual(baseRecord, zeroAddress)
    ) {
      return getAddress(baseRecord);
    }
  } catch {
    // Older/custom resolvers may only implement the default EVM record.
  }

  const resolved = await reader.readContract({
    abi: addressResolverAbi,
    address: getAddress(resolver),
    functionName: "addr",
    args: [node],
  });
  if (
    typeof resolved !== "string" ||
    !isAddress(resolved) ||
    isAddressEqual(resolved, zeroAddress)
  ) {
    return null;
  }
  return getAddress(resolved);
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

async function resolveNameOnchain(name: string): Promise<Address | null> {
  return name.endsWith(".base.eth")
    ? resolveBasenameOnBase(name)
    : resolveNameOnEthereum(name);
}

export async function resolveBaseAddressOrName(
  input: string,
  resolveName: ResolveName = resolveNameOnchain
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
    console.error("Base name resolution failed", safeServerError(error));
    throw new BaseNameResolutionError(
      `Could not resolve ${lower} right now. Please try again.`,
      502
    );
  }
}
