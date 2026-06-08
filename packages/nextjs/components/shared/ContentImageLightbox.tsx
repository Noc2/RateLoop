"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MagnifyingGlassPlusIcon, XMarkIcon } from "@heroicons/react/24/outline";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface ContentImageLightboxProps {
  src: string;
  alt: string;
  loading?: "eager" | "lazy";
  triggerLabel?: string;
  modalLabel?: string;
  imageClassName?: string;
  modalImageClassName?: string;
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    element => element.getAttribute("aria-hidden") !== "true",
  );
}

export function ContentImageLightbox({
  src,
  alt,
  loading = "lazy",
  triggerLabel = "Open image",
  modalLabel = "Image preview",
  imageClassName = "",
  modalImageClassName = "",
}: ContentImageLightboxProps) {
  const dialogId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const triggerElement = triggerRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    }, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements(dialogRef.current);
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }

      if (event.shiftKey && (document.activeElement === firstElement || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        lastElement.focus({ preventScroll: true });
        return;
      }

      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);

      const returnFocusTarget = previousFocus && document.contains(previousFocus) ? previousFocus : triggerElement;
      returnFocusTarget?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  const lightboxDialog = isOpen ? (
    <div
      id={dialogId}
      ref={dialogRef}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={modalLabel}
      tabIndex={-1}
      onClick={() => setIsOpen(false)}
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={() => setIsOpen(false)}
        className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-base-200/90 text-base-content shadow-lg transition-colors hover:bg-base-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80"
        aria-label="Close image preview"
      >
        <XMarkIcon className="h-6 w-6" />
      </button>

      <div className="flex h-full w-full items-center justify-center" onClick={event => event.stopPropagation()}>
        <img
          src={src}
          alt={alt}
          className={`max-h-full max-w-full rounded-lg border border-white/10 bg-black object-contain shadow-[0_24px_80px_rgba(0,0,0,0.64)] ${modalImageClassName}`.trim()}
        />
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-controls={isOpen ? dialogId : undefined}
        aria-label={triggerLabel}
        className="group relative block h-full w-full cursor-zoom-in overflow-hidden bg-base-100 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80 focus-visible:ring-offset-2 focus-visible:ring-offset-base-200"
      >
        <img src={src} alt={alt} className={imageClassName} loading={loading} />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/90 opacity-0 shadow-lg backdrop-blur transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <MagnifyingGlassPlusIcon className="h-5 w-5" />
        </span>
      </button>

      {lightboxDialog ? createPortal(lightboxDialog, document.body) : null}
    </>
  );
}
