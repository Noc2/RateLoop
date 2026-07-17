"use client";

import { FormEvent, useState } from "react";
import type { AgentEnvironment, AgentVersionInput, AgentVersionSnapshot } from "~~/lib/tokenless/agentRegistry";

type AgentVersionFormProps = {
  current?: AgentVersionSnapshot;
  externalIdRequired?: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (input: AgentVersionInput & { externalId?: string }) => Promise<void>;
};

type HostedAgentEnvironment = Extract<AgentEnvironment, "staging" | "production">;

export function AgentVersionForm({
  current,
  externalIdRequired = false,
  busy,
  submitLabel,
  onSubmit,
}: AgentVersionFormProps) {
  const [externalId, setExternalId] = useState("");
  const [displayName, setDisplayName] = useState(current?.displayName ?? "");
  const [description, setDescription] = useState(current?.description ?? "");
  const [environment, setEnvironment] = useState<HostedAgentEnvironment>(
    current?.environment === "staging" ? "staging" : "production",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      ...(externalIdRequired ? { externalId } : {}),
      displayName,
      description: description || null,
      provider: "unknown",
      model: "unknown",
      modelVersion: null,
      environment,
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        {externalIdRequired ? (
          <label className="text-sm text-base-content/65">
            Stable external ID
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-sm"
              value={externalId}
              onChange={event => setExternalId(event.target.value)}
              placeholder="support-agent-prod"
              pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,159}"
              maxLength={160}
              required
            />
          </label>
        ) : null}
        <label className="text-sm text-base-content/65">
          Workflow name
          <input
            className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
            value={displayName}
            onChange={event => setDisplayName(event.target.value)}
            placeholder="Support quality agent"
            maxLength={120}
            required
          />
        </label>
        <label className="text-sm text-base-content/65">
          Environment
          <select
            className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
            value={environment}
            onChange={event => setEnvironment(event.target.value as HostedAgentEnvironment)}
          >
            <option value="production">Production</option>
            <option value="staging">Staging</option>
          </select>
        </label>
      </div>
      <label className="block text-sm text-base-content/65">
        Description
        <textarea
          className="textarea mt-2 min-h-24 w-full border-white/10 bg-[var(--rateloop-field)]"
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder="What this workflow does and where human assurance is applied."
          maxLength={1_000}
        />
      </label>
      <p className="text-xs leading-5 text-base-content/50">
        Saving creates an immutable workflow version. Execution model details are reported separately for each run.
      </p>
      <button className="rateloop-gradient-action px-5" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
