"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { readJson } from "~~/lib/tokenless/http";

type SubjectRequest = {
  requestId: string;
  requestType: string;
  status: string;
  receivedAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  exportReady: boolean;
  exportDeleteAfter: string | null;
};

function dateLabel(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Not available";
}

export function SubjectDataExportPanel() {
  const [requests, setRequests] = useState<SubjectRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await readJson(
        await fetch("/api/account/privacy/subject-requests", {
          cache: "no-store",
          credentials: "same-origin",
        }),
      );
      setRequests(Array.isArray(body.requests) ? (body.requests as SubjectRequest[]) : []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load your data requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function requestExport() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch("/api/account/privacy/subject-requests", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestType: "export" }),
        }),
      );
      setStatus("Your data export was requested. Refresh this status after processing completes.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to request your data export.");
    } finally {
      setBusy(false);
    }
  }

  const exports = requests.filter(request => request.requestType === "export");
  const pending = exports.some(request => !["completed", "denied", "cancelled"].includes(request.status));

  return (
    <Card as="section" className="rounded-2xl p-6" aria-labelledby="subject-data-export-heading">
      <h2 id="subject-data-export-heading" className="text-xl font-semibold">
        Download your data
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">
        Request an authenticated JSON copy of the personal data associated with your RateLoop account. Completed
        downloads remain available for seven days.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" onClick={() => void requestExport()} disabled={busy || loading || pending}>
          {busy ? "Requesting…" : pending ? "Export processing" : "Request data export"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void load()} disabled={busy || loading}>
          {loading ? "Refreshing…" : "Refresh status"}
        </Button>
      </div>
      {status ? (
        <p className="mt-4 text-sm text-emerald-100" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100" role="alert">
          {error}
        </p>
      ) : null}
      {exports.length ? (
        <ul className="mt-5 space-y-3">
          {exports.map(request => (
            <li key={request.requestId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {request.exportReady ? "Export ready" : `Export ${request.status.replaceAll("_", " ")}`}
                  </p>
                  <p className="mt-1 text-xs text-base-content/55">
                    Requested {dateLabel(request.receivedAt)}
                    {request.exportReady ? ` · available until ${dateLabel(request.exportDeleteAfter)}` : ""}
                  </p>
                </div>
                {request.exportReady ? (
                  <a
                    className="btn btn-sm rateloop-secondary-action"
                    href={`/api/account/privacy/subject-requests/${encodeURIComponent(request.requestId)}/export`}
                    download
                  >
                    Download JSON
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
