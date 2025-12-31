"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import sdk from "@farcaster/frame-sdk";
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
    const actions = (sdk as any).actions as any;

    try {
      if (actions?.composeCast) {
        await actions.composeCast({ text, embeds: [shareUrl] });
        return;
      }
    } catch {}

    const warpcastComposeUrl =
      "https://warpcast.com/~/compose?text=" +
      encodeURIComponent(text) +
      "&embeds[]=" +
      encodeURIComponent(shareUrl);

    try {
      if (actions?.openUrl) {
        await actions.openUrl(warpcastComposeUrl);
        return;
      }
    } catch {}

    if (typeof window !== "undefined") {
      window.open(warpcastComposeUrl, "_blank", "noopener,noreferrer");
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
              className="btn btn-ghost h-9 w-9 shrink-0 rounded-xl p-0"
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
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
                <path d="M16 6l-4-4-4 4" />
                <path d="M12 2v14" />
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
