"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SignedOutGate } from "~~/components/auth/SignedOutGate";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { HumanAssuranceRaterClient } from "~~/components/tokenless/HumanAssuranceRaterClient";
import { InvitationRouterPanel } from "~~/components/tokenless/account/InvitationRouterPanel";
import {
  type PrivateAnswerAssignment,
  PrivateAssignmentCard,
} from "~~/components/tokenless/answer/PrivateAssignmentCard";
import {
  type PaidTaskAccess,
  type PublicAnswerTask,
  PublicQuestionCard,
} from "~~/components/tokenless/answer/PublicQuestionCard";
import { HumanTabs } from "~~/components/tokenless/human/HumanTabs";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Card } from "~~/components/tokenless/ui/Card";
import { usePathname } from "~~/i18n/navigation";
import { readBrowserSession, subscribeToBrowserAuthSessionChanges } from "~~/lib/auth/client";
import { AnswerRequestError, loadAnswerQueues, readAccountBoundAssignments } from "~~/lib/tokenless/answerQueue";

type ReviewView = "active" | "history";

function paidTaskAccess(value: unknown): PaidTaskAccess {
  if (value && typeof value === "object") {
    const access = value as Record<string, unknown>;
    if (access.state === "ready" || access.state === "payout_wallet_required") return { state: access.state };
    if (access.state === "eligibility_required") {
      return {
        state: "eligibility_required",
        eligibilityStatus: typeof access.eligibilityStatus === "string" ? access.eligibilityStatus : "not_started",
      };
    }
  }
  return { state: "eligibility_required", eligibilityStatus: "not_started" };
}

export function AnswerPageClient({
  initialInvitationOpen = false,
  initialView = "active",
}: {
  initialInvitationOpen?: boolean;
  initialView?: ReviewView;
}) {
  const t = useTranslations("review.queue");
  const pathname = usePathname();
  const [invitationOpen, setInvitationOpen] = useState(initialInvitationOpen);
  const [view, setView] = useState<ReviewView>(initialView);
  const [tasks, setTasks] = useState<PublicAnswerTask[]>([]);
  const [assignments, setAssignments] = useState<PrivateAnswerAssignment[]>([]);
  const [focusedAssignmentId, setFocusedAssignmentId] = useState<string | null>(null);
  const [paidAccess, setPaidAccess] = useState<PaidTaskAccess>({
    state: "eligibility_required",
    eligibilityStatus: "not_started",
  });
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [principalId, setPrincipalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const principalRef = useRef<string | null>(null);
  const assignmentTitleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const assignment of assignments) {
      const title = assignment.projectName ?? t("privateReview");
      counts.set(title, (counts.get(title) ?? 0) + 1);
    }
    return counts;
  }, [assignments, t]);
  const loadGenerationRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setError(null);
    setSignedOut(false);
    try {
      const browserSession = await readBrowserSession(controller.signal);
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      const nextPrincipalId = browserSession?.principalId ?? null;
      if (principalRef.current !== nextPrincipalId) {
        principalRef.current = nextPrincipalId;
        setTasks([]);
        setAssignments([]);
        setFocusedAssignmentId(null);
        setPaidAccess({ state: "eligibility_required", eligibilityStatus: "not_started" });
      }
      if (!browserSession) {
        setPrincipalId(null);
        setSignedOut(true);
        return;
      }
      setPrincipalId(browserSession.principalId);
      const fetchWithSignal: typeof fetch = (input, init) => fetch(input, { ...init, signal: controller.signal });
      const [publicQueue, privateQueue] = await loadAnswerQueues(
        "",
        view === "history" ? "private" : "all",
        fetchWithSignal,
        view,
      );
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      setTasks((publicQueue.body.tasks ?? []) as PublicAnswerTask[]);
      const nextAssignments = (
        privateQueue.error ? [] : readAccountBoundAssignments(privateQueue.body, browserSession.principalId, view)
      ) as PrivateAnswerAssignment[];
      setAssignments(nextAssignments);
      setFocusedAssignmentId(current =>
        current && nextAssignments.some(assignment => assignment.assignmentId === current)
          ? current
          : (nextAssignments[0]?.assignmentId ?? null),
      );
      setPaidAccess(paidTaskAccess(publicQueue.body.paidAccess));
      const requestErrors = [publicQueue.error, privateQueue.error].filter(
        (value): value is AnswerRequestError => value !== null,
      );
      if (requestErrors.some(requestError => requestError.status === 401)) {
        setSignedOut(true);
      } else if (requestErrors.length) {
        setError([...new Set(requestErrors.map(requestError => requestError.message))].join(" "));
      }
    } catch (cause) {
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      if (cause instanceof AnswerRequestError && cause.status === 401) setSignedOut(true);
      else setError(t("loadFailed"));
    } finally {
      if (!controller.signal.aborted && generation === loadGenerationRef.current) setLoading(false);
    }
  }, [t, view]);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToBrowserAuthSessionChanges(() => void load()), [load]);

  const hasPublicTasks = tasks.length > 0;
  const hasPrivateAssignments = assignments.length > 0;

  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-4">
      <h1 className="sr-only">{view === "history" ? t("historyTitle") : t("activeTitle")}</h1>
      <HumanTabs
        active={view === "history" ? "history" : "discover"}
        endAction={
          principalId && view === "active" && (hasPublicTasks || hasPrivateAssignments) ? (
            <button
              type="button"
              className="btn btn-sm rateloop-secondary-action ml-auto"
              aria-controls="discover-invitation-panel"
              aria-expanded={invitationOpen}
              onClick={() => setInvitationOpen(current => !current)}
            >
              {invitationOpen ? t("hideInvitation") : t("haveInvitation")}
            </button>
          ) : null
        }
      />

      {principalId ? (
        <div id="discover-invitation-panel" hidden={!invitationOpen}>
          <InvitationRouterPanel onAccepted={() => void load()} />
        </div>
      ) : null}

      <div className="space-y-4">
        <AsyncSection loading={loading} loadingLabel={t("loading")}>
          {null}
        </AsyncSection>
        {!loading && !signedOut && view === "active" && assignments.length > 1 ? (
          <Card
            as="div"
            role="group"
            className="flex flex-wrap gap-2 rounded-lg p-3"
            aria-label={t("privateAssignments")}
          >
            {assignments.map((assignment, index) => (
              <button
                key={assignment.assignmentId}
                type="button"
                aria-pressed={focusedAssignmentId === assignment.assignmentId}
                onClick={() => setFocusedAssignmentId(assignment.assignmentId)}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  focusedAssignmentId === assignment.assignmentId
                    ? "bg-base-content text-base-100"
                    : "bg-base-content/[0.04] text-base-content/65 hover:bg-base-content/[0.08]"
                }`}
              >
                {(assignmentTitleCounts.get(assignment.projectName ?? t("privateReview")) ?? 0) > 1
                  ? `${assignment.projectName ?? t("privateReview")} · ${index + 1}`
                  : (assignment.projectName ?? t("privateReview"))}
              </button>
            ))}
          </Card>
        ) : null}
        {!loading && !signedOut ? (
          view === "active" ? (
            assignments
              .filter(assignment => assignment.assignmentId === focusedAssignmentId)
              .map(assignment => (
                <HumanAssuranceRaterClient
                  key={assignment.assignmentId}
                  principalId={principalId}
                  initialAssignmentId={assignment.assignmentId}
                  initialTermsHash={assignment.confidentialityTermsHash ?? ""}
                  presentation="embedded"
                  assignmentTitle={assignment.projectName ?? t("assignedPrivateReview")}
                  assignmentExpiresAt={assignment.assignmentExpiresAt}
                  onContinue={() => void load()}
                />
              ))
          ) : assignments.length ? (
            <ul className="space-y-2">
              {assignments.map(assignment => (
                <PrivateAssignmentCard key={assignment.assignmentId} assignment={assignment} />
              ))}
            </ul>
          ) : null
        ) : null}
        {!loading && !signedOut && principalId && view === "active"
          ? tasks.map((task, index) => (
              <PublicQuestionCard
                key={task.roundId}
                task={task}
                paidAccess={paidAccess}
                principalId={principalId}
                onSubmitted={() => void load()}
                shortcutsEnabled={index === 0}
              />
            ))
          : null}
        {!loading && signedOut ? (
          <SignedOutGate
            headingLevel={2}
            layout="embedded"
            returnTo={assignedInboxHref(pathname, initialInvitationOpen, view)}
            title={t("signInTitle")}
            titleId="human-discover-sign-in-title"
          />
        ) : null}
        {!loading && !signedOut && !error && tasks.length === 0 && assignments.length === 0 ? (
          <Card
            as="div"
            className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-lg p-6 text-center"
          >
            <p className="text-base text-base-content/60">{view === "history" ? t("noHistory") : t("noneAvailable")}</p>
            {view === "active" && !invitationOpen ? (
              <button
                type="button"
                className="btn btn-sm rateloop-secondary-action"
                aria-controls="discover-invitation-panel"
                onClick={() => setInvitationOpen(true)}
              >
                {t("useInvitation")}
              </button>
            ) : null}
          </Card>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg bg-error/10 p-4 text-sm text-error">
            {error}
          </p>
        ) : null}
      </div>
    </AppPageShell>
  );
}

function assignedInboxHref(pathname: string, invitationOpen: boolean, view: ReviewView) {
  const params = new URLSearchParams();
  if (invitationOpen) params.set("invite", "1");
  const search = params.toString();
  const expectedPathname = `/human/${view === "history" ? "history" : "review"}`;
  const safePathname = pathname === expectedPathname ? pathname : expectedPathname;
  return `${safePathname}${search ? `?${search}` : ""}`;
}
