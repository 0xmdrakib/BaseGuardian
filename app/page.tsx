"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { OverviewTab } from "@/components/overview/OverviewTab";
import { AssetsTab } from "@/components/assets/AssetsTab";
import { SecurityTab } from "@/components/security/SecurityTab";
import { TabNav, TabId } from "@/components/layout/TabNav";
import { WalletStatusButton } from "@/components/wallet/WalletStatusButton";
import { useWallet } from "@/components/wallet/WalletContext";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const wallet = useWallet();

  useEffect(() => {
    // Helps Warpcast/Farcaster webviews know the app is ready.
    sdk.actions.ready().catch(() => {});
  }, []);
  return (
    <main className="min-h-screen text-neutral-100">
      <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-5 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
        <div className="panel p-4">
          {/* Header */}
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Image
                src="/logo.png" // <-- public/logo.png
                alt="Base Guardian logo"
                width={32}
                height={32}
                className="rounded-xl ring-1 ring-white/10"
                priority
              />
              <div>
                <h1 className="text-lg font-semibold tracking-tight">
                  Base Guardian
                </h1>
                <p className="text-xs text-neutral-400">
                  Wallet health &amp; security on Base.
                </p>
              </div>
            </div>

            <WalletStatusButton />
          </header>

          {wallet.error && (
            <div className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100" role="alert">
              <span>{wallet.error}</span>
              <button
                type="button"
                onClick={wallet.clearError}
                className="shrink-0 text-amber-100/60 transition hover:text-amber-100"
                aria-label="Dismiss wallet message"
              >
                ×
              </button>
            </div>
          )}

          <div className="mt-4">
            {/* Tabs */}
            <TabNav activeTab={activeTab} onChange={setActiveTab} />

            {/* Active tab content */}
            <div className="mt-4">
              {activeTab === "overview" && <OverviewTab />}
              {activeTab === "scanner" && <AssetsTab />}
              {activeTab === "security" && <SecurityTab />}
            </div>
          </div>

        </div>

        <footer className="text-center text-[10px] text-neutral-500">
          © 2026 Md. Rakib • made with love and passion.
        </footer>
      </div>
    </main>
  );
}
