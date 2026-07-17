"use client";

import { type CSSProperties, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

const POPOVER_MAX_WIDTH = 18 * 16;
const VIEWPORT_PADDING = 16;
const TRIGGER_GAP = 8;

type PopoverPlacement = {
  left: number;
  top: number;
  width: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();

  function close({ restoreFocus = false }: { restoreFocus?: boolean } = {}) {
    setOpen(false);
    setPlacement(null);
    if (restoreFocus) buttonRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = buttonRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;

      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const availableWidth = Math.max(0, viewportWidth - VIEWPORT_PADDING * 2);
      const width = Math.min(popoverRect.width || POPOVER_MAX_WIDTH, POPOVER_MAX_WIDTH, availableWidth);
      const maximumLeft = Math.max(VIEWPORT_PADDING, viewportWidth - VIEWPORT_PADDING - width);
      const left = clamp(triggerRect.left + triggerRect.width / 2 - width / 2, VIEWPORT_PADDING, maximumLeft);
      const height = popoverRect.height;
      const above = triggerRect.top - height - TRIGGER_GAP;
      const maximumTop = Math.max(VIEWPORT_PADDING, viewportHeight - VIEWPORT_PADDING - height);
      const top =
        above >= VIEWPORT_PADDING ? above : clamp(triggerRect.bottom + TRIGGER_GAP, VIEWPORT_PADDING, maximumTop);

      setPlacement({ left, top, width });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) close();
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      close({ restoreFocus: true });
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const popoverStyle: CSSProperties = {
    left: placement?.left ?? VIEWPORT_PADDING,
    top: placement?.top ?? VIEWPORT_PADDING,
    visibility: placement ? "visible" : "hidden",
    width: placement?.width ?? `min(${POPOVER_MAX_WIDTH}px, calc(100vw - ${VIEWPORT_PADDING * 2}px))`,
  };

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-describedby={open ? popoverId : undefined}
        className="flex size-11 shrink-0 items-center justify-center rounded-full border border-white/15 text-sm font-semibold text-base-content/65 transition hover:border-white/30 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rateloop-blue)]"
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
      >
        i
      </button>
      {open ? (
        <span
          ref={popoverRef}
          id={popoverId}
          role="tooltip"
          className="fixed z-50 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-white/10 bg-[var(--rateloop-field)] p-4 text-sm leading-6 text-base-content/75 shadow-2xl"
          style={popoverStyle}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
