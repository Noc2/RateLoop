"use client";

import { FormEvent, useState } from "react";
import { useAgentTranslations } from "./AgentsLocaleProvider";
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
  const t = useAgentTranslations("versionForm");
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
            label={t("externalId")}
            className="border-base-content/10 bg-[var(--rateloop-field)] font-mono text-sm"
            value={externalId}
            onChange={event => setExternalId(event.target.value)}
            placeholder={t("externalIdPlaceholder")}
            format="agentVersion"
            required
          />
        ) : null}
        <Field
          className="border-base-content/10 bg-[var(--rateloop-field)]"
          label={t("workflowName")}
          labelClassName="text-sm text-base-content/65"
          value={displayName}
          onChange={event => setDisplayName(event.target.value)}
          placeholder={t("workflowNamePlaceholder")}
          maxLength={120}
          required
        />
        <SelectField
          className="border-base-content/10 bg-[var(--rateloop-field)]"
          label={t("environment")}
          labelClassName="text-sm text-base-content/65"
          value={environment}
          onChange={event => setEnvironment(event.target.value as HostedAgentEnvironment)}
        >
          <option value="production">{t("production")}</option>
          <option value="staging">{t("staging")}</option>
        </SelectField>
      </div>
      <TextareaField
        className="min-h-24 border-base-content/10 bg-[var(--rateloop-field)]"
        label={t("description")}
        labelClassName="text-sm text-base-content/65"
        value={description}
        onChange={event => setDescription(event.target.value)}
        placeholder={t("descriptionPlaceholder")}
        maxLength={1_000}
      />
      <button className="rateloop-gradient-action px-5" disabled={busy}>
        {busy ? t("saving") : submitLabel}
      </button>
    </form>
  );
}
