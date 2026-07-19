"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEvidenceDeliveryDate, readEvidenceDeliveryJson } from "./evidenceDeliveryClient";

type WormDestination = {
  destinationId: string;
  version: number;
  label: string;
  endpointOrigin: string;
  bucketName: string;
  keyPrefix: string;
  region: string;
  retentionDays: number;
  status: "verified" | "superseded" | "disabled";
  verifiedAt: string;
  preflight: {
    versioning: "Enabled";
    objectLockEnabled: true;
    defaultRetention: { mode: "COMPLIANCE"; days: number };
    checkedAt: string;
  };
};

type WormExport = {
  jobId: string;
  artifactType: "audit_export" | "coverage_export" | "supervision_report";
  state: "pending" | "delivering" | "retry" | "delivered" | "dead";
  attemptCount: number;
  lastErrorCode: string | null;
  deliveredAt: string | null;
  receipt: { objectVersionId: string; objectLockMode: "COMPLIANCE"; retentionUntil: string } | null;
};

const INITIAL_FORM = {
  label: "Assurance archive",
  endpointOrigin: "https://s3.amazonaws.com",
  bucketName: "",
  keyPrefix: "rateloop/assurance",
  region: "us-east-1",
  credentialReference: "",
  retentionDays: "365",
};

function wormStateLabel(state: WormExport["state"]) {
  if (state === "delivered") return "Locked";
  if (state === "dead") return "Failed";
  if (state === "retry") return "Retry scheduled";
  return state === "delivering" ? "Delivering" : "Queued";
}

export function WormEvidenceDelivery({ workspaceId }: { workspaceId: string }) {
  const base = `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/worm`;
  const [destination, setDestination] = useState<WormDestination | null>(null);
  const [exports, setExports] = useState<WormExport[]>([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [destinationBody, exportBody] = await Promise.all([
      readEvidenceDeliveryJson<{ active: WormDestination | null }>(
        await fetch(`${base}/destination`, { cache: "no-store", credentials: "same-origin" }),
      ),
      readEvidenceDeliveryJson<{ jobs: WormExport[] }>(
        await fetch(`${base}/exports`, { cache: "no-store", credentials: "same-origin" }),
      ),
    ]);
    setDestination(destinationBody.active);
    setExports(exportBody.jobs);
  }, [base]);

  useEffect(() => {
    void load().catch(error => setMessage(error instanceof Error ? error.message : "Unable to load WORM delivery."));
  }, [load]);

  const mutate = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "WORM delivery request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface-card-nested rounded-xl p-5" aria-labelledby="immutable-archive-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="immutable-archive-heading" className="font-semibold">
            Immutable archive
          </h3>
          <p className="mt-2 text-sm leading-6 text-base-content/55">
            Deliver supervision evidence to a verified S3 Object Lock destination.
          </p>
        </div>
        <span
          className={`badge border-0 ${destination ? "bg-emerald-300/10 text-emerald-100" : "bg-white/[0.06] text-base-content/55"}`}
        >
          {destination ? "Verified" : "Not configured"}
        </span>
      </div>

      {destination ? (
        <div className="mt-4 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{destination.label}</p>
            <span className="badge border-0 bg-emerald-300/10 text-emerald-100">Verified</span>
          </div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-base-content/45">Bucket path</dt>
              <dd className="mt-1 break-all font-mono text-xs">
                {destination.bucketName}/{destination.keyPrefix}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/45">Object Lock</dt>
              <dd className="mt-1">COMPLIANCE · {destination.retentionDays} days</dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/45">Endpoint</dt>
              <dd className="mt-1 break-all">{destination.endpointOrigin}</dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/45">Preflight</dt>
              <dd className="mt-1">{formatEvidenceDeliveryDate(destination.preflight.checkedAt)}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <a className="btn btn-sm border-white/10 bg-white/[0.06]" href={`${base}/supervision`} download>
              Download supervision report
            </a>
            <button
              type="button"
              className="btn btn-sm rateloop-gradient-action"
              disabled={busy}
              onClick={() =>
                void mutate(async () => {
                  await readEvidenceDeliveryJson(
                    await fetch(`${base}/exports`, {
                      method: "POST",
                      credentials: "same-origin",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ artifactType: "supervision_report" }),
                    }),
                  );
                  setMessage("Supervision report queued for immutable delivery.");
                })
              }
            >
              Archive report now
            </button>
            <button
              type="button"
              className="btn btn-sm border-red-300/20 bg-red-300/[0.04] text-red-100"
              disabled={busy}
              onClick={() =>
                void mutate(async () => {
                  await readEvidenceDeliveryJson(
                    await fetch(`${base}/destination/${encodeURIComponent(destination.destinationId)}`, {
                      method: "DELETE",
                      credentials: "same-origin",
                    }),
                  );
                  setMessage("Immutable delivery disabled. Existing locked objects are unchanged.");
                })
              }
            >
              Disable destination
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-base-content/50">No immutable archive is configured.</p>
      )}

      <button
        type="button"
        className="btn btn-sm rateloop-secondary-action mt-4"
        aria-expanded={showForm}
        aria-controls="immutable-archive-form"
        disabled={busy}
        onClick={() => setShowForm(true)}
      >
        {destination ? "Replace destination" : "Configure destination"}
      </button>
      {showForm ? (
        <form
          id="immutable-archive-form"
          className="mt-4 grid gap-4 rounded-xl border border-white/10 p-4 sm:grid-cols-2"
          onSubmit={event => {
            event.preventDefault();
            void mutate(async () => {
              await readEvidenceDeliveryJson(
                await fetch(`${base}/destination`, {
                  method: "PUT",
                  credentials: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ...form, retentionDays: Number(form.retentionDays) }),
                }),
              );
              setForm(INITIAL_FORM);
              setShowForm(false);
              setMessage("Destination passed Object Lock preflight and is active.");
            });
          }}
        >
          <label className="text-sm text-base-content/65">
            Name
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={form.label}
              onChange={event => setForm(current => ({ ...current, label: event.target.value }))}
              required
              maxLength={120}
            />
          </label>
          <label className="text-sm text-base-content/65">
            HTTPS endpoint origin
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              type="url"
              value={form.endpointOrigin}
              onChange={event => setForm(current => ({ ...current, endpointOrigin: event.target.value }))}
              required
            />
          </label>
          <label className="text-sm text-base-content/65">
            Bucket
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={form.bucketName}
              onChange={event => setForm(current => ({ ...current, bucketName: event.target.value }))}
              required
            />
          </label>
          <label className="text-sm text-base-content/65">
            Object prefix
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={form.keyPrefix}
              onChange={event => setForm(current => ({ ...current, keyPrefix: event.target.value }))}
              required
            />
          </label>
          <label className="text-sm text-base-content/65">
            Region
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={form.region}
              onChange={event => setForm(current => ({ ...current, region: event.target.value }))}
              required
            />
          </label>
          <label className="text-sm text-base-content/65">
            Retention (days)
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              type="number"
              min={183}
              max={3650}
              value={form.retentionDays}
              onChange={event => setForm(current => ({ ...current, retentionDays: event.target.value }))}
              required
            />
          </label>
          <label className="text-sm text-base-content/65 sm:col-span-2">
            Server credential reference
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono"
              value={form.credentialReference}
              onChange={event => setForm(current => ({ ...current, credentialReference: event.target.value }))}
              placeholder="sec_…"
              pattern="sec_[0-9a-f]{48}"
              autoComplete="off"
              required
            />
            <span className="mt-1 block text-xs text-base-content/45">
              Enter an opaque reference. Access keys never pass through this form.
            </span>
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" className="btn btn-sm rateloop-gradient-action" disabled={busy}>
              {busy ? "Checking…" : "Verify and save"}
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

      {exports.length > 0 ? (
        <details className="mt-4 rounded-xl border border-white/10 p-4">
          <summary className="cursor-pointer text-sm font-semibold">Recent archive deliveries</summary>
          <div className="mt-3 space-y-2">
            {exports.slice(0, 8).map(job => (
              <div key={job.jobId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="capitalize">{job.artifactType.replaceAll("_", " ")}</span>
                <span className={job.state === "dead" ? "text-red-100" : "text-base-content/55"}>
                  {wormStateLabel(job.state)} · {formatEvidenceDeliveryDate(job.deliveredAt)}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {message ? (
        <p className="mt-4 text-xs text-base-content/60" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
