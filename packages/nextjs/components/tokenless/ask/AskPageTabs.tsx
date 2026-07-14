"use client";

export type AskTab = "public" | "private" | "history";

export function AskPageTabs({ active, onChange }: { active: AskTab; onChange: (value: AskTab) => void }) {
  return (
    <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label="Ask workflows">
      {(["public", "private", "history"] as const).map(value => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={active === value}
          onClick={() => onChange(value)}
          className={`rounded-full border px-4 py-2 text-sm capitalize transition-colors ${active === value ? "border-base-content bg-base-content font-semibold text-base-100" : "border-white/10 text-base-content/60 hover:border-white/25"}`}
        >
          {value === "private" ? "Private evaluation" : value}
        </button>
      ))}
    </div>
  );
}
