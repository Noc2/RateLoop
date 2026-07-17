import { type ChangeEventHandler, type ReactNode } from "react";
import { classNames } from "./classNames";

export function Chip({
  checked,
  children,
  className,
  disabled,
  name,
  onChange,
  value,
}: {
  checked: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  name?: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  value?: string;
}) {
  return (
    <label
      className={classNames(
        "rounded-full border px-3 py-2 text-xs transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--rateloop-blue)]",
        checked
          ? "border-[var(--rateloop-pink)] bg-pink-300/10 text-pink-100"
          : "border-white/10 text-base-content/55 hover:border-white/25",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        name={name}
        value={value}
        onChange={onChange}
      />
      {children}
    </label>
  );
}
