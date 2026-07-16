"use client";

import { useCallback, useEffect, useState } from "react";
import type { HumanReviewApproval } from "~~/lib/tokenless/humanReviewApprovals";

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

export function formatApprovalUsdc(atomic: string) {
  const amount = BigInt(atomic);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ""} USDC`;
}

function audienceLabel(kind: string) {
  if (kind === "private_invited") return "Invited reviewers";
  if (kind === "public_network") return "RateLoop network";
  if (kind === "hybrid") return "Invited and RateLoop reviewers";
  return kind;
}

function ApprovalCard({
  approval,
  decide,
}: {
  approval: HumanReviewApproval;
  decide: (approval: HumanReviewApproval, decision: "approve" | "reject") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const request = approval.preparedRequest;
  const economics = approval.economics;
  async function act(decision: "approve" | "reject") {
    setBusy(true);
    try {
      await decide(approval, decision);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="surface-card rounded-2xl p-5" aria-labelledby={`approval-${approval.approvalId}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--rateloop-blue)]">
            {request.workflowKey}
          </p>
          <h3 id={`approval-${approval.approvalId}`} className="mt-1 text-lg font-semibold">
            {request.question.criterion}
          </h3>
        </div>
        <span className="self-start rounded-md bg-white/[0.06] px-2 py-1 text-xs capitalize">{approval.status}</span>
      </div>

      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-base-content/45">Reviewers</dt>
          <dd className="mt-1">{audienceLabel(request.audience.kind)}</dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Answer window</dt>
          <dd className="mt-1">{Math.round(request.timing.responseWindowSeconds / 60)} minutes</dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Panel</dt>
          <dd className="mt-1">{request.panel.size} people</dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Maximum charge</dt>
          <dd className="mt-1">{formatApprovalUsdc(economics.maximumChargeAtomic)}</dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Compensation</dt>
          <dd className="mt-1 capitalize">
            {economics.compensationMode === "usdc"
              ? `${formatApprovalUsdc(economics.bountyPerSeatAtomic)} each`
              : "Unpaid"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Fee</dt>
          <dd className="mt-1">
            {formatApprovalUsdc(economics.feeAtomic)} (cap {(economics.maxFeeBps / 100).toFixed(2)}%)
          </dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Material</dt>
          <dd className="mt-1">
            {request.audience.contentBoundary.replaceAll("_", " ")}
            {request.audience.privateSensitivity ? ` · ${request.audience.privateSensitivity}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Expires</dt>
          <dd className="mt-1">{new Date(approval.expiresAt).toLocaleString()}</dd>
        </div>
      </dl>

      <details className="mt-5 border-t border-white/10 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-base-content/65">
          Frozen terms and provenance
        </summary>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-base-content/45">Answer labels</dt>
            <dd className="mt-1">
              {request.question.positiveLabel} / {request.question.negativeLabel} · rationale{" "}
              {request.question.rationaleMode}
            </dd>
          </div>
          <div>
            <dt className="text-base-content/45">Agent version</dt>
            <dd className="mt-1 break-all font-mono">
              {request.provenance.agentId} · {request.provenance.agentVersionId}
            </dd>
          </div>
          <div>
            <dt className="text-base-content/45">Selection policy</dt>
            <dd className="mt-1 break-all font-mono">
              {request.provenance.selectionPolicyId} v{request.provenance.selectionPolicyVersion}
            </dd>
          </div>
          <div>
            <dt className="text-base-content/45">Request profile</dt>
            <dd className="mt-1 break-all font-mono">
              {request.requestProfile.id} v{request.requestProfile.version}
            </dd>
          </div>
          <div>
            <dt className="text-base-content/45">Source commitment</dt>
            <dd className="mt-1 break-all font-mono">{request.contentCommitments.source}</dd>
          </div>
          <div>
            <dt className="text-base-content/45">Suggestion commitment</dt>
            <dd className="mt-1 break-all font-mono">{request.contentCommitments.suggestion}</dd>
          </div>
        </dl>
      </details>

      {approval.status === "pending" ? (
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act("approve")}>
            Approve request
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act("reject")}>
            Reject
          </button>
        </div>
      ) : (
        <p className="mt-5 text-sm text-base-content/55">Approved and ready for the request adapter.</p>
      )}
    </article>
  );
}

export function HumanReviewApprovalInbox({ workspaceId }: { workspaceId: string }) {
  const [approvals, setApprovals] = useState<HumanReviewApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!workspaceId) {
        setApprovals([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const body = await readJson(
          await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/human-review/approvals`, {
            cache: "no-store",
            credentials: "same-origin",
            signal,
          }),
        );
        if (!signal?.aborted) setApprovals((body.approvals ?? []) as HumanReviewApproval[]);
      } catch (cause) {
        if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Unable to load approvals.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function decide(approval: HumanReviewApproval, decision: "approve" | "reject") {
    setError(null);
    await readJson(
      await fetch(
        `/api/account/workspaces/${encodeURIComponent(workspaceId)}/human-review/approvals/${encodeURIComponent(approval.approvalId)}`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            revision: approval.revision,
            preparedRequestHash: approval.preparedRequestHash,
            derivedEconomicsHash: approval.derivedEconomicsHash,
            decision,
            note: null,
          }),
        },
      ),
    );
    await load();
  }

  return (
    <section className="space-y-4" aria-labelledby="human-review-approval-inbox-title">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Human review</p>
        <h2 id="human-review-approval-inbox-title" className="mt-2 text-2xl font-semibold">
          Requests awaiting approval
        </h2>
        <p className="mt-2 text-sm text-base-content/55">
          Review the frozen audience, timing, panel, and cost before anything is published or funded.
        </p>
      </div>
      {error ? (
        <p className="rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-base-content/55">Loading approval requests…</p> : null}
      {!loading && approvals.length === 0 ? (
        <div className="surface-card rounded-2xl p-6">
          <p className="font-semibold">No requests need approval</p>
          <p className="mt-1 text-sm text-base-content/55">Prepared review requests will appear here.</p>
        </div>
      ) : null}
      {approvals.map(approval => (
        <ApprovalCard key={approval.approvalId} approval={approval} decide={decide} />
      ))}
    </section>
  );
}
