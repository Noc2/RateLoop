import { type ReactNode } from "react";
import { Card } from "./Card";
import { classNames } from "./classNames";

export function AsyncSection({
  children,
  className,
  empty,
  emptyDescription,
  emptyTitle,
  error,
  loading,
  loadingLabel = "Loading…",
}: {
  children: ReactNode;
  className?: string;
  empty?: boolean;
  emptyDescription?: string;
  emptyTitle?: string;
  error?: string | null;
  loading: boolean;
  loadingLabel?: string;
}) {
  if (loading) {
    return (
      <Card className={classNames("space-y-3 rounded-2xl p-5", className)} role="status" aria-live="polite">
        <span className="sr-only">{loadingLabel}</span>
        <div aria-hidden="true" className="space-y-3">
          <div className="h-4 w-2/5 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
          <div className="h-3 w-full animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <div
        className={classNames("rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error", className)}
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (empty) {
    return (
      <Card className={classNames("rounded-2xl p-6", className)}>
        {emptyTitle ? <p className="font-semibold">{emptyTitle}</p> : null}
        {emptyDescription ? <p className="mt-1 text-sm text-base-content/55">{emptyDescription}</p> : null}
      </Card>
    );
  }

  return <>{children}</>;
}
