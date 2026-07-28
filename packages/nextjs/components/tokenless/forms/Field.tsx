import React, {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
  useId,
} from "react";
import { classNames } from "~~/components/tokenless/ui/classNames";
import { type FieldFormatName, fieldFormat } from "~~/lib/validation/fieldFormats";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "pattern" | "title"> & {
  containerClassName?: string;
  error?: string | null;
  format?: FieldFormatName;
  hint?: ReactNode;
  label: ReactNode;
  labelClassName?: string;
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { className, containerClassName, error, format, hint, id, label, labelClassName, maxLength, ...input },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const constraint = format ? fieldFormat(format) : null;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <label className={classNames("block", containerClassName)} htmlFor={inputId}>
      <span className={classNames("mb-2 block text-sm font-medium text-base-content/80", labelClassName)}>{label}</span>
      <input
        ref={ref}
        {...input}
        id={inputId}
        className={classNames("input input-bordered w-full", error && "input-error", className)}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        pattern={constraint?.pattern}
        maxLength={constraint?.maxLength ?? maxLength}
        title={constraint?.title}
      />
      {hint ? (
        <span id={hintId} className="mt-2 block text-sm text-base-content/60">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="mt-2 block text-sm text-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
});

type TextareaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  containerClassName?: string;
  error?: string | null;
  hint?: ReactNode;
  label: ReactNode;
  labelClassName?: string;
};

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(function TextareaField(
  { className, containerClassName, error, hint, id, label, labelClassName, ...textarea },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <label className={classNames("block", containerClassName)} htmlFor={inputId}>
      <span className={classNames("mb-2 block text-sm font-medium text-base-content/80", labelClassName)}>{label}</span>
      <textarea
        ref={ref}
        {...textarea}
        id={inputId}
        className={classNames("textarea textarea-bordered w-full", error && "textarea-error", className)}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
      />
      {hint ? (
        <span id={hintId} className="mt-2 block text-sm text-base-content/60">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="mt-2 block text-sm text-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
});

type ChoiceInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type: "checkbox" | "radio";
  error?: string | null;
};

export function ChoiceInput({ className, error, type, ...input }: ChoiceInputProps) {
  return (
    <input
      {...input}
      type={type}
      className={classNames(type === "checkbox" ? "checkbox" : "radio", error && "input-error", className)}
      aria-invalid={error ? true : input["aria-invalid"]}
    />
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  children: ReactNode;
  containerClassName?: string;
  error?: string | null;
  hint?: ReactNode;
  label: ReactNode;
  labelClassName?: string;
};

export function SelectField({
  children,
  className,
  containerClassName,
  error,
  hint,
  id,
  label,
  labelClassName,
  ...select
}: SelectFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <label className={classNames("block", containerClassName)} htmlFor={inputId}>
      <span className={classNames("mb-2 block text-sm font-medium text-base-content/80", labelClassName)}>{label}</span>
      <select
        {...select}
        id={inputId}
        className={classNames("select select-bordered w-full", error && "select-error", className)}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
      >
        {children}
      </select>
      {hint ? (
        <span id={hintId} className="mt-2 block text-sm text-base-content/60">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="mt-2 block text-sm text-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
