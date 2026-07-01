"use client";

import { useEffect, useId, useRef } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { PrivateContextRemovalField } from "~~/lib/submission/privateContextRemovalImpact";

type PrivateContextRemovalDialogProps = {
  fields: readonly PrivateContextRemovalField[];
  onCancel: () => void;
  onConfirm: () => void;
};

type PrivateContextRemovalNoticeProps = {
  fields: readonly PrivateContextRemovalField[];
  onRestore?: () => void;
};

export function PrivateContextRemovalDialog({ fields, onCancel, onConfirm }: PrivateContextRemovalDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-lg rounded-2xl border border-warning/30 bg-base-100 p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <ExclamationTriangleIcon className="mt-1 h-6 w-6 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-base-content">
              Switching to private context removes public context
            </h2>
            <p id={descriptionId} className="mt-2 text-sm text-base-content/70">
              Private asks use hosted details and private image context only. These public fields will not be included
              if you switch modes:
            </p>
          </div>
        </div>

        <ul className="mt-4 space-y-2 rounded-xl border border-base-300 bg-base-200/60 p-3 text-sm">
          {fields.map(field => (
            <li key={field.kind} className="flex min-w-0 gap-2">
              <span className="shrink-0 font-semibold text-base-content">{field.label}:</span>
              <span className="truncate text-base-content/70">{field.value}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancelButtonRef} type="button" className="btn btn-ghost" onClick={onCancel}>
            Keep public context
          </button>
          <button type="button" className="btn btn-warning" onClick={onConfirm}>
            Switch to private and remove
          </button>
        </div>
      </div>
    </div>
  );
}

export function PrivateContextRemovalNotice({ fields, onRestore }: PrivateContextRemovalNoticeProps) {
  if (fields.length === 0) return null;

  return (
    <div className="rounded-xl border border-warning/25 bg-warning/10 p-3 text-sm text-base-content">
      <div className="flex items-start gap-2">
        <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Public context was removed for private mode.</p>
          <p className="mt-1 text-base-content/70">
            Private asks exclude public links and videos. Restore switches back to public mode and puts the removed
            fields back in the draft.
          </p>
          <ul className="mt-2 space-y-1">
            {fields.map(field => (
              <li key={field.kind} className="flex min-w-0 gap-2">
                <span className="shrink-0 font-medium">{field.label}:</span>
                <span className="truncate text-base-content/65">{field.value}</span>
              </li>
            ))}
          </ul>
        </div>
        {onRestore ? (
          <button type="button" className="btn btn-outline btn-sm shrink-0" onClick={onRestore}>
            Restore
          </button>
        ) : null}
      </div>
    </div>
  );
}
