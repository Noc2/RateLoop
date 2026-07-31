"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

export type ReviewPrivacyContext = "public_paid" | "private_unpaid";

export function reviewRatingPrivacyMessage(context: ReviewPrivacyContext) {
  return context === "public_paid"
    ? "Submitting publishes a sealed rating. It becomes publicly decryptable after the commit deadline."
    : "This private, unpaid rating stays off-chain and is recorded when you submit.";
}

export function reviewForecastPrivacyMessage(context: ReviewPrivacyContext) {
  return context === "public_paid"
    ? "Your forecast is sealed on submission and becomes publicly decryptable after the commit deadline."
    : "Your forecast stays off-chain and is recorded with this private, unpaid review when you submit.";
}

export function isCrowdForecastPercent(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 99;
}

export function CrowdForecastField({
  accessibleLabel = "Crowd forecast",
  disabled = false,
  positiveLabel,
  privacyContext,
  value,
  onChange,
}: {
  accessibleLabel?: string;
  disabled?: boolean;
  positiveLabel: string;
  privacyContext: ReviewPrivacyContext;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const t = useTranslations("review.forecast");
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const valid = isCrowdForecastPercent(value);
  return (
    <fieldset className="mt-5 border-t border-base-content/10 pt-4">
      <legend className="text-xs font-semibold">{t("title")}</legend>
      <label htmlFor={inputId} className="mt-2 block text-xs leading-5 text-base-content/60">
        {t("question", { label: positiveLabel })}
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
          className="input input-sm w-24 border-base-content/10 bg-[var(--rateloop-field)] text-right tabular-nums"
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
          aria-label={t("slider")}
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
        className={`mt-2 text-[11px] leading-4 ${value !== null && !valid ? "text-error" : "text-base-content/55"}`}
      >
        {value !== null && !valid
          ? t("invalid")
          : valid
            ? t("selectedHelp", {
                privacy: privacyContext === "public_paid" ? t("publicPrivacy") : t("privatePrivacy"),
              })
            : t("emptyHelp", {
                privacy: privacyContext === "public_paid" ? t("publicPrivacy") : t("privatePrivacy"),
              })}
      </p>
    </fieldset>
  );
}
