"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  type Connector,
} from "wagmi";
import { base } from "wagmi/chains";
import { WalletPickerModal } from "@/components/wallet/WalletPickerModal";

type WalletContextValue = {
  address?: `0x${string}`;
  chainId?: number;
  connector?: Connector;
  connectors: readonly Connector[];
  error: string | null;
  isBase: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isReconnecting: boolean;
  clearError: () => void;
  disconnect: () => Promise<void>;
  openWalletPicker: () => void;
  switchToBase: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

function friendlyWalletError(cause: unknown, fallback: string) {
  if (!(cause instanceof Error)) return fallback;

  const message = cause.message.toLowerCase();
  if (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("request rejected")
  ) {
    return "Wallet request cancelled.";
  }

  const firstLine = cause.message.split("\n")[0]?.trim();
  if (!firstLine) return fallback;
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { connectors, connectAsync, isPending: connectPending } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync, isPending: switchPending } = useSwitchChain();
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [pendingConnectorUid, setPendingConnectorUid] = useState<string | null>(
    null
  );
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchToBase = useCallback(async () => {
    setError(null);
    try {
      await switchChainAsync({
        chainId: base.id,
        connector: account.connector,
      });
    } catch (cause) {
      setError(
        friendlyWalletError(
          cause,
          "Wallet connected, but it could not switch to Base. Try again from the wallet button."
        )
      );
    }
  }, [account.connector, switchChainAsync]);

  const connectWallet = useCallback(
    async (connector: Connector) => {
      setError(null);
      setPendingConnectorUid(connector.uid);

      try {
        const result = await connectAsync({ connector });
        setWalletPickerOpen(false);

        if (result.chainId !== base.id) {
          try {
            await switchChainAsync({ chainId: base.id, connector });
          } catch (cause) {
            setError(
              friendlyWalletError(
                cause,
                "Wallet connected. Switch to Base before making Base transactions."
              )
            );
          }
        }
      } catch (cause) {
        setError(friendlyWalletError(cause, "Wallet connection failed."));
      } finally {
        setPendingConnectorUid(null);
      }
    },
    [connectAsync, switchChainAsync]
  );

  const disconnect = useCallback(async () => {
    setError(null);
    setWalletPickerOpen(false);
    setIsDisconnecting(true);
    try {
      await disconnectAsync(
        account.connector ? { connector: account.connector } : undefined
      );
    } catch (cause) {
      setError(friendlyWalletError(cause, "Wallet disconnect failed."));
    } finally {
      setIsDisconnecting(false);
    }
  }, [account.connector, disconnectAsync]);

  const openWalletPicker = useCallback(() => {
    setError(null);
    setWalletPickerOpen(true);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      address: account.address,
      chainId: account.chainId,
      connector: account.connector,
      connectors,
      error,
      isBase: account.chainId === base.id,
      isConnected: account.isConnected,
      isConnecting: connectPending || switchPending,
      isDisconnecting,
      isReconnecting: account.isReconnecting,
      clearError: () => setError(null),
      disconnect,
      openWalletPicker,
      switchToBase,
    }),
    [
      account.address,
      account.chainId,
      account.connector,
      account.isConnected,
      account.isReconnecting,
      connectPending,
      connectors,
      disconnect,
      error,
      isDisconnecting,
      openWalletPicker,
      switchPending,
      switchToBase,
    ]
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <WalletPickerModal
        connectors={connectors}
        error={walletPickerOpen ? error : null}
        open={walletPickerOpen}
        pendingConnectorUid={pendingConnectorUid}
        onClose={() => setWalletPickerOpen(false)}
        onConnect={connectWallet}
      />
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider.");
  return value;
}
