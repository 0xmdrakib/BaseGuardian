export const BASE_MAINNET_HEX_CHAIN_ID = "0x2105";

export function walletChainIsMissing(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as { code?: unknown; message?: unknown; cause?: unknown };
  return (
    error.code === 4902 ||
    (typeof error.message === "string" &&
      (error.message.toLowerCase().includes("unrecognized chain") ||
        error.message.toLowerCase().includes("chain has not been added"))) ||
    (error.cause !== cause && walletChainIsMissing(error.cause))
  );
}

export async function requestBaseWalletSwitch(connector: {
  getProvider: () => Promise<unknown>;
}) {
  const provider = (await connector.getProvider()) as
    | {
        request: (request: {
          method: string;
          params?: readonly unknown[];
        }) => Promise<unknown>;
      }
    | undefined;
  if (!provider?.request) {
    throw new Error("This wallet cannot switch networks from the app.");
  }
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: BASE_MAINNET_HEX_CHAIN_ID }],
  });
}
