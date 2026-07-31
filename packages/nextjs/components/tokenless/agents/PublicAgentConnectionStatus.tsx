"use client";

import { useEffect, useState } from "react";
import { useAgentTranslations } from "./AgentsLocaleProvider";

export function PublicAgentConnectionStatus() {
  const t = useAgentTranslations("publicStatus");
  const [fragmentState, setFragmentState] = useState<"checking" | "present" | "missing">("checking");

  useEffect(() => {
    // Deliberately inspect only whether a claim exists. The fragment itself is
    // never copied into React state, sent to an API, or placed in telemetry.
    setFragmentState(new URLSearchParams(window.location.hash.slice(1)).has("claim") ? "present" : "missing");
  }, []);

  if (fragmentState === "checking") {
    return (
      <p className="mt-4 text-sm text-base-content/55" role="status">
        {t("checking")}
      </p>
    );
  }

  if (fragmentState === "missing") {
    return (
      <p
        className="mt-4 rounded-xl border border-warning/20 bg-warning/[0.06] p-4 text-sm text-warning"
        role="status"
        aria-live="polite"
      >
        {t("missing")}
      </p>
    );
  }

  return (
    <p
      className="mt-4 rounded-xl border border-success/20 bg-success/[0.06] p-4 text-sm text-success"
      role="status"
      aria-live="polite"
    >
      {t("present")}
    </p>
  );
}
