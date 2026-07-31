"use client";

import { useId, useRef, useState } from "react";
import { useAgentTranslations } from "./AgentsLocaleProvider";
import { Field } from "~~/components/tokenless/forms/Field";

export function OneTimeSecretNotice({
  label,
  value,
  onDismiss,
}: {
  label: string;
  value: string;
  onDismiss: () => void;
}) {
  const t = useAgentTranslations("secret");
  const headingId = useId();
  const guidanceId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(t("copied"));
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopyStatus(t("copyFailed"));
    }
  };

  return (
    <section
      className="mt-4 rounded-xl border border-warning/25 bg-warning/[0.06] p-4"
      aria-labelledby={headingId}
      role="alert"
    >
      <h3 id={headingId} className="text-sm font-semibold text-warning">
        {t("title", { label })}
      </h3>
      <p id={guidanceId} className="mt-2 text-xs leading-5 text-warning/75">
        {t("guidance")}
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Field
          ref={inputRef}
          containerClassName="min-w-0 flex-1"
          className="border-warning/20 bg-base-content/[0.055] font-mono text-xs"
          label={label}
          labelClassName="sr-only"
          aria-describedby={guidanceId}
          value={value}
          readOnly
          autoComplete="off"
          spellCheck={false}
          onFocus={event => event.currentTarget.select()}
        />
        <button type="button" className="btn btn-sm border-warning/20 bg-warning/10" onClick={() => void copy()}>
          {t("copy")}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-xs border-base-content/10 bg-base-content/[0.06]" onClick={onDismiss}>
          {t("dismiss")}
        </button>
        {copyStatus ? (
          <p className="text-xs text-base-content/65" role="status" aria-live="polite">
            {copyStatus}
          </p>
        ) : null}
      </div>
    </section>
  );
}
