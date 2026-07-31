"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentFormatter, useAgentTranslations } from "./AgentsLocaleProvider";
import { OneTimeSecretNotice } from "./OneTimeSecretNotice";
import { readEvidenceDeliveryJson } from "./evidenceDeliveryClient";
import { Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { Card } from "~~/components/tokenless/ui/Card";

type MetricsCredential = {
  credentialId: string;
  label: string;
  status: "active" | "rotated" | "revoked";
  issuedAt: string;
  lastUsedAt: string | null;
};
type IssuedMetricsCredential = { credential: MetricsCredential; token: string };

export function MetricsEvidenceAccess({ workspaceId }: { workspaceId: string }) {
  const copy = useAgentTranslations("evidencePanels.delivery");
  const ui = useAgentTranslations("ui");
  const errors = useAgentTranslations("errors");
  const format = useAgentFormatter();
  const statusCopy = useAgentTranslations("status");
  const endpoint = `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/metrics/credentials`;
  const [credentials, setCredentials] = useState<MetricsCredential[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  const load = useCallback(async () => {
    const body = await readEvidenceDeliveryJson<{ credentials: MetricsCredential[] }>(
      await fetch(endpoint, { cache: "no-store", credentials: "same-origin" }),
    );
    setCredentials(body.credentials);
  }, [endpoint]);

  useEffect(() => {
    void load().catch(() => setMessage(errors("loadMetrics")));
  }, [errors, load]);

  const revoke = async (credential: MetricsCredential) => {
    setBusy(true);
    setMessage(null);
    try {
      await readEvidenceDeliveryJson(
        await fetch(`${endpoint}/${encodeURIComponent(credential.credentialId)}`, {
          method: "DELETE",
          credentials: "same-origin",
        }),
      );
      await load();
      setMessage(statusCopy("credentialRevoked"));
    } catch {
      setMessage(errors("updateMetrics"));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (credential: MetricsCredential) => {
    setBusy(true);
    setMessage(null);
    try {
      const created = await readEvidenceDeliveryJson<IssuedMetricsCredential>(
        await fetch(`${endpoint}/${encodeURIComponent(credential.credentialId)}/rotate`, {
          method: "POST",
          credentials: "same-origin",
        }),
      );
      setOneTimeToken(created.token);
      await load();
      setMessage(statusCopy("credentialRotatedShort"));
    } catch {
      setMessage(errors("rotateMetrics"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section" variant="nested" className="rounded-xl p-5" aria-labelledby="metrics-access-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="metrics-access-heading" className="font-semibold">
            <AgentText id="translated192" />
          </h3>
          <p className="mt-2 text-sm leading-6 text-base-content/55">
            <AgentText id="translated193" />
          </p>
        </div>
        <span className="badge badge-ghost">
          {credentials.filter(credential => credential.status === "active").length} <AgentText id="translated194" />
        </span>
      </div>
      {credentials.length > 0 ? (
        <div className="mt-4 space-y-3">
          {credentials.map(credential => (
            <article key={credential.credentialId} className="rounded-xl border border-base-content/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{credential.label}</p>
                  <p className="mt-1 font-mono text-xs text-base-content/55">{credential.credentialId}</p>
                </div>
                <span
                  className={`badge border-0 capitalize ${credential.status === "active" ? "bg-success/10 text-success" : "bg-base-content/[0.06] text-base-content/55"}`}
                >
                  {copy(`credential.${credential.status}`)}
                </span>
              </div>
              <p className="mt-3 text-xs text-base-content/55">
                <AgentText id="translated195" />{" "}
                {credential.lastUsedAt
                  ? format.dateTime(new Date(credential.lastUsedAt), { dateStyle: "medium", timeStyle: "short" })
                  : copy("never")}
              </p>
              {credential.status === "active" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-xs border-base-content/10 bg-base-content/[0.06]"
                    disabled={busy || oneTimeToken !== null}
                    onClick={() => void rotate(credential)}
                  >
                    <AgentText id="translated196" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs border-error/20 bg-error/[0.04] text-error"
                    disabled={busy}
                    onClick={() => void revoke(credential)}
                  >
                    <AgentText id="translated132" />
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-base-content/55">
          <AgentText id="noMetricsCredential" />
        </p>
      )}
      {oneTimeToken ? (
        <OneTimeSecretNotice
          label={ui("metricsBearerToken")}
          value={oneTimeToken}
          onDismiss={() => setOneTimeToken(null)}
        />
      ) : null}
      <form
        className="mt-4 flex flex-col gap-3 rounded-xl border border-base-content/10 p-4 sm:flex-row sm:items-end"
        onSubmit={event => {
          event.preventDefault();
          setBusy(true);
          setMessage(null);
          clear();
          void fetch(endpoint, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label }),
          })
            .then(response => readEvidenceDeliveryJson<IssuedMetricsCredential>(response))
            .then(created => {
              setOneTimeToken(created.token);
              return load();
            })
            .then(() => {
              setLabel("");
              setMessage(statusCopy("credentialIssued"));
            })
            .catch(() => capture(errors("issueMetrics"), errors("issueMetrics")))
            .finally(() => setBusy(false));
        }}
      >
        <div className="w-full sm:max-w-md">
          <Field
            label={<AgentText id="attribute030" />}
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            value={label}
            error={fieldErrors.label}
            onChange={event => {
              clear("label");
              setLabel(event.target.value);
            }}
            placeholder={ui("securityOperationsPlaceholder")}
            required
            maxLength={100}
          />
        </div>
        <button type="submit" className="btn btn-sm rateloop-gradient-action" disabled={busy || oneTimeToken !== null}>
          {busy ? <AgentText id="dynamic045" /> : <AgentText id="dynamic044" />}
        </button>
      </form>
      {message ? (
        <p className="mt-4 text-xs text-base-content/60" role="status">
          {message}
        </p>
      ) : null}
      {formError ? (
        <p className="mt-4 text-xs text-error" role="alert">
          {formError}
        </p>
      ) : null}
    </Card>
  );
}
