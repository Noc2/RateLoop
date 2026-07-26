"use client";

import { FormEvent, useState } from "react";
import { Field, SelectField, TextareaField } from "~~/components/tokenless/forms/Field";
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
          <Field
            label="Stable external ID"
            className="border-white/10 bg-[var(--rateloop-field)] font-mono text-sm"
            value={externalId}
            onChange={event => setExternalId(event.target.value)}
            placeholder="support-agent-prod"
            format="agentVersion"
            required
          />
        ) : null}
        <Field
          className="border-white/10 bg-[var(--rateloop-field)]"
          label="Workflow name"
          labelClassName="text-sm text-base-content/65"
          value={displayName}
          onChange={event => setDisplayName(event.target.value)}
          placeholder="Support quality agent"
          maxLength={120}
          required
        />
        <SelectField
          className="border-white/10 bg-[var(--rateloop-field)]"
          label="Environment"
          labelClassName="text-sm text-base-content/65"
          value={environment}
          onChange={event => setEnvironment(event.target.value as HostedAgentEnvironment)}
        >
          <option value="production">Production</option>
          <option value="staging">Staging</option>
        </SelectField>
      </div>
      <TextareaField
        className="min-h-24 border-white/10 bg-[var(--rateloop-field)]"
        label="Description"
        labelClassName="text-sm text-base-content/65"
        value={description}
        onChange={event => setDescription(event.target.value)}
        placeholder="What this workflow does and where human assurance is applied."
        maxLength={1_000}
      />
      <button className="rateloop-gradient-action px-5" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
