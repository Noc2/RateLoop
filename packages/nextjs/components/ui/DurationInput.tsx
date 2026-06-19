"use client";

import { useEffect, useMemo, useState } from "react";
import {
  HUMAN_DURATION_UNIT_OPTIONS,
  type HumanDurationUnit,
  durationAmountToMinutes,
  formatHumanDurationFromMinutes,
  getBestDurationInputPartsFromMinutes,
  getHumanDurationUnitMinutes,
  normalizeDurationAmountInput,
  parseDurationAmountInput,
} from "~~/lib/humanDuration";

type DurationInputProps = {
  id: string;
  valueMinutes: string;
  minMinutes: number;
  maxMinutes: number;
  onChangeMinutes: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
  className?: string;
  inputClassName?: string;
  selectClassName?: string;
  summaryClassName?: string;
  summarySuffix?: string;
};

function getVisibleDurationParts(valueMinutes: string, preferredUnit: HumanDurationUnit) {
  if (valueMinutes === "") {
    return { amount: "", unit: preferredUnit };
  }

  const parsedMinutes = parseDurationAmountInput(valueMinutes);
  if (parsedMinutes <= 0) {
    return { amount: valueMinutes, unit: preferredUnit };
  }

  const unitMinutes = getHumanDurationUnitMinutes(preferredUnit);
  if (parsedMinutes % unitMinutes === 0) {
    return { amount: String(parsedMinutes / unitMinutes), unit: preferredUnit };
  }

  return getBestDurationInputPartsFromMinutes(parsedMinutes);
}

export function DurationInput({
  id,
  valueMinutes,
  minMinutes,
  maxMinutes,
  onChangeMinutes,
  onBlur,
  disabled = false,
  invalid = false,
  ariaLabel,
  className = "",
  inputClassName = "",
  selectClassName = "",
  summaryClassName = "",
  summarySuffix,
}: DurationInputProps) {
  const [unit, setUnit] = useState<HumanDurationUnit>(() => getBestDurationInputPartsFromMinutes(valueMinutes).unit);
  const visibleParts = useMemo(() => getVisibleDurationParts(valueMinutes, unit), [unit, valueMinutes]);

  useEffect(() => {
    if (visibleParts.unit !== unit) {
      setUnit(visibleParts.unit);
    }
  }, [unit, visibleParts.unit]);

  const summary = [
    formatHumanDurationFromMinutes(valueMinutes),
    `Allowed: ${formatHumanDurationFromMinutes(minMinutes)}-${formatHumanDurationFromMinutes(maxMinutes)}`,
    summarySuffix,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={className}>
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          disabled={disabled}
          value={visibleParts.amount}
          aria-label={ariaLabel}
          onChange={event => {
            const normalizedValue = normalizeDurationAmountInput(event.target.value);
            if (normalizedValue === null) {
              return;
            }

            if (normalizedValue === "") {
              onChangeMinutes("");
              return;
            }

            onChangeMinutes(String(durationAmountToMinutes(normalizedValue, visibleParts.unit)));
          }}
          onBlur={onBlur}
          className={`input input-bordered w-full bg-base-100 ${invalid ? "input-error" : ""} ${inputClassName}`}
        />
        <select
          value={visibleParts.unit}
          disabled={disabled}
          aria-label={`${ariaLabel ?? "Duration"} unit`}
          onChange={event => {
            const nextUnit = event.target.value as HumanDurationUnit;
            setUnit(nextUnit);

            if (visibleParts.amount === "") {
              return;
            }

            onChangeMinutes(String(durationAmountToMinutes(visibleParts.amount, nextUnit)));
          }}
          onBlur={onBlur}
          className={`select select-bordered w-full bg-base-100 ${invalid ? "select-error" : ""} ${selectClassName}`}
        >
          {HUMAN_DURATION_UNIT_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <p className={`mt-1 text-xs font-semibold text-base-content/55 ${summaryClassName}`}>{summary}</p>
    </div>
  );
}
