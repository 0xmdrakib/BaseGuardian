"use client";

import { useState } from "react";
import { OverviewTab } from "@/components/overview/OverviewTab";
import { AssetsTab } from "@/components/assets/AssetsTab";
import { SecurityTab } from "@/components/security/SecurityTab";
import { TabNav, TabId } from "@/components/layout/TabNav";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-4">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Base Guardian
            </h1>
            <p className="text-xs text-neutral-400">
              Wallet health &amp; security on Base.
            </p>
          </div>
        </header>

        {/* Tabs */}
        <TabNav activeTab={activeTab} onChange={setActiveTab} />

        {/* Active tab content */}
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "scanner" && <AssetsTab />}
        {activeTab === "security" && <SecurityTab />}

        <footer className="mt-2 pb-2 text-center text-[10px] text-neutral-500">
          Build for Base 💙 By 0xmdrakib.base.eth
        </footer>
      </div>
    </main>
  );
}
