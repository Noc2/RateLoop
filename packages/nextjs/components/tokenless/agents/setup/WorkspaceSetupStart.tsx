"use client";

import { type FormEvent, useState } from "react";
import { AgentSetupProgress } from "./AgentSetupProgress";
import { SetupActionBar } from "./SetupActionBar";
import { SetupStageHeader } from "./SetupStageHeader";
import { Button } from "~~/components/tokenless/ui/Button";

const INITIAL_STAGES = [
  { key: "workspace" as const, status: "current" as const },
  { key: "connect" as const, status: "not_started" as const },
  { key: "agent" as const, status: "not_started" as const },
  { key: "reviews" as const, status: "not_started" as const },
  { key: "people" as const, status: "not_started" as const },
];

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Unable to create the workspace.");
  return body;
}

export function WorkspaceSetupStart() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = await readJson(
        await fetch("/api/account/workspaces", {
          method: "POST",
          body: JSON.stringify({ name }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
      if (typeof body.workspaceId !== "string") throw new Error("RateLoop did not return the new workspace.");
      window.location.assign(`/agents?workspace=${encodeURIComponent(body.workspaceId)}&step=connect`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the workspace.");
      setBusy(false);
    }
  }

  return (
    <section className="surface-card rounded-2xl p-5 sm:p-7">
      <AgentSetupProgress
        currentStep="workspace"
        stages={INITIAL_STAGES}
        onNavigate={() => undefined}
        allowNavigation={false}
      />
      <form className="mt-8 w-full" onSubmit={createWorkspace} aria-busy={busy}>
        <SetupStageHeader
          step="workspace"
          title="Name your workspace"
          description="Use a team or project name. You can change it later."
        />
        <label className="mt-8 block text-sm font-medium" htmlFor="setup-workspace-name">
          Workspace name
        </label>
        <input
          id="setup-workspace-name"
          className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
          value={name}
          onChange={event => setName(event.target.value)}
          maxLength={120}
          autoComplete="organization"
          required
          aria-describedby={error ? "workspace-setup-error" : undefined}
        />
        <SetupActionBar>
          <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create workspace"}
          </Button>
        </SetupActionBar>
        {error ? (
          <p
            id="workspace-setup-error"
            role="alert"
            className="mt-4 rounded-lg border border-error/20 bg-error/10 px-4 py-3 text-sm text-error"
          >
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
