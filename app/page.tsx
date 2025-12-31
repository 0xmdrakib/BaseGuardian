"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { OverviewTab } from "@/components/overview/OverviewTab";
import { AssetsTab } from "@/components/assets/AssetsTab";
import { SecurityTab } from "@/components/security/SecurityTab";
import { TabNav, TabId } from "@/components/layout/TabNav";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  useEffect(() => {
    // Helps Warpcast/Farcaster webviews know the app is ready.
    sdk.actions.ready().catch(() => {});
  }, []);


  const handleShare = async () => {
    const shareUrl = "https://baseguardian.vercel.app";
    const text = "I just used Base Guardian.";

    // Mini App native cast composer (Base app / Warpcast / other Farcaster hosts)
    try {
      await sdk.actions.composeCast({ text, embeds: [shareUrl] });
      return;
    } catch (e) {
      // Don't kick the user out to a browser link — just explain why it can't open here.
      if (typeof window !== "undefined") {
        window.alert(
          "Sharing opens the Farcaster cast composer only when this app is opened inside a Farcaster client (Base app / Warpcast)."
        );
      }
    }
  };

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

            <button
              type="button"
              onClick={handleShare}
              className="group inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10 transition hover:bg-white/10 active:scale-95"
              aria-label="Share"
              title="Share"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 transition-transform group-hover:scale-105"
                aria-hidden="true"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.59 13.51 15.42 17.49" />
                <path d="M15.41 6.51 8.59 10.49" />
              </svg>
            </button>
          </header>

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

          <footer className="mt-4 text-center text-[10px] text-neutral-500">
            Build for Base 💙 By 0xmdrakib.base.eth
          </footer>
        </div>
      </div>
    </main>
  );
}
