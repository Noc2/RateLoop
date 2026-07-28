"use client";

import { type FormEvent, useState } from "react";
import { AgentSetupProgress } from "./AgentSetupProgress";
import { SetupActionBar } from "./SetupActionBar";
import { SetupStageHeader } from "./SetupStageHeader";
import { Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { readJson } from "~~/lib/tokenless/http";

const INITIAL_STAGES = [
  { key: "workspace" as const, status: "current" as const },
  { key: "connect" as const, status: "not_started" as const },
  { key: "agent" as const, status: "not_started" as const },
  { key: "reviews" as const, status: "not_started" as const },
  { key: "people" as const, status: "not_started" as const },
];

export function WorkspaceSetupStart() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    clear();
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
      window.location.assign(`/agents/connections?workspace=${encodeURIComponent(body.workspaceId)}&step=connect`);
    } catch (cause) {
      capture(cause, "Unable to create the workspace.");
      setBusy(false);
    }
  }

  return (
    <Card as="section" className="rounded-2xl p-5 sm:p-7">
      <AgentSetupProgress
        currentStep="workspace"
        stages={INITIAL_STAGES}
        onNavigate={() => undefined}
        allowNavigation={false}
      />
      <form className="mt-8 w-full" onSubmit={createWorkspace} aria-busy={busy}>
        <SetupStageHeader title="Name your workspace" />
        <div className="mt-8">
          <Field
            id="setup-workspace-name"
            label="Workspace name"
            className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
            value={name}
            onChange={event => {
              setName(event.target.value);
              clear("name");
            }}
            maxLength={120}
            autoComplete="organization"
            required
            error={fieldErrors.name}
          />
        </div>
        <SetupActionBar>
          <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create workspace"}
          </Button>
        </SetupActionBar>
        {formError ? (
          <p
            id="workspace-setup-error"
            role="alert"
            className="mt-4 rounded-lg border border-error/20 bg-error/10 px-4 py-3 text-sm text-error"
          >
            {formError}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
