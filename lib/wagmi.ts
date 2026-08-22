import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { getBuilderCodeDataSuffix } from "@/lib/builderCode";

const APP_URL = "https://baseguardian.rakibhq.xyz";

function createWagmiConfig() {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  const dataSuffix = getBuilderCodeDataSuffix();

  if (!projectId) {
    throw new Error(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required for wallet connections."
    );
  }

  const appUrl = typeof window === "undefined" ? APP_URL : window.location.origin;
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
    chains: [base],
    connectors,
    multiInjectedProviderDiscovery: true,
    ssr: true,
    ...(dataSuffix ? { dataSuffix } : {}),
    transports: {
      [base.id]: http(),
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
