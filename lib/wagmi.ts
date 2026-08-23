import { createConfig } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { custom, type Transport } from "viem";
import { createAppBaseChain } from "@/lib/baseChain";
import { getBuilderCodeDataSuffix } from "@/lib/builderCode";

const APP_URL = "https://baseguardian.rakibhq.xyz";

export function createDisabledBrowserRpcTransport(
  rpcDisabledUrl: string
): Transport {
  const disabled = custom(
    {
      request: async ({ method }) => {
        throw new Error(`Direct browser Base RPC is disabled: ${method}`);
      },
    },
    {
      key: "disabled-browser-base-rpc",
      name: "Server-only Base RPC",
      retryCount: 0,
    }
  );

  return (options) => ({
    ...disabled(options),
    value: { url: rpcDisabledUrl },
  });
}

function createWagmiConfig() {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  const dataSuffix = getBuilderCodeDataSuffix();

  if (!projectId) {
    throw new Error(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required for wallet connections."
    );
  }

  const appUrl = typeof window === "undefined" ? APP_URL : window.location.origin;
  const rpcDisabledUrl = `${appUrl}/api/base/rpc-disabled`;
  const appBase = createAppBaseChain(rpcDisabledUrl);
  const connectors =
    typeof window === "undefined"
      ? [injected({ shimDisconnect: true })]
      : [
          injected({ shimDisconnect: true }),
          walletConnect({
            projectId,
            showQrModal: true,
            metadata: {
              name: "Base Guardian",
              description: "Wallet health and security checks on Base.",
              url: appUrl,
              icons: [`${appUrl}/icon.png`],
            },
          }),
        ];

  return createConfig({
    chains: [appBase],
    connectors,
    multiInjectedProviderDiscovery: true,
    ssr: true,
    ...(dataSuffix ? { dataSuffix } : {}),
    transports: {
      [appBase.id]: createDisabledBrowserRpcTransport(rpcDisabledUrl),
    },
  });
}

export type WagmiConfig = ReturnType<typeof createWagmiConfig>;

let browserConfig: WagmiConfig | undefined;

export function getWagmiConfig() {
  if (typeof window !== "undefined" && browserConfig) return browserConfig;

  const config = createWagmiConfig();
  if (typeof window !== "undefined") browserConfig = config;
  return config;
}
