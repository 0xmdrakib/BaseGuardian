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

    // Native Farcaster/Base cast composer (best UX). If this fails (e.g. not inside a client),
    // we **do not** navigate away — we fall back to copying the share text instead.
    try {
      await sdk.actions.composeCast({ text, embeds: [shareUrl] });
      return;
    } catch (err) {
      console.warn("composeCast failed:", err);
    }

    try {
      await navigator.clipboard.writeText(`${text} ${shareUrl}`);
      // eslint-disable-next-line no-alert
      alert("Open Base/Warpcast to share. Copied text + link to your clipboard.");
    } catch {
      // eslint-disable-next-line no-alert
      alert(`${text} ${shareUrl}`);
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
              className="btn btn-ghost h-9 shrink-0 gap-2 rounded-full px-3"
              aria-label="Share as cast"
              title="Share as cast"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/10">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  {/* Paper plane */}
                  <path d="M22 2L11 13" />
                  <path d="M22 2L15 22l-4-9-9-4 20-7z" />
                </svg>
              </span>
              <span className="text-[11px] font-medium tracking-wide text-white/90">
                Share
              </span>
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
