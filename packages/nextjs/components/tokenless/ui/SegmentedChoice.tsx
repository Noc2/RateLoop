"use client";

type SegmentedChoiceOption<Value extends string> = {
  value: Value;
  label: string;
};

export function SegmentedChoice<Value extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: Value;
  options: readonly SegmentedChoiceOption<Value>[];
  onChange: (value: Value) => void;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            className={`min-h-9 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              selected
                ? "border-[var(--rateloop-blue)]/45 bg-[var(--rateloop-blue)]/12 text-base-content"
                : "border-base-content/15 bg-base-content/[0.025] text-base-content/65 hover:bg-base-content/[0.06]"
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
