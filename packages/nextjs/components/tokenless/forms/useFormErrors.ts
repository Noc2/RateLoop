"use client";

import { useCallback, useEffect, useState } from "react";

export type FormErrorBody = {
  field?: unknown;
  message?: unknown;
};

export function useFormErrors() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const field = Object.keys(fieldErrors)[0];
    if (!field) return;
    const timer = window.setTimeout(() => {
      const byId = document.getElementById(field);
      const byName = [...document.querySelectorAll<HTMLElement>("[name]")].find(
        element => element.getAttribute("name") === field,
      );
      const control = byId ?? byName;
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
