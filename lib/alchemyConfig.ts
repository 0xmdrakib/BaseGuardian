const ALCHEMY_BASE_HOST = "base-mainnet.g.alchemy.com";
const ALCHEMY_BASE_PREFIX = `https://${ALCHEMY_BASE_HOST}/v2/`;

export type AlchemyBaseConfig = {
  apiKey: string;
  rpcUrl: string;
};

type AlchemyEnv = {
  ALCHEMY_BASE_RPC_URL?: string;
  ALCHEMY_BASE_API_URL?: string;
  ALCHEMY_BASE_API_KEY?: string;
};

export function getAlchemyBaseConfig(env?: AlchemyEnv): AlchemyBaseConfig | null {
  const source = env ?? {
    ALCHEMY_BASE_RPC_URL: process.env.ALCHEMY_BASE_RPC_URL,
    ALCHEMY_BASE_API_URL: process.env.ALCHEMY_BASE_API_URL,
    ALCHEMY_BASE_API_KEY: process.env.ALCHEMY_BASE_API_KEY,
  };
  const configured =
    source.ALCHEMY_BASE_RPC_URL?.trim() ||
    source.ALCHEMY_BASE_API_URL?.trim() ||
    source.ALCHEMY_BASE_API_KEY?.trim();
  if (!configured) return null;

  if (!configured.startsWith("http://") && !configured.startsWith("https://")) {
    return {
      apiKey: configured,
      rpcUrl: `${ALCHEMY_BASE_PREFIX}${configured}`,
    };
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("Alchemy Base RPC URL is invalid.");
  }

  const pathMatch = url.pathname.match(/^\/v2\/([^/]+)\/?$/);
  if (
    url.protocol !== "https:" ||
    url.hostname !== ALCHEMY_BASE_HOST ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !pathMatch
  ) {
    throw new Error(
      `Alchemy Base RPC URL must match ${ALCHEMY_BASE_PREFIX}<API_KEY>.`
    );
  }

  const apiKey = decodeURIComponent(pathMatch[1]);
  if (!apiKey) throw new Error("Alchemy Base RPC URL is missing its API key.");

  return {
    apiKey,
    rpcUrl: `${ALCHEMY_BASE_PREFIX}${encodeURIComponent(apiKey)}`,
  };
}

export function requireAlchemyBaseConfig() {
  const config = getAlchemyBaseConfig();
  if (!config) {
    throw new Error(
      "Set ALCHEMY_BASE_RPC_URL, ALCHEMY_BASE_API_URL, or ALCHEMY_BASE_API_KEY."
    );
  }
  return config;
}

export function getAlchemyPricesUrl() {
  const config = getAlchemyBaseConfig();
  return config
    ? `https://api.g.alchemy.com/prices/v1/${encodeURIComponent(
        config.apiKey
      )}/tokens/by-address`
    : "";
}
