"use client";

import { useAgentTranslations } from "./AgentsLocaleProvider";

export function AgentConnectionTroubleshooting() {
  const t = useAgentTranslations("troubleshooting");
  return (
    <details className="group mt-4 border-l border-base-content/20 py-1 pl-4 text-sm open:border-base-content/45">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-2 font-medium [&::-webkit-details-marker]:hidden">
        <span>{t("summary")}</span>
        <span aria-hidden="true" className="text-lg text-base-content/55 transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <p className="pb-3 pr-4 leading-6 text-base-content/60">{t("body")}</p>
    </details>
  );
}
