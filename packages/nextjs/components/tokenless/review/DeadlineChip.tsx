"use client";

import { useEffect, useState } from "react";

export function deadlineLabel(deadline: string, now = Date.now()) {
  const deadlineMs = new Date(deadline).getTime();
  if (!Number.isFinite(deadlineMs)) return "Deadline unavailable";
  const remaining = deadlineMs - now;
  if (remaining <= 0) return "Deadline passed";
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.ceil(remaining / 3_600_000);
  if (hours < 48) return `${hours} hr left`;
  return `${Math.ceil(remaining / 86_400_000)} days left`;
}

export function DeadlineChip({ deadline, label }: { deadline: string | null; label: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!deadline) return null;
  return (
    <span
      className="mt-2 inline-flex min-h-6 items-center rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-base-content/65"
      role="timer"
      aria-live="off"
      title={new Date(deadline).toLocaleString()}
      suppressHydrationWarning
    >
      {label}: {deadlineLabel(deadline, now)}
    </span>
  );
}
