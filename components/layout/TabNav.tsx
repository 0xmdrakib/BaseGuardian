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
    <nav className="flex rounded-full bg-neutral-900 p-1 text-xs">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={
              "flex-1 rounded-full px-3 py-1 font-medium transition " +
              (isActive
                ? "bg-neutral-100 text-neutral-900"
                : "text-neutral-400 hover:text-neutral-50")
            }
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
