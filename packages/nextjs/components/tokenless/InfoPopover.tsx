"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={popoverId}
        className="flex size-9 items-center justify-center rounded-full border border-white/15 text-sm font-semibold text-base-content/65 transition hover:border-white/30 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rateloop-blue)]"
        onClick={() => setOpen(current => !current)}
      >
        i
      </button>
      {open ? (
        <span
          id={popoverId}
          role="tooltip"
          className="absolute bottom-11 left-0 z-20 w-72 rounded-xl border border-white/10 bg-[var(--rateloop-field)] p-4 text-sm leading-6 text-base-content/75 shadow-2xl sm:left-auto sm:right-0"
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
