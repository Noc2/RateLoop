"use client";

import { useEffect, useMemo, useState } from "react";
import {
  HUMAN_DURATION_UNIT_OPTIONS,
  type HumanDurationUnit,
  durationAmountToSeconds,
  formatHumanDurationFromSeconds,
  getBestDurationInputPartsFromSeconds,
  getHumanDurationUnitSeconds,
  normalizeDurationAmountInput,
  parseDurationAmountInput,
} from "~~/lib/humanDuration";

type DurationInputProps = {
  id: string;
  valueSeconds: string;
  minSeconds: number;
  maxSeconds: number;
  onChangeSeconds: (value: string) => void;
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

function getVisibleDurationParts(valueSeconds: string, preferredUnit: HumanDurationUnit) {
  if (valueSeconds === "") {
    return { amount: "", unit: preferredUnit };
  }

  const parsedSeconds = parseDurationAmountInput(valueSeconds);
  if (parsedSeconds <= 0) {
    return { amount: valueSeconds, unit: preferredUnit };
  }

  const unitSeconds = getHumanDurationUnitSeconds(preferredUnit);
  if (parsedSeconds % unitSeconds === 0) {
    return { amount: String(parsedSeconds / unitSeconds), unit: preferredUnit };
  }

  return getBestDurationInputPartsFromSeconds(parsedSeconds);
}

export function DurationInput({
  id,
  valueSeconds,
  minSeconds,
  maxSeconds,
  onChangeSeconds,
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
  const [unit, setUnit] = useState<HumanDurationUnit>(() => getBestDurationInputPartsFromSeconds(valueSeconds).unit);
  const visibleParts = useMemo(() => getVisibleDurationParts(valueSeconds, unit), [unit, valueSeconds]);

  useEffect(() => {
    if (visibleParts.unit !== unit) {
      setUnit(visibleParts.unit);
    }
  }, [unit, visibleParts.unit]);

  const summary = [
    formatHumanDurationFromSeconds(valueSeconds),
    `Allowed: ${formatHumanDurationFromSeconds(minSeconds)}-${formatHumanDurationFromSeconds(maxSeconds)}`,
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
              onChangeSeconds("");
              return;
            }

            onChangeSeconds(String(durationAmountToSeconds(normalizedValue, visibleParts.unit)));
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

            onChangeSeconds(String(durationAmountToSeconds(visibleParts.amount, nextUnit)));
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
