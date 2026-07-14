"use client";

export type AskTab = "public" | "private" | "history";

export function AskPageTabs({ active, onChange }: { active: AskTab; onChange: (value: AskTab) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Ask workflows">
      {(["public", "private", "history"] as const).map(value => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={active === value}
          onClick={() => onChange(value)}
          className={`tab-control px-4 py-1.5 text-base font-medium capitalize transition-colors ${
            active === value ? "pill-active" : "pill-inactive"
          }`}
        >
          {value === "private" ? "Private evaluation" : value}
        </button>
      ))}
    </div>
  );
}
