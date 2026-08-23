import { defineChain } from "viem";

export const BASE_MAINNET_CHAIN_ID = 8453;

export function createAppBaseChain(rpcDisabledUrl: string) {
  return defineChain({
    id: BASE_MAINNET_CHAIN_ID,
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcDisabledUrl] } },
    blockExplorers: {
      default: {
        name: "Basescan",
        url: "https://basescan.org",
        apiUrl: "https://api.basescan.org/api",
      },
    },
    contracts: {
      multicall3: {
        address: "0xcA11bde05977b3631167028862bE2a173976CA11",
        blockCreated: 5022,
      },
    },
  });
}
