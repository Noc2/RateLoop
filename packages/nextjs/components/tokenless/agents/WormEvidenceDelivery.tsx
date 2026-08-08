"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentFormatter, useAgentTranslations } from "./AgentsLocaleProvider";
import { readEvidenceDeliveryJson } from "./evidenceDeliveryClient";
import { Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";

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
  label: "",
  endpointOrigin: "https://s3.amazonaws.com",
  bucketName: "",
  keyPrefix: "rateloop/assurance",
  region: "us-east-1",
  credentialReference: "",
  retentionDays: "365",
};

export function WormEvidenceDelivery({ workspaceId }: { workspaceId: string }) {
  const copy = useAgentTranslations("evidencePanels.delivery");
  const errors = useAgentTranslations("errors");
  const format = useAgentFormatter();
  const statusCopy = useAgentTranslations("status");
  const base = `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/worm`;
  const [destination, setDestination] = useState<WormDestination | null>(null);
  const [exports, setExports] = useState<WormExport[]>([]);
  const [form, setForm] = useState(() => ({ ...INITIAL_FORM, label: copy("archiveDefaultLabel") }));
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

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
    void load().catch(() => capture(errors("loadArchive"), errors("loadArchive")));
  }, [capture, errors, load]);

  const mutate = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    clear();
    try {
      await work();
      await load();
    } catch {
      capture(errors("loadArchive"), errors("loadArchive"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section" variant="nested" className="rounded-xl p-5" aria-labelledby="immutable-archive-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="immutable-archive-heading" className="font-semibold">
            <AgentText id="translated234" />
          </h3>
          <p className="mt-2 text-sm leading-6 text-base-content/55">
            <AgentText id="translated235" />
          </p>
        </div>
        <span
          className={`badge border-0 ${destination ? "bg-success/10 text-success" : "bg-base-content/[0.06] text-base-content/55"}`}
        >
          {destination ? <AgentText id="dynamic070" /> : <AgentText id="dynamic068" />}
        </span>
      </div>

      {destination ? (
        <div className="mt-4 rounded-xl border border-success/15 bg-success/[0.04] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{destination.label}</p>
            <span className="badge border-0 bg-success/10 text-success">
              <AgentText id="verified" />
            </span>
          </div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-base-content/55">
                <AgentText id="bucketPath" />
              </dt>
              <dd className="mt-1 break-all font-mono text-xs">
                {destination.bucketName}/{destination.keyPrefix}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/55">
                <AgentText id="objectLock" />
              </dt>
              <dd className="mt-1">
                COMPLIANCE · {destination.retentionDays} <AgentText id="translated236" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/55">
                <AgentText id="endpoint" />
              </dt>
              <dd className="mt-1 break-all">{destination.endpointOrigin}</dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/55">
                <AgentText id="preflight" />
              </dt>
              <dd className="mt-1">
                {format.dateTime(new Date(destination.preflight.checkedAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              className="btn btn-sm border-base-content/10 bg-base-content/[0.06]"
              href={`${base}/supervision`}
              download
            >
              <AgentText id="translated237" />
            </a>
            <Button
              variant="primary"
              size="sm"
              type="button"
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
                  setMessage(statusCopy("archiveQueued"));
                })
              }
            >
              <AgentText id="translated238" />
            </Button>
            <button
              type="button"
              className="btn btn-sm border-error/20 bg-error/[0.04] text-error"
              disabled={busy}
              onClick={() =>
                void mutate(async () => {
                  await readEvidenceDeliveryJson(
                    await fetch(`${base}/destination/${encodeURIComponent(destination.destinationId)}`, {
                      method: "DELETE",
                      credentials: "same-origin",
                    }),
                  );
                  setMessage(statusCopy("archiveDisabled"));
                })
              }
            >
              <AgentText id="translated239" />
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-base-content/55">
          <AgentText id="noArchive" />
        </p>
      )}

      <Button
        variant="secondary"
        size="sm"
        className="btn-sm mt-4"
        type="button"
        aria-expanded={showForm}
        aria-controls="immutable-archive-form"
        disabled={busy}
        onClick={() => setShowForm(true)}
      >
        {destination ? <AgentText id="dynamic069" /> : <AgentText id="dynamic067" />}
      </Button>
      {showForm ? (
        <form
          id="immutable-archive-form"
          className="mt-4 grid gap-4 rounded-xl border border-base-content/10 p-4 sm:grid-cols-2"
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
              setForm({ ...INITIAL_FORM, label: copy("archiveDefaultLabel") });
              setShowForm(false);
              setMessage(statusCopy("archiveVerified"));
            });
          }}
        >
          <Field
            label={<AgentText id="attribute022" />}
            value={form.label}
            error={fieldErrors.label}
            onChange={event => {
              clear("label");
              setForm(current => ({ ...current, label: event.target.value }));
            }}
            required
            maxLength={120}
          />
          <Field
            label={<AgentText id="attribute036" />}
            type="url"
            value={form.endpointOrigin}
            error={fieldErrors.endpointOrigin}
            onChange={event => {
              clear("endpointOrigin");
              setForm(current => ({ ...current, endpointOrigin: event.target.value }));
            }}
            required
          />
          <Field
            label={<AgentText id="attribute037" />}
            value={form.bucketName}
            error={fieldErrors.bucketName}
            onChange={event => {
              clear("bucketName");
              setForm(current => ({ ...current, bucketName: event.target.value }));
            }}
            required
          />
          <Field
            label={<AgentText id="attribute038" />}
            value={form.keyPrefix}
            error={fieldErrors.keyPrefix}
            onChange={event => {
              clear("keyPrefix");
              setForm(current => ({ ...current, keyPrefix: event.target.value }));
            }}
            required
          />
          <Field
            label={<AgentText id="attribute039" />}
            value={form.region}
            error={fieldErrors.region}
            onChange={event => {
              clear("region");
              setForm(current => ({ ...current, region: event.target.value }));
            }}
            required
          />
          <Field
            label={<AgentText id="attribute040" />}
            type="number"
            min={183}
            max={3650}
            value={form.retentionDays}
            error={fieldErrors.retentionDays}
            onChange={event => {
              clear("retentionDays");
              setForm(current => ({ ...current, retentionDays: event.target.value }));
            }}
            required
          />
          <div className="sm:col-span-2">
            <Field
              label={<AgentText id="attribute026" />}
              className="font-mono"
              value={form.credentialReference}
              error={fieldErrors.credentialReference}
              format="wormCredentialReference"
              hint={copy("archiveCredentialHint")}
              onChange={event => {
                clear("credentialReference");
                setForm(current => ({ ...current, credentialReference: event.target.value }));
              }}
              placeholder="sec_…"
              autoComplete="off"
              required
            />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button variant="primary" size="sm" type="submit" disabled={busy}>
              {busy ? <AgentText id="dynamic066" /> : <AgentText id="dynamic071" />}
            </Button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => {
                setForm({ ...INITIAL_FORM, label: copy("archiveDefaultLabel") });
                setShowForm(false);
              }}
            >
              <AgentText id="translated183" />
            </button>
          </div>
        </form>
      ) : null}

      {exports.length > 0 ? (
        <details className="mt-4 rounded-xl border border-base-content/10 p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            <AgentText id="recentArchive" />
          </summary>
          <div className="mt-3 space-y-2">
            {exports.slice(0, 8).map(job => (
              <div key={job.jobId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{copy(`artifact.${job.artifactType}`)}</span>
                <span className={job.state === "dead" ? "text-error" : "text-base-content/55"}>
                  {copy(`archiveState.${job.state}`)} ·{" "}
                  {job.deliveredAt
                    ? format.dateTime(new Date(job.deliveredAt), { dateStyle: "medium", timeStyle: "short" })
                    : copy("never")}
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
      {formError ? (
        <p className="mt-4 text-sm text-error" role="alert">
          {formError}
        </p>
      ) : null}
    </Card>
  );
}
