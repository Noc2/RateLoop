"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { InfoPopover } from "~~/components/tokenless/InfoPopover";
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

export function SubjectDataExportPanel() {
  const t = useTranslations("account.dataExport");
  const format = useFormatter();
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
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
      setStatus(t("requested"));
      await load();
    } catch {
      setError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  const exports = requests.filter(request => request.requestType === "export");
  const pending = exports.some(request => !["completed", "denied", "cancelled"].includes(request.status));

  return (
    <Card as="section" className="rounded-2xl p-6" aria-labelledby="subject-data-export-heading">
      <div className="flex items-center gap-2">
        <h2 id="subject-data-export-heading" className="text-xl font-semibold">
          {t("title")}
        </h2>
        <InfoPopover label={t("about")}>{t("description")}</InfoPopover>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" onClick={() => void requestExport()} disabled={busy || loading || pending}>
          {busy ? t("requesting") : pending ? t("processing") : t("request")}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void load()} disabled={busy || loading}>
          {loading ? t("refreshing") : t("refresh")}
        </Button>
      </div>
      {status ? (
        <p className="mt-4 text-sm text-success" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {exports.length ? (
        <ul className="mt-5 space-y-3">
          {exports.map(request => (
            <li
              key={request.requestId}
              className="rounded-xl border border-base-content/10 bg-base-content/[0.025] p-4 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {request.exportReady ? t("ready") : t("status", { status: request.status.replaceAll("_", " ") })}
                  </p>
                  <p className="mt-1 text-xs text-base-content/55">
                    {t("requestedAt", {
                      date: request.receivedAt
                        ? format.dateTime(new Date(request.receivedAt), { dateStyle: "medium", timeStyle: "short" })
                        : t("notAvailable"),
                    })}
                    {request.exportReady
                      ? ` · ${t("availableUntil", {
                          date: request.exportDeleteAfter
                            ? format.dateTime(new Date(request.exportDeleteAfter), {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })
                            : t("notAvailable"),
                        })}`
                      : ""}
                  </p>
                </div>
                {request.exportReady ? (
                  <a
                    className="btn btn-sm rateloop-secondary-action"
                    href={`/api/account/privacy/subject-requests/${encodeURIComponent(request.requestId)}/export`}
                    download
                  >
                    {t("download")}
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
