"use client";

import { useCallback, useState } from "react";

export type FormErrorBody = {
  field?: unknown;
  message?: unknown;
};

export function useFormErrors() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

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

  const capture = useCallback((value: FormErrorBody | Error | string | null | undefined, fallback: string) => {
    const message =
      typeof value === "string"
        ? value
        : value instanceof Error
          ? value.message
          : typeof value?.message === "string"
            ? value.message
            : fallback;
    const field =
      value && typeof value === "object" && !(value instanceof Error) && typeof value.field === "string"
        ? value.field
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
