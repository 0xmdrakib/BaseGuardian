"use client";

import { useWallet } from "@/components/wallet/WalletContext";

function shorten(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

export function WalletStatusButton() {
  const wallet = useWallet();
  const pending = wallet.isConnecting || wallet.isReconnecting;
  const state = !wallet.isConnected
    ? "disconnected"
    : wallet.isBase
      ? "connected"
      : "wrong-network";
  const label = pending
    ? wallet.isReconnecting
      ? "Reconnecting…"
      : "Connecting…"
    : !wallet.isConnected
      ? "Connect Wallet"
      : wallet.isBase
        ? shorten(wallet.address)
        : "Switch to Base";

  const handlePrimary = () => {
    if (wallet.isConnected && !wallet.isBase) {
      void wallet.switchToBase();
      return;
    }
    wallet.openWalletPicker();
  };

  return (
    <div className={`wallet-status ${state}`} aria-live="polite">
      <button
        type="button"
        className="wallet-status-main"
        onClick={handlePrimary}
        disabled={pending || wallet.isDisconnecting}
        title={wallet.isConnected && wallet.isBase ? "Choose another wallet" : label}
      >
        <span className="wallet-status-dot" aria-hidden="true" />
        <span>{label}</span>
        {!wallet.isConnected && !pending && (
          <svg
            className="wallet-status-wallet-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 7V5.75A1.75 1.75 0 0 1 6.75 4h10.5A1.75 1.75 0 0 1 19 5.75V7" />
            <rect x="3" y="7" width="18" height="13" rx="3" />
            <path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5Z" />
            <circle cx="16.5" cy="13.5" r="0.75" fill="currentColor" stroke="none" />
          </svg>
        )}
        {pending && <span className="wallet-spinner" aria-hidden="true" />}
      </button>

      {wallet.isConnected && (
        <button
          type="button"
          className="wallet-disconnect"
          onClick={() => void wallet.disconnect()}
          disabled={wallet.isDisconnecting}
          aria-label="Disconnect wallet"
          title="Disconnect wallet"
        >
          {wallet.isDisconnecting ? (
            <span className="wallet-spinner" aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 2v10" />
              <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
