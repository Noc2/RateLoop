"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentFormatter, useAgentTranslations } from "./AgentsLocaleProvider";
import {
  type ApprovalDecision,
  applyOptimisticApprovalDecision,
  confirmApprovalDecision,
  rollbackApprovalDecision,
} from "./approvalInboxState";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Badge } from "~~/components/tokenless/ui/Badge";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { readJson } from "~~/lib/tokenless/http";
import type { HumanReviewApproval } from "~~/lib/tokenless/humanReviewApprovals";
import { formatUsdcAtomic } from "~~/lib/tokenless/usdc";

export function formatApprovalUsdc(atomic: string) {
  return formatUsdcAtomic(atomic);
}

function audienceLabel(kind: string, t: (key: string) => string) {
  if (kind === "private_invited") return t("audienceInvited");
  if (kind === "public_network") return t("audienceNetwork");
  if (kind === "hybrid") return t("audienceHybrid");
  return kind;
}

function ApprovalCard({
  approval,
  decide,
}: {
  approval: HumanReviewApproval;
  decide: (approval: HumanReviewApproval, decision: ApprovalDecision) => Promise<void>;
}) {
  const format = useAgentFormatter();
  const copy = useAgentTranslations("approvalInbox");
  const reviewersCopy = useAgentTranslations("reviewersPanel");
  const [busy, setBusy] = useState(false);
  const request = approval.preparedRequest;
  const economics = approval.economics;
  async function act(decision: ApprovalDecision) {
    setBusy(true);
    try {
      await decide(approval, decision);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      as="article"
      id={`approval-card-${approval.approvalId}`}
      data-approval-id={approval.approvalId}
      tabIndex={-1}
      aria-keyshortcuts="A D"
      className="rounded-2xl p-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--rateloop-blue)]"
      aria-labelledby={`approval-heading-${approval.approvalId}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--rateloop-blue)]">
            {request.workflowKey}
          </p>
          <h3 id={`approval-heading-${approval.approvalId}`} className="mt-1 text-lg font-semibold">
            {request.question.criterion}
          </h3>
          {request.question.questionAuthority === "agent_per_request" ? (
            <p className="mt-2 text-xs font-medium text-[var(--rateloop-yellow)]">
              <AgentText id="agentWrittenQuestion" />
            </p>
          ) : null}
        </div>
        <Badge className="self-start">
          {copy(
            approval.status === "pending"
              ? "statusPending"
              : approval.status === "approved"
                ? "statusApproved"
                : "statusRejected",
          )}
        </Badge>
      </div>

      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-base-content/55">
            <AgentText id="reviewers" />
          </dt>
          <dd className="mt-1">{audienceLabel(request.audience.kind, copy)}</dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/55">
            <AgentText id="answerWindow" />
          </dt>
          <dd className="mt-1">
            {Math.round(request.timing.responseWindowSeconds / 60)} <AgentText id="translated184" />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/55">
            <AgentText id="panel" />
          </dt>
          <dd className="mt-1">
            {request.panel.size} <AgentText id="translated185" />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/55">
            <AgentText id="maximumCharge" />
          </dt>
          <dd className="mt-1">{formatApprovalUsdc(approval.maximumConsentAtomic)}</dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/55">
            <AgentText id="compensation" />
          </dt>
          <dd className="mt-1 capitalize">
            {economics.compensationMode === "usdc" ? (
              copy("each", { amount: formatApprovalUsdc(economics.bountyPerSeatAtomic) })
            ) : (
              <AgentText id="dynamic043" />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/55">
            <AgentText id="fee" />
          </dt>
          <dd className="mt-1">
            {formatApprovalUsdc(economics.feeAtomic)} (
            {format.number(economics.feeBps / 100, { maximumFractionDigits: 2 })}%)
          </dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/55">
            <AgentText id="feedbackBonus" />
          </dt>
          <dd className="mt-1">
            {approval.feedbackBonusEconomics.enabled ? (
              copy("humanAwarded", { amount: formatApprovalUsdc(approval.feedbackBonusEconomics.poolAtomic) })
            ) : (
              <AgentText id="dynamic042" />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/55">
            <AgentText id="material" />
          </dt>
          <dd className="mt-1">
            {request.audience.contentBoundary === "private_workspace"
              ? copy("materialPrivate")
              : copy("materialPublic")}
            {request.audience.privateSensitivity
              ? ` · ${reviewersCopy(`sensitivity${request.audience.privateSensitivity[0]?.toUpperCase()}${request.audience.privateSensitivity.slice(1)}`)}`
              : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/55">
            <AgentText id="expires" />
          </dt>
          <dd className="mt-1">
            {format.dateTime(new Date(approval.expiresAt), { dateStyle: "medium", timeStyle: "short" })}
          </dd>
        </div>
      </dl>

      <details className="mt-5 border-t border-base-content/10 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-base-content/65">
          <AgentText id="translated186" />
        </summary>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-base-content/55">
              <AgentText id="answerLabels" />
            </dt>
            <dd className="mt-1">
              {request.question.positiveLabel} / {request.question.negativeLabel} <AgentText id="translated187" />{" "}
              {copy(
                request.question.rationaleMode === "off"
                  ? "rationaleOff"
                  : request.question.rationaleMode === "optional"
                    ? "rationaleOptional"
                    : "rationaleRequired",
              )}
            </dd>
          </div>
          {request.question.questionHash ? (
            <div>
              <dt className="text-base-content/55">
                <AgentText id="questionCommitment" />
              </dt>
              <dd className="mt-1 break-all font-mono">{request.question.questionHash}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-base-content/55">
              <AgentText id="agentVersion" />
            </dt>
            <dd className="mt-1 break-all font-mono">
              {request.provenance.agentId} · {request.provenance.agentVersionId}
            </dd>
          </div>
          <div>
            <dt className="text-base-content/55">
              <AgentText id="selectionPolicy" />
            </dt>
            <dd className="mt-1 break-all font-mono">
              {request.provenance.selectionPolicyId} v{request.provenance.selectionPolicyVersion}
            </dd>
          </div>
          <div>
            <dt className="text-base-content/55">
              <AgentText id="requestProfile" />
            </dt>
            <dd className="mt-1 break-all font-mono">
              {request.requestProfile.id} v{request.requestProfile.version}
            </dd>
          </div>
          <div>
            <dt className="text-base-content/55">
              <AgentText id="sourceCommitment" />
            </dt>
            <dd className="mt-1 break-all font-mono">{request.contentCommitments.source}</dd>
          </div>
          <div>
            <dt className="text-base-content/55">
              <AgentText id="suggestionCommitment" />
            </dt>
            <dd className="mt-1 break-all font-mono">{request.contentCommitments.suggestion}</dd>
          </div>
        </dl>
      </details>

      {approval.status === "pending" ? (
        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="button" disabled={busy} onClick={() => void act("approve")}>
            <AgentText id="translated188" />
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void act("reject")}>
            <AgentText id="translated189" />
          </Button>
        </div>
      ) : (
        <p className="mt-5 text-sm text-base-content/55">
          <AgentText id="approvalReady" />
        </p>
      )}
    </Card>
  );
}

export function HumanReviewApprovalInbox({ workspaceId }: { workspaceId: string }) {
  const errors = useAgentTranslations("errors");
  const copy = useAgentTranslations("approvalInbox");
  const [approvals, setApprovals] = useState<HumanReviewApproval[]>([]);
  const approvalsRef = useRef<HumanReviewApproval[]>([]);
  const approvalSectionRef = useRef<HTMLElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const commitApprovals = useCallback((next: HumanReviewApproval[]) => {
    approvalsRef.current = next;
    setApprovals(next);
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal, foreground = true) => {
      if (!workspaceId) {
        commitApprovals([]);
        setLoading(false);
        return;
      }
      if (foreground) setLoading(true);
      setError(null);
      try {
        const body = await readJson(
          await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/human-review/approvals`, {
            cache: "no-store",
            credentials: "same-origin",
            signal,
          }),
        );
        if (!signal?.aborted) commitApprovals((body.approvals ?? []) as HumanReviewApproval[]);
      } catch {
        if (!signal?.aborted) setError(errors("loadApprovals"));
      } finally {
        if (!signal?.aborted && foreground) setLoading(false);
      }
    },
    [commitApprovals, errors, workspaceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const decide = useCallback(
    async (approval: HumanReviewApproval, decision: ApprovalDecision) => {
      const optimistic = applyOptimisticApprovalDecision(approvalsRef.current, approval.approvalId, decision);
      if (!optimistic.rollback) return;
      commitApprovals(optimistic.approvals);
      setError(null);
      try {
        const body = await readJson(
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
        const decided = body.approval as HumanReviewApproval | undefined;
        if (!decided || decided.approvalId !== approval.approvalId) {
          throw new Error("The approval response was incomplete.");
        }
        commitApprovals(confirmApprovalDecision(approvalsRef.current, decided));
      } catch {
        commitApprovals(rollbackApprovalDecision(approvalsRef.current, optimistic.rollback));
        const action = decision === "approve" ? copy("approveAction") : copy("declineAction");
        setError(copy("decisionFailed", { action }));
      }
    },
    [commitApprovals, copy, workspaceId],
  );

  const handleKeyboardTriage = useCallback(
    (event: globalThis.KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (!(event.target instanceof HTMLElement)) return;
      const target = event.target;
      if (target.matches("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (!["j", "k", "a", "d"].includes(key) || approvals.length === 0) return;

      const focusedId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-approval-id]")
        ?.dataset.approvalId;
      const focusedIndex = approvals.findIndex(approval => approval.approvalId === focusedId);

      event.preventDefault();
      if (key === "j" || key === "k") {
        const nextIndex =
          key === "j"
            ? focusedIndex < 0
              ? 0
              : (focusedIndex + 1) % approvals.length
            : focusedIndex < 0
              ? approvals.length - 1
              : (focusedIndex - 1 + approvals.length) % approvals.length;
        document.getElementById(`approval-card-${approvals[nextIndex]?.approvalId}`)?.focus();
        return;
      }

      const approval = approvals[focusedIndex < 0 ? 0 : focusedIndex];
      if (approval?.status === "pending" && !event.repeat) void decide(approval, key === "a" ? "approve" : "reject");
    },
    [approvals, decide],
  );

  useEffect(() => {
    const section = approvalSectionRef.current;
    if (!section) return;
    section.addEventListener("keydown", handleKeyboardTriage);
    return () => section.removeEventListener("keydown", handleKeyboardTriage);
  }, [handleKeyboardTriage]);

  return (
    <section
      ref={approvalSectionRef}
      className="space-y-4"
      aria-labelledby="human-review-approval-inbox-title"
      aria-keyshortcuts={approvals.length > 0 ? "J K A D" : undefined}
    >
      <div>
        <h2 id="human-review-approval-inbox-title" className="text-2xl font-semibold">
          <AgentText id="translated190" />
        </h2>
        <p className="mt-2 text-sm text-base-content/55">
          <AgentText id="translated191" />
        </p>
        {approvals.length > 0 ? (
          <p className="mt-1 text-xs text-base-content/55">
            <AgentText id="keyboardShortcuts" />
          </p>
        ) : null}
      </div>
      {error && approvals.length > 0 ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}
      <AsyncSection
        loading={loading}
        loadingLabel={copy("loading")}
        error={approvals.length === 0 ? error : null}
        empty={approvals.length === 0}
        emptyTitle={copy("empty")}
        emptyDescription={copy("emptyDescription")}
      >
        {approvals.map(approval => (
          <ApprovalCard key={approval.approvalId} approval={approval} decide={decide} />
        ))}
      </AsyncSection>
    </section>
  );
}
