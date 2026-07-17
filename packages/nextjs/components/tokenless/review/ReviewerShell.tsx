"use client";

import { type ReactNode, type RefObject, useEffect } from "react";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function ReviewerShell({
  advanceDisabled,
  advanceLabel,
  busyLabel,
  caseIndex,
  children,
  laneHeader,
  onAdvance,
  onSelectFirst,
  onSelectSecond,
  rationaleRef,
  totalCases,
}: {
  advanceDisabled: boolean;
  advanceLabel: string;
  busyLabel?: string | null;
  caseIndex: number;
  children: ReactNode;
  laneHeader: ReactNode;
  onAdvance: () => void;
  onSelectFirst: () => void;
  onSelectSecond: () => void;
  rationaleRef?: RefObject<HTMLTextAreaElement | null>;
  totalCases: number;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key === "1") onSelectFirst();
      else if (event.key === "2") onSelectSecond();
      else if (event.key.toLowerCase() === "r" && rationaleRef?.current) rationaleRef.current.focus();
      else if (event.key === "Enter" && !advanceDisabled) onAdvance();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [advanceDisabled, onAdvance, onSelectFirst, onSelectSecond, rationaleRef]);

  return (
    <section className="space-y-4" aria-label="Reviewer workspace">
      <Card className="rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>{laneHeader}</div>
          <p className="font-mono text-xs uppercase tracking-widest text-base-content/55">
            Case {caseIndex + 1} of {totalCases}
          </p>
        </div>
        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label="Review progress"
          aria-valuemin={1}
          aria-valuemax={totalCases}
          aria-valuenow={caseIndex + 1}
        >
          <div
            className="h-full rounded-full bg-[var(--rateloop-green)] transition-[width] motion-reduce:transition-none"
            style={{ width: `${((caseIndex + 1) / totalCases) * 100}%` }}
          />
        </div>
      </Card>

      {children}

      <Card className="rounded-2xl p-4 sm:p-5">
        <Button type="button" className="w-full px-6" disabled={advanceDisabled} onClick={onAdvance}>
          {busyLabel ?? advanceLabel}
        </Button>
        <p className="mt-3 text-center text-xs text-base-content/55">
          Keyboard: 1 or 2 selects · R opens rationale · Enter advances
        </p>
      </Card>
    </section>
  );
}
