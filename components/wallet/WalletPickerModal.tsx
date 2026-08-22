"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Connector } from "wagmi";

type WalletPickerModalProps = {
  open: boolean;
  connectors: readonly Connector[];
  pendingConnectorUid: string | null;
  error: string | null;
  onConnect: (connector: Connector) => void;
  onClose: () => void;
};

function isWalletConnect(connector: Connector) {
  return (
    connector.type === "walletConnect" ||
    connector.id.toLowerCase().includes("walletconnect")
  );
}

function dedupeBrowserConnectors(connectors: readonly Connector[]) {
  const browser = connectors.filter((connector) => !isWalletConnect(connector));
  const named = browser.filter(
    (connector) => connector.name.toLowerCase() !== "injected"
  );
  const source = named.length > 0 ? named : browser;
  const seen = new Set<string>();

  return source.filter((connector) => {
    const key = `${connector.name}:${connector.icon ?? ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function WalletConnectIcon() {
  return (
    <svg viewBox="0 0 300 300" aria-hidden="true">
      <rect width="300" height="300" rx="72" fill="#3b99fc" />
      <g transform="translate(45 85.25) scale(.7)">
        <path
          d="M61.439 36.256c48.911-47.888 128.211-47.888 177.123 0l5.886 5.764a6.09 6.09 0 0 1 0 8.671l-20.136 19.715a3.17 3.17 0 0 1-4.429 0l-8.1-7.931c-34.122-33.408-89.444-33.408-123.566 0l-8.675 8.494a3.17 3.17 0 0 1-4.428 0L54.978 51.253a6.09 6.09 0 0 1 0-8.671l6.461-6.326Zm218.767 40.774 17.922 17.547a6.09 6.09 0 0 1 0 8.671l-80.81 79.121a6.36 6.36 0 0 1-8.856 0l-57.354-56.155a1.59 1.59 0 0 0-2.215 0L91.541 182.37a6.36 6.36 0 0 1-8.857 0L1.872 103.247a6.09 6.09 0 0 1 0-8.671l17.922-17.547a6.36 6.36 0 0 1 8.856 0l57.355 56.155a1.59 1.59 0 0 0 2.214 0l57.352-56.155a6.36 6.36 0 0 1 8.856 0l57.355 56.155a1.59 1.59 0 0 0 2.214 0l57.354-56.154a6.36 6.36 0 0 1 8.856 0Z"
          fill="white"
        />
      </g>
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg className="wallet-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 7a3 3 0 0 1 3-3h11a2 2 0 0 1 2 2v2" />
      <path d="M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a3 3 0 0 1-3-3V7Z" />
      <path d="M16 13h2" />
    </svg>
  );
}

function ConnectorIcon({ connector }: { connector: Connector }) {
  if (isWalletConnect(connector)) return <WalletConnectIcon />;
  if (connector.icon) {
    // Connector icons are runtime data URLs/URLs and cannot use a static Next image loader.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={connector.icon} alt="" />;
  }
  return <WalletIcon />;
}

export function WalletPickerModal({
  open,
  connectors,
  pendingConnectorUid,
  error,
  onConnect,
  onClose,
}: WalletPickerModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const browserConnectorCandidates = useMemo(
    () => dedupeBrowserConnectors(connectors),
    [connectors]
  );
  const [detectedBrowserUids, setDetectedBrowserUids] = useState<Set<string>>(
    new Set()
  );
  const [detectionComplete, setDetectionComplete] = useState(false);
  const browserConnectors = browserConnectorCandidates.filter((connector) =>
    detectedBrowserUids.has(connector.uid)
  );
  const walletConnectConnector = connectors.find(isWalletConnect);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void Promise.all(
      browserConnectorCandidates.map(async (connector) => {
        const provider = await connector.getProvider().catch(() => undefined);
        return provider ? connector.uid : null;
      })
    ).then((uids) => {
      if (cancelled) return;
      setDetectedBrowserUids(new Set(uids.filter((uid): uid is string => Boolean(uid))));
      setDetectionComplete(true);
    });

    return () => {
      cancelled = true;
    };
  }, [browserConnectorCandidates, open]);

  useEffect(() => {
    if (!open) return;

    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const connecting = pendingConnectorUid !== null;
  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !connecting) onClose();
  };

  const choice = (connector: Connector, mobile = false) => {
    const pending = connector.uid === pendingConnectorUid;
    return (
      <button
        className="wallet-choice"
        key={connector.uid}
        type="button"
        disabled={connecting}
        onClick={() => onConnect(connector)}
      >
        <span className={`wallet-choice-icon${mobile ? " walletconnect-icon" : ""}`}>
          <ConnectorIcon connector={connector} />
        </span>
        <span className="wallet-choice-copy">
          <strong>{mobile ? "WalletConnect" : connector.name}</strong>
          <small>{mobile ? "Scan with a mobile wallet" : "Browser wallet"}</small>
        </span>
        {pending && <span className="wallet-spinner" aria-label="Connecting" />}
      </button>
    );
  };

  return (
    <div className="wallet-modal-overlay" onMouseDown={handleBackdrop}>
      <section
        ref={dialogRef}
        className="wallet-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
        aria-describedby="wallet-modal-description"
      >
        <header className="wallet-modal-header">
          <div>
            <span>Wallet connection</span>
            <h2 id="wallet-modal-title">Choose wallet</h2>
            <p id="wallet-modal-description">
              Select an installed browser wallet or connect from mobile.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="wallet-modal-close"
            onClick={onClose}
            disabled={connecting}
            aria-label="Close wallet picker"
          >
            ×
          </button>
        </header>

        {error && <div className="wallet-modal-error" role="alert">{error}</div>}

        <div className="wallet-choice-list" aria-label="Detected browser wallets">
          {!detectionComplete ? (
            <div className="wallet-empty-state" aria-label="Detecting browser wallets">
              <span className="wallet-spinner" />
              <div>
                <strong>Detecting browser wallets</strong>
                <span>Checking available EVM providers…</span>
              </div>
            </div>
          ) : browserConnectors.length > 0 ? (
            browserConnectors.map((connector) => choice(connector))
          ) : (
            <div className="wallet-empty-state">
              <WalletIcon />
              <div>
                <strong>No browser wallet detected</strong>
                <span>Install an EVM wallet extension or use WalletConnect.</span>
              </div>
            </div>
          )}
        </div>

        <div className="walletconnect-section">
          {walletConnectConnector && choice(walletConnectConnector, true)}
        </div>

        <footer className="wallet-modal-footer">
          <button type="button" onClick={onClose} disabled={connecting}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}
