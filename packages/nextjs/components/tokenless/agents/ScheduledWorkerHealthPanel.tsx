"use client";

import { useEffect, useState } from "react";
import { useAgentFormatter, useAgentTranslations } from "./AgentsLocaleProvider";
import { Card } from "~~/components/tokenless/ui/Card";

type Health = {
  state: "degraded" | "healthy" | "stale" | "unavailable";
  currentRun: "idle" | "running";
  lastCompletedAt: string | null;
  signals: Array<{ key: string; label: string }>;
};

type PanelState = { status: "loading" } | { status: "ready"; health: Health } | { status: "error" };

const TONES: Record<Health["state"], string> = {
  healthy: "text-success",
  degraded: "text-warning",
  stale: "text-error",
  unavailable: "text-warning",
};

const CONTENT_KEYS: Record<Health["state"], { label: string; description: string }> = {
  healthy: {
    label: "healthy",
    description: "healthyDescription",
  },
  degraded: {
    label: "degraded",
    description: "degradedDescription",
  },
  stale: {
    label: "stale",
    description: "staleDescription",
  },
  unavailable: {
    label: "unavailable",
    description: "unavailableDescription",
  },
};

export function ScheduledWorkerHealthPanel({ workspaceId }: { workspaceId: string }) {
  const format = useAgentFormatter();
  const t = useAgentTranslations("maintenance");
  const [panelState, setPanelState] = useState<PanelState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setPanelState({ status: "loading" });
    void fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/operations/health`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) throw new Error("Scheduled maintenance health request failed.");
        return (await response.json()) as Health;
      })
      .then(health => {
        if (!controller.signal.aborted) setPanelState({ status: "ready", health });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPanelState({ status: "error" });
      });
    return () => controller.abort();
  }, [workspaceId]);

  if (panelState.status === "loading") return null;
  if (panelState.status === "error") {
    return (
      <Card as="section" aria-live="polite" className="p-5">
        <h2 className="text-base font-semibold text-warning">{t("statusUnavailable")}</h2>
        <p className="mt-1 text-sm text-base-content/65">{t("loadError")}</p>
      </Card>
    );
  }
  const { health } = panelState;
  const content = CONTENT_KEYS[health.state];
  const lastCompleted = health.lastCompletedAt
    ? t("lastCompleted", {
        date: format.dateTime(new Date(health.lastCompletedAt), { dateStyle: "medium", timeStyle: "short" }),
      })
    : t("noCompleted");
  return (
    <Card as="section" aria-live="polite" className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={`text-base font-semibold ${TONES[health.state]}`}>{t(content.label)}</h2>
          <p className="mt-1 text-sm text-base-content/65">{t(content.description)}</p>
        </div>
        <p className="text-xs text-base-content/60">
          {health.currentRun === "running" ? `${t("running")} · ` : ""}
          {lastCompleted}
        </p>
      </div>
      {health.signals.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("issues")}>
          {health.signals.map(signal => (
            <li
              key={signal.key}
              className="rounded-full border border-base-content/10 bg-base-content/[0.04] px-3 py-1 text-xs"
            >
              {t("issueReference", { key: signal.key })}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
