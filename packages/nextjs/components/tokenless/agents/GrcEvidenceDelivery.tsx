"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEvidenceDeliveryDate, readEvidenceDeliveryJson } from "./evidenceDeliveryClient";

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
  const endpoint = `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/grc-connectors`;
  const [connectors, setConnectors] = useState<GrcConnector[]>([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const body = await readEvidenceDeliveryJson<{ connectors: GrcConnector[] }>(
      await fetch(endpoint, { cache: "no-store", credentials: "same-origin" }),
    );
    setConnectors(body.connectors);
  }, [endpoint]);

  useEffect(() => {
    void load().catch(error => setMessage(error instanceof Error ? error.message : "Unable to load GRC connectors."));
  }, [load]);

  const changeStatus = async (connector: GrcConnector) => {
    setBusy(true);
    setMessage(null);
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
      setMessage(connector.status === "enabled" ? "Connector paused." : "Connector resumed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update GRC connector.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface-card-nested rounded-xl p-5" aria-labelledby="grc-connectors-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="grc-connectors-heading" className="font-semibold">
            GRC connectors
          </h3>
          <p className="mt-2 text-sm leading-6 text-base-content/55">
            Deliver signed assurance evidence to Drata or Vanta.
          </p>
        </div>
        <span className="badge badge-ghost">
          {connectors.length} {connectors.length === 1 ? "connector" : "connectors"}
        </span>
      </div>

      {connectors.length > 0 ? (
        <div className="mt-4 space-y-3">
          {connectors.map(connector => (
            <article key={connector.connectorId} className="rounded-xl border border-white/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{connector.displayName}</p>
                  <p className="mt-1 text-xs capitalize text-base-content/45">
                    {connector.provider} · {connector.controlMappings.length} control mappings
                  </p>
                </div>
                <span
                  className={`badge border-0 ${connector.status === "enabled" ? "bg-emerald-300/10 text-emerald-100" : "bg-white/[0.06] text-base-content/55"}`}
                >
                  {connector.status}
                </span>
              </div>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-base-content/45">Last reconciliation</dt>
                  <dd className="mt-1">{formatEvidenceDeliveryDate(connector.lastReconciledAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-base-content/45">Delivery</dt>
                  <dd className="mt-1 capitalize">{connector.lastDeliveryStatus ?? "Not delivered"}</dd>
                </div>
                {connector.lastReceipt ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-base-content/45">Latest receipt</dt>
                    <dd className="mt-1">
                      {connector.lastReceipt.recordCount} records ·{" "}
                      {formatEvidenceDeliveryDate(connector.lastReceipt.deliveredAt)}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <button
                type="button"
                className="btn btn-xs mt-3 border-white/10 bg-white/[0.06]"
                disabled={busy}
                onClick={() => void changeStatus(connector)}
              >
                {connector.status === "enabled" ? "Pause" : "Resume"}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-base-content/50">No GRC connector is configured.</p>
      )}

      <button
        type="button"
        className="btn btn-sm rateloop-secondary-action mt-4"
        aria-expanded={showForm}
        aria-controls="grc-connector-form"
        disabled={busy}
        onClick={() => setShowForm(true)}
      >
        Add connector
      </button>
      {showForm ? (
        <form
          id="grc-connector-form"
          className="mt-4 grid gap-4 rounded-xl border border-white/10 p-4 sm:grid-cols-2"
          onSubmit={event => {
            event.preventDefault();
            setBusy(true);
            setMessage(null);
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
                setMessage("GRC connector added. Reconciliation runs daily.");
              })
              .catch(error => setMessage(error instanceof Error ? error.message : "Unable to add GRC connector."))
              .finally(() => setBusy(false));
          }}
        >
          <label className="text-sm text-base-content/65">
            Provider
            <select
              className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={form.provider}
              onChange={event => setForm(current => ({ ...current, provider: event.target.value as Provider }))}
            >
              <option value="vanta">Vanta</option>
              <option value="drata">Drata</option>
            </select>
          </label>
          <label className="text-sm text-base-content/65">
            Name
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={form.displayName}
              onChange={event => setForm(current => ({ ...current, displayName: event.target.value }))}
              required
              maxLength={100}
            />
          </label>
          {form.provider === "vanta" ? (
            <label className="text-sm text-base-content/65 sm:col-span-2">
              Vanta document ID
              <input
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={form.documentId}
                onChange={event => setForm(current => ({ ...current, documentId: event.target.value }))}
                required
              />
            </label>
          ) : (
            <>
              <label className="text-sm text-base-content/65">
                Drata connection ID
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  inputMode="numeric"
                  value={form.connectionId}
                  onChange={event => setForm(current => ({ ...current, connectionId: event.target.value }))}
                  required
                />
              </label>
              <label className="text-sm text-base-content/65">
                Drata resource ID
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  inputMode="numeric"
                  value={form.resourceId}
                  onChange={event => setForm(current => ({ ...current, resourceId: event.target.value }))}
                  required
                />
              </label>
            </>
          )}
          <label className="text-sm text-base-content/65 sm:col-span-2">
            Server credential reference
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono"
              value={form.credentialReference}
              onChange={event => setForm(current => ({ ...current, credentialReference: event.target.value }))}
              placeholder="vault://rateloop/grc/…"
              pattern="(?:vault|kms|secret)://rateloop/grc/.{3,300}"
              autoComplete="off"
              required
            />
            <span className="mt-1 block text-xs text-base-content/45">
              Use a RateLoop vault, KMS, or secret reference. Provider tokens never pass through this form.
            </span>
          </label>
          <label className="text-sm text-base-content/65">
            Mapping ID
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={form.mappingId}
              onChange={event => setForm(current => ({ ...current, mappingId: event.target.value }))}
              required
            />
          </label>
          <label className="text-sm text-base-content/65">
            Control ID
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={form.controlId}
              onChange={event => setForm(current => ({ ...current, controlId: event.target.value }))}
              required
            />
          </label>
          <label className="text-sm text-base-content/65">
            Scope ID <span className="text-base-content/40">(optional)</span>
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={form.scopeId}
              onChange={event => setForm(current => ({ ...current, scopeId: event.target.value }))}
            />
          </label>
          <label className="text-sm text-base-content/65">
            Minimum coverage
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={form.minimumCoveragePercent}
              onChange={event => setForm(current => ({ ...current, minimumCoveragePercent: event.target.value }))}
              required
            />
            <span className="mt-1 block text-xs text-base-content/45">Percent of eligible evidence.</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-base-content/65 sm:col-span-2">
            <input
              className="checkbox checkbox-sm"
              type="checkbox"
              checked={form.requireSignedPacket}
              onChange={event => setForm(current => ({ ...current, requireSignedPacket: event.target.checked }))}
            />
            Require a signed packet for this control
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" className="btn btn-sm rateloop-gradient-action" disabled={busy}>
              {busy ? "Adding…" : "Add connector"}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => {
                setForm(INITIAL_FORM);
                setShowForm(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {message ? (
        <p className="mt-4 text-xs text-base-content/60" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
