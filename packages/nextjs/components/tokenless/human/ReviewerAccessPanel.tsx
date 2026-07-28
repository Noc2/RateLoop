"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Card } from "~~/components/tokenless/ui/Card";
import { ConfirmDialog } from "~~/components/tokenless/ui/ConfirmDialog";

type ReviewerAccess = {
  workspaceId: string;
  workspaceName: string;
  status: "active" | "removed" | "left" | "expired";
  grants: Array<{
    grantId: string;
    maxPrivateSensitivity: "internal" | "confidential" | "restricted" | "regulated";
    validUntil: string | null;
    status: "active" | "expired" | "revoked";
  }>;
};

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

function expiryLabel(value: string | null) {
  if (!value) return "No expiry";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "No expiry" : parsed.toLocaleDateString();
}

export function ReviewerAccessPanel() {
  const [access, setAccess] = useState<ReviewerAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyWorkspaceId, setBusyWorkspaceId] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState<ReviewerAccess | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const body = await readJson(
      await fetch("/api/account/reviewer-access", {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      }),
    );
    setAccess((body.reviewerAccess ?? []) as ReviewerAccess[]);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal)
      .then(() => setLoadError(null))
      .catch(cause => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setLoadError(cause instanceof Error ? cause.message : "Unable to load reviewer access.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load]);

  async function leave(item: ReviewerAccess) {
    setBusyWorkspaceId(item.workspaceId);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(`/api/account/reviewer-access/${encodeURIComponent(item.workspaceId)}`, {
          method: "DELETE",
          credentials: "same-origin",
        }),
      );
      await load();
      setPendingLeave(null);
      setStatus(`You will not receive new private work from ${item.workspaceName}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to leave the reviewer roster.");
    } finally {
      setBusyWorkspaceId(null);
    }
  }

  const activeAccess = access.filter(item => item.status === "active");
  return (
    <Card as="section" className="scroll-mt-24 rounded-2xl p-6" aria-labelledby="reviewer-access-heading">
      <div className="border-b border-white/10 pb-4">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Reviewer access</p>
        <h2 id="reviewer-access-heading" className="mt-2 text-xl font-semibold">
          Workspaces you review
        </h2>
      </div>
      <div className="mt-5">
        <AsyncSection
          loading={loading}
          loadingLabel="Loading reviewer access"
          error={loadError}
          empty={activeAccess.length === 0}
          emptyTitle="You do not review for a workspace yet."
        >
          <ul className="space-y-3">
            {activeAccess.map(item => (
              <Card as="li" variant="nested" className="rounded-lg p-4" key={item.workspaceId}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">{item.workspaceName}</h3>
                    {item.grants
                      .filter(grant => grant.status === "active")
                      .map(grant => (
                        <p className="mt-2 text-xs text-base-content/55" key={grant.grantId}>
                          Up to {grant.maxPrivateSensitivity} material · access expires {expiryLabel(grant.validUntil)}
                        </p>
                      ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm border border-red-300/20 bg-red-300/[0.06] text-red-100"
                    disabled={busyWorkspaceId === item.workspaceId}
                    onClick={() => setPendingLeave(item)}
                  >
                    {busyWorkspaceId === item.workspaceId ? "Leaving…" : "Stop reviewing"}
                  </button>
                </div>
              </Card>
            ))}
          </ul>
        </AsyncSection>
        {!loading && !loadError && activeAccess.length === 0 ? (
          <Link className="btn btn-sm rateloop-secondary-action mt-3" href="/human/review?invite=1">
            Use an invitation
          </Link>
        ) : null}
      </div>
      {status ? (
        <p role="status" className="mt-5 rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-100">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-5 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={pendingLeave !== null}
        title={`Stop reviewing for ${pendingLeave?.workspaceName ?? "this workspace"}?`}
        description="You will stop receiving new private work from this workspace."
        confirmLabel="Stop reviewing"
        busy={busyWorkspaceId !== null}
        onCancel={() => setPendingLeave(null)}
        onConfirm={() => {
          if (pendingLeave) void leave(pendingLeave);
        }}
      />
    </Card>
  );
}
