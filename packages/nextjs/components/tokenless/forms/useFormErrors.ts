"use client";

import { useCallback, useEffect, useState } from "react";

export type FormErrorBody = {
  field?: unknown;
  message?: unknown;
};

function describedByText(control: Element) {
  return (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? "");
}

// A server field key names a request field, not a DOM node. Consumers that spell the key out as an
// `id` or `name` are matched directly; the shared field primitives generate their ids with
// `useId()`, so for those the only reliable link back to the offending control is the error text
// the primitive renders and points at with `aria-describedby`. Without this fallback the focus and
// scroll silently do nothing, which on a long form reads as "the Save button did nothing".
function locateInvalidControl(fieldErrors: Record<string, string>) {
  for (const field of Object.keys(fieldErrors)) {
    const byId = document.getElementById(field);
    if (byId) return byId;
    const byName = [...document.querySelectorAll<HTMLElement>("[name]")].find(
      element => element.getAttribute("name") === field,
    );
    if (byName) return byName;
  }
  const messages = new Set(Object.values(fieldErrors));
  return [...document.querySelectorAll<HTMLElement>('[aria-invalid="true"]')].find(control =>
    describedByText(control).some(text => messages.has(text)),
  );
}

export function useFormErrors() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return;
    const timer = window.setTimeout(() => {
      const control = locateInvalidControl(fieldErrors);
      if (!control) return;
      control.focus({ preventScroll: true });
      control.scrollIntoView?.({ behavior: "smooth", block: "center" });
    });
    return () => window.clearTimeout(timer);
  }, [fieldErrors]);

  const clear = useCallback((field?: string) => {
    if (!field) {
      setFieldErrors({});
      setFormError(null);
      return;
    }
    setFieldErrors(current => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  const capture = useCallback((value: unknown, fallback: string) => {
    const details = value && typeof value === "object" ? (value as FormErrorBody) : null;
    const message =
      typeof value === "string"
        ? value
        : value instanceof Error
          ? value.message
          : typeof details?.message === "string"
            ? details.message
            : fallback;
    const field =
      value && typeof value === "object" && "field" in value && typeof details?.field === "string"
        ? details.field
        : null;
    if (field) {
      setFieldErrors(current => ({ ...current, [field]: message }));
      setFormError(null);
    } else {
      setFormError(message);
    }
    return message;
  }, []);

  return { capture, clear, fieldErrors, formError };
}
