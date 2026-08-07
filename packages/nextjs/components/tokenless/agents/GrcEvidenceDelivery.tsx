"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentFormatter, useAgentTranslations } from "./AgentsLocaleProvider";
import { readEvidenceDeliveryJson } from "./evidenceDeliveryClient";
import { ChoiceInput, Field, SelectField } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";

type Provider = "drata" | "vanta";
type ControlMapping = {
  mappingId: string;
  controlId: string;
  scopeId: string | null;
  minimumCoverageBps: number;
  requireSignedPacket: boolean;
};
type GrcConnector = {
  connectorId: string;
  provider: Provider;
  displayName: string;
  providerConfig: { connectionId: string; resourceId: string } | { documentId: string };
  controlMappings: ControlMapping[];
  status: "enabled" | "paused";
  nextReconcileAt: string;
  lastReconciledAt: string | null;
  lastDeliveryStatus: "succeeded" | "retry" | "failed" | null;
  lastErrorCode: string | null;
  lastReceipt: { externalReference: string; recordCount: number; deliveredAt: string } | null;
};

const INITIAL_FORM = {
  provider: "vanta" as Provider,
  displayName: "",
  credentialReference: "",
  documentId: "",
  connectionId: "",
  resourceId: "",
  mappingId: "human-assurance",
  controlId: "",
  scopeId: "",
  minimumCoveragePercent: "90",
  requireSignedPacket: true,
};

function connectorBody(connector: GrcConnector, status: "enabled" | "paused") {
  return {
    provider: connector.provider,
    displayName: connector.displayName,
    providerConfig: connector.providerConfig,
    controlMappings: connector.controlMappings,
    status,
  };
}

export function GrcEvidenceDelivery({ workspaceId }: { workspaceId: string }) {
  const copy = useAgentTranslations("evidencePanels.delivery");
  const errors = useAgentTranslations("errors");
  const format = useAgentFormatter();
  const statusCopy = useAgentTranslations("status");
  const endpoint = `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/grc-connectors`;
  const [connectors, setConnectors] = useState<GrcConnector[]>([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  const load = useCallback(async () => {
    const body = await readEvidenceDeliveryJson<{ connectors: GrcConnector[] }>(
      await fetch(endpoint, { cache: "no-store", credentials: "same-origin" }),
    );
    setConnectors(body.connectors);
  }, [endpoint]);

  useEffect(() => {
    void load().catch(() => capture(errors("loadGrc"), errors("loadGrc")));
  }, [capture, errors, load]);

  const changeStatus = async (connector: GrcConnector) => {
    setBusy(true);
    setMessage(null);
    clear();
    try {
      const url = `${endpoint}/${encodeURIComponent(connector.connectorId)}`;
      const response =
        connector.status === "enabled"
          ? await fetch(url, { method: "DELETE", credentials: "same-origin" })
          : await fetch(url, {
              method: "PUT",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(connectorBody(connector, "enabled")),
            });
      if (!response.ok) await readEvidenceDeliveryJson(response);
      await load();
      setMessage(connector.status === "enabled" ? copy("connectorPaused") : copy("connectorResumed"));
    } catch {
      capture(errors("updateGrc"), errors("updateGrc"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section" variant="nested" className="rounded-xl p-5" aria-labelledby="grc-connectors-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="grc-connectors-heading" className="font-semibold">
            <AgentText id="translated176" />
          </h3>
          <p className="mt-2 text-sm leading-6 text-base-content/55">
            <AgentText id="translated177" />
          </p>
        </div>
        <span className="badge badge-ghost">
          {copy(connectors.length === 1 ? "connectorCountOne" : "connectorCountMany", { count: connectors.length })}
        </span>
      </div>

      {connectors.length > 0 ? (
        <div className="mt-4 space-y-3">
          {connectors.map(connector => (
            <article key={connector.connectorId} className="rounded-xl border border-base-content/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{connector.displayName}</p>
                  <p className="mt-1 text-xs capitalize text-base-content/55">
                    {connector.provider} · {connector.controlMappings.length} <AgentText id="translated178" />
                  </p>
                </div>
                <span
                  className={`badge border-0 ${connector.status === "enabled" ? "bg-success/10 text-success" : "bg-base-content/[0.06] text-base-content/55"}`}
                >
                  {copy(connector.status)}
                </span>
              </div>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-base-content/55">
                    <AgentText id="lastReconciliation" />
                  </dt>
                  <dd className="mt-1">
                    {connector.lastReconciledAt
                      ? format.dateTime(new Date(connector.lastReconciledAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : copy("never")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-base-content/55">
                    <AgentText id="delivery" />
                  </dt>
                  <dd className="mt-1">
                    {connector.lastDeliveryStatus ? copy(connector.lastDeliveryStatus) : <AgentText id="dynamic041" />}
                  </dd>
                </div>
                {connector.lastReceipt ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-base-content/55">
                      <AgentText id="latestReceipt" />
                    </dt>
                    <dd className="mt-1">
                      {connector.lastReceipt.recordCount} <AgentText id="translated179" />{" "}
                      {format.dateTime(new Date(connector.lastReceipt.deliveredAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <button
                type="button"
                className="btn btn-xs mt-3 border-base-content/10 bg-base-content/[0.06]"
                disabled={busy}
                onClick={() => void changeStatus(connector)}
              >
                {copy(connector.status === "enabled" ? "pause" : "resume")}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-base-content/55">
          <AgentText id="noGrc" />
        </p>
      )}

      <Button
        variant="secondary"
        size="none"
        className="btn-sm mt-4"
        type="button"
        aria-expanded={showForm}
        aria-controls="grc-connector-form"
        disabled={busy}
        onClick={() => setShowForm(true)}
      >
        <AgentText id="translated180" />
      </Button>
      {showForm ? (
        <form
          id="grc-connector-form"
          className="mt-4 grid gap-4 rounded-xl border border-base-content/10 p-4 sm:grid-cols-2"
          onSubmit={event => {
            event.preventDefault();
            setBusy(true);
            setMessage(null);
            clear();
            const providerConfig =
              form.provider === "drata"
                ? { connectionId: form.connectionId, resourceId: form.resourceId }
                : { documentId: form.documentId };
            const controlMappings = [
              {
                mappingId: form.mappingId,
                controlId: form.controlId,
                scopeId: form.scopeId.trim() || null,
                minimumCoverageBps: Math.round(Number(form.minimumCoveragePercent) * 100),
                requireSignedPacket: form.requireSignedPacket,
              },
            ];
            void fetch(endpoint, {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: form.provider,
                displayName: form.displayName,
                credentialReference: form.credentialReference,
                providerConfig,
                controlMappings,
                status: "enabled",
              }),
            })
              .then(response => readEvidenceDeliveryJson<GrcConnector>(response))
              .then(() => load())
              .then(() => {
                setForm(INITIAL_FORM);
                setShowForm(false);
                setMessage(statusCopy("grcAdded"));
              })
              .catch(() => capture(errors("addGrc"), errors("addGrc")))
              .finally(() => setBusy(false));
          }}
        >
          <SelectField
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            label={<AgentText id="attribute021" />}
            labelClassName="text-sm text-base-content/65"
            value={form.provider}
            onChange={event => setForm(current => ({ ...current, provider: event.target.value as Provider }))}
          >
            <option value="vanta">Vanta</option>
            <option value="drata">Drata</option>
          </SelectField>
          <Field
            label={<AgentText id="attribute022" />}
            value={form.displayName}
            error={fieldErrors.displayName}
            onChange={event => {
              clear("displayName");
              setForm(current => ({ ...current, displayName: event.target.value }));
            }}
            required
            maxLength={100}
          />
          {form.provider === "vanta" ? (
            <Field
              containerClassName="sm:col-span-2"
              className="border-base-content/10 bg-[var(--rateloop-field)]"
              label={<AgentText id="attribute023" />}
              labelClassName="text-sm text-base-content/65"
              value={form.documentId}
              onChange={event => setForm(current => ({ ...current, documentId: event.target.value }))}
              required
            />
          ) : (
            <>
              <Field
                className="border-base-content/10 bg-[var(--rateloop-field)]"
                label={<AgentText id="attribute024" />}
                labelClassName="text-sm text-base-content/65"
                inputMode="numeric"
                value={form.connectionId}
                onChange={event => setForm(current => ({ ...current, connectionId: event.target.value }))}
                required
              />
              <Field
                className="border-base-content/10 bg-[var(--rateloop-field)]"
                label={<AgentText id="attribute025" />}
                labelClassName="text-sm text-base-content/65"
                inputMode="numeric"
                value={form.resourceId}
                onChange={event => setForm(current => ({ ...current, resourceId: event.target.value }))}
                required
              />
            </>
          )}
          <div className="sm:col-span-2">
            <Field
              label={<AgentText id="attribute026" />}
              className="font-mono"
              value={form.credentialReference}
              error={fieldErrors.credentialReference}
              format="grcCredentialReference"
              hint={copy("grcCredentialHint")}
              onChange={event => {
                clear("credentialReference");
                setForm(current => ({ ...current, credentialReference: event.target.value }));
              }}
              placeholder="vault://rateloop/grc/…"
              autoComplete="off"
              required
            />
          </div>
          <Field
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            label={<AgentText id="attribute027" />}
            labelClassName="text-sm text-base-content/65"
            value={form.mappingId}
            onChange={event => setForm(current => ({ ...current, mappingId: event.target.value }))}
            required
          />
          <Field
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            label={<AgentText id="attribute028" />}
            labelClassName="text-sm text-base-content/65"
            value={form.controlId}
            onChange={event => setForm(current => ({ ...current, controlId: event.target.value }))}
            required
          />
          <Field
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            label={
              <>
                <AgentText id="translated181" />{" "}
                <span className="text-base-content/55">
                  <AgentText id="optional" />
                </span>
              </>
            }
            labelClassName="text-sm text-base-content/65"
            value={form.scopeId}
            onChange={event => setForm(current => ({ ...current, scopeId: event.target.value }))}
          />
          <Field
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            label={<AgentText id="attribute029" />}
            labelClassName="text-sm text-base-content/65"
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={form.minimumCoveragePercent}
            onChange={event => setForm(current => ({ ...current, minimumCoveragePercent: event.target.value }))}
            hint={copy("eligibleEvidencePercent")}
            required
          />
          <label
            className="flex items-center gap-2 text-sm text-base-content/65 sm:col-span-2"
            htmlFor="grc-require-signed-packet"
          >
            <ChoiceInput
              id="grc-require-signed-packet"
              className="checkbox checkbox-sm"
              type="checkbox"
              checked={form.requireSignedPacket}
              onChange={event => setForm(current => ({ ...current, requireSignedPacket: event.target.checked }))}
            />

            <AgentText id="translated182" />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button variant="primary" size="sm" type="submit" disabled={busy}>
              {busy ? <AgentText id="dynamic040" /> : <AgentText id="dynamic039" />}
            </Button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => {
                setForm(INITIAL_FORM);
                setShowForm(false);
              }}
            >
              <AgentText id="translated183" />
            </button>
          </div>
        </form>
      ) : null}
      {message ? (
        <p className="mt-4 text-xs text-base-content/60" role="status">
          {message}
        </p>
      ) : null}
      {formError ? (
        <p className="mt-4 text-sm text-error" role="alert">
          {formError}
        </p>
      ) : null}
    </Card>
  );
}
