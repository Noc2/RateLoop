import type { ReactNode } from "react";
import { classNames } from "~~/components/tokenless/ui/classNames";

export function SetupChoiceGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={classNames("surface-card-nested mt-3 overflow-hidden", className)}>{children}</div>;
}

export function SetupRadioChoice({
  badge,
  checked,
  description,
  disabled = false,
  id,
  label,
  name,
  onChange,
  value,
}: {
  badge?: string;
  checked: boolean;
  description: ReactNode;
  disabled?: boolean;
  id: string;
  label: string;
  name: string;
  onChange: () => void;
  value: string;
}) {
  return (
    <label
      htmlFor={id}
      aria-label={label}
      className={classNames(
        "flex min-h-16 gap-3 border-b border-white/10 px-4 py-3 transition-colors last:border-b-0",
        checked ? "bg-white/[0.045] shadow-[inset_2px_0_0_var(--rateloop-warm-white)]" : "hover:bg-white/[0.025]",
        disabled && "cursor-not-allowed opacity-45",
      )}
    >
      <input
        id={id}
        className="radio mt-1 shrink-0"
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="min-w-0 grow">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{label}</span>
          {badge ? (
            <span className="inline-flex rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium leading-4 text-base-content/65">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-sm leading-6 text-base-content/60">{description}</span>
      </span>
    </label>
  );
}
