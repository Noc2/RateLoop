"use client";

import { useEffect, useState } from "react";

export function PublicAgentConnectionStatus() {
  const [fragmentState, setFragmentState] = useState<"checking" | "present" | "missing">("checking");

  useEffect(() => {
    // Deliberately inspect only whether a claim exists. The fragment itself is
    // never copied into React state, sent to an API, or placed in telemetry.
    setFragmentState(new URLSearchParams(window.location.hash.slice(1)).has("claim") ? "present" : "missing");
  }, []);

  if (fragmentState === "checking") {
    return (
      <p className="mt-4 text-sm text-base-content/55" role="status">
        Checking this local handoff…
      </p>
    );
  }

  if (fragmentState === "missing") {
    return (
      <p
        className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm text-amber-100"
        role="status"
        aria-live="polite"
      >
        Open the original connection link. If it is unavailable, create a new connection in RateLoop.
      </p>
    );
  }

  return (
    <p
      className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4 text-sm text-emerald-100"
      role="status"
      aria-live="polite"
    >
      Connection link found. Return to your agent to continue.
    </p>
  );
}
