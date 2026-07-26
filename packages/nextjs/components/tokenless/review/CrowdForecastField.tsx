"use client";

import { useId } from "react";

export function isCrowdForecastPercent(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 99;
}

export function CrowdForecastField({
  accessibleLabel = "Crowd forecast",
  disabled = false,
  positiveLabel,
  value,
  onChange,
}: {
  accessibleLabel?: string;
  disabled?: boolean;
  positiveLabel: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const valid = isCrowdForecastPercent(value);
  return (
    <fieldset className="mt-5 border-t border-white/10 pt-4">
      <legend className="text-xs font-semibold">Crowd forecast</legend>
      <label htmlFor={inputId} className="mt-2 block text-xs leading-5 text-base-content/60">
        What percentage of reviewers do you expect to choose “{positiveLabel}”?
      </label>
      <div className="mt-3 flex items-center gap-2">
        <input
          id={inputId}
          aria-label={accessibleLabel}
          aria-describedby={helpId}
          type="number"
          inputMode="numeric"
          min={1}
          max={99}
          step={1}
          required
          disabled={disabled}
          className="input input-sm w-24 border-white/10 bg-[var(--rateloop-field)] text-right tabular-nums"
          value={value ?? ""}
          onChange={event => {
            const next = event.currentTarget.value;
            onChange(next === "" ? null : Number(next));
          }}
        />
        <span aria-hidden="true" className="text-sm text-base-content/60">
          %
        </span>
      </div>
      {valid ? (
        <input
          type="range"
          aria-label="Crowd forecast slider"
          aria-describedby={helpId}
          min={1}
          max={99}
          step={1}
          value={value}
          disabled={disabled}
          className="range range-xs mt-3 w-full"
          onChange={event => onChange(Number(event.currentTarget.value))}
        />
      ) : null}
      <p
        id={helpId}
        role={value !== null && !valid ? "alert" : undefined}
        className={`mt-2 text-[11px] leading-4 ${value !== null && !valid ? "text-red-100" : "text-base-content/55"}`}
      >
        {value !== null && !valid
          ? "Enter a whole number from 1 to 99."
          : valid
            ? "Fine-tune with the slider. Your forecast stays hidden until settlement."
            : "Enter a whole number from 1 to 99. No forecast is preselected; your forecast stays hidden until settlement."}
      </p>
    </fieldset>
  );
}
