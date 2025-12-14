"use client";

export type TabId = "overview" | "scanner" | "security";

type TabNavProps = {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
};

export function TabNav({ activeTab, onChange }: TabNavProps) {
  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "scanner", label: "Scanner" },
    { id: "security", label: "Security" },
  ];

  return (
    <nav className="flex rounded-2xl border border-white/10 bg-white/[0.03] p-1 text-xs shadow-lg shadow-black/20 backdrop-blur-sm">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={
              "flex-1 rounded-xl px-3 py-2 font-semibold tracking-tight transition focus-visible:ring-2 focus-visible:ring-blue-500/30 " +
              (isActive
                ? "bg-white text-neutral-900 shadow-md shadow-black/30"
                : "text-white/60 hover:bg-white/[0.06] hover:text-white/90")
            }
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
