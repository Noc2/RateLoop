import React, {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from "react";
import { classNames } from "~~/components/tokenless/ui/classNames";
import { type FieldFormatName, fieldFormat } from "~~/lib/validation/fieldFormats";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "pattern" | "title"> & {
  error?: string | null;
  format?: FieldFormatName;
  hint?: ReactNode;
  label: ReactNode;
};

export function Field({ className, error, format, hint, id, label, maxLength, ...input }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const constraint = format ? fieldFormat(format) : null;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <label className="block" htmlFor={inputId}>
      <span className="mb-2 block text-sm font-medium text-base-content/80">{label}</span>
      <input
        {...input}
        id={inputId}
        className={classNames("input input-bordered w-full", error && "input-error", className)}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        pattern={constraint?.pattern}
        maxLength={constraint?.maxLength ?? maxLength}
        title={constraint?.title}
      />
      {error ? (
        <span id={errorId} className="mt-2 block text-sm text-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className="mt-2 block text-sm text-base-content/60">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

type TextareaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  error?: string | null;
  hint?: ReactNode;
  label: ReactNode;
};

export function TextareaField({ className, error, hint, id, label, ...textarea }: TextareaFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <label className="block" htmlFor={inputId}>
      <span className="mb-2 block text-sm font-medium text-base-content/80">{label}</span>
      <textarea
        {...textarea}
        id={inputId}
        className={classNames("textarea textarea-bordered w-full", error && "textarea-error", className)}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <span id={errorId} className="mt-2 block text-sm text-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className="mt-2 block text-sm text-base-content/60">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  children: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  label: ReactNode;
};

export function SelectField({ children, className, error, hint, id, label, ...select }: SelectFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <label className="block" htmlFor={inputId}>
      <span className="mb-2 block text-sm font-medium text-base-content/80">{label}</span>
      <select
        {...select}
        id={inputId}
        className={classNames("select select-bordered w-full", error && "select-error", className)}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
      >
        {children}
      </select>
      {error ? (
        <span id={errorId} className="mt-2 block text-sm text-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className="mt-2 block text-sm text-base-content/60">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
