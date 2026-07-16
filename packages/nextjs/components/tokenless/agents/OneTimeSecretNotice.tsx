"use client";

import { useId, useRef, useState } from "react";

export function OneTimeSecretNotice({
  label,
  value,
  onDismiss,
}: {
  label: string;
  value: string;
  onDismiss: () => void;
}) {
  const headingId = useId();
  const guidanceId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus("Copied to clipboard.");
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopyStatus("Automatic copy failed. The value is selected so you can copy it manually.");
    }
  };

  return (
    <section
      className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] p-4"
      aria-labelledby={headingId}
      role="alert"
    >
      <h3 id={headingId} className="text-sm font-semibold text-amber-100">
        Copy {label} now
      </h3>
      <p id={guidanceId} className="mt-2 text-xs leading-5 text-amber-50/75">
        This value is shown once. It cannot be recovered after you dismiss it, reload, or leave this page.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          className="input min-w-0 flex-1 border-amber-300/20 bg-black/35 font-mono text-xs"
          aria-label={label}
          aria-describedby={guidanceId}
          value={value}
          readOnly
          autoComplete="off"
          spellCheck={false}
          onFocus={event => event.currentTarget.select()}
        />
        <button type="button" className="btn btn-sm border-amber-300/20 bg-amber-300/10" onClick={() => void copy()}>
          Copy
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-xs border-white/10 bg-white/[0.06]" onClick={onDismiss}>
          I stored it — dismiss
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
