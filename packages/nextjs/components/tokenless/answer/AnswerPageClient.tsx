"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SignedOutGate } from "~~/components/auth/SignedOutGate";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { HumanReviewExample } from "~~/components/tokenless/SignedOutExamples";
import {
  type PrivateAnswerAssignment,
  PrivateAssignmentCard,
} from "~~/components/tokenless/answer/PrivateAssignmentCard";
import {
  type PaidTaskAccess,
  type PublicAnswerTask,
  PublicQuestionCard,
} from "~~/components/tokenless/answer/PublicQuestionCard";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { readBrowserSession, subscribeToBrowserAuthSessionChanges } from "~~/lib/auth/client";
import { AnswerRequestError, loadAnswerQueues } from "~~/lib/tokenless/answerQueue";

type VisibleScope = "all" | "public" | "private";

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
  initialQuery = "",
  initialScope = "all",
}: {
  initialQuery?: string;
  initialScope?: VisibleScope;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const query = initialQuery;
  const [scope, setScope] = useState<VisibleScope>(initialScope);
  const [tasks, setTasks] = useState<PublicAnswerTask[]>([]);
  const [assignments, setAssignments] = useState<PrivateAnswerAssignment[]>([]);
  const [paidAccess, setPaidAccess] = useState<PaidTaskAccess>({
    state: "eligibility_required",
    eligibilityStatus: "not_started",
  });
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [principalId, setPrincipalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const principalRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (nextQuery = query) => {
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
          setPaidAccess({ state: "eligibility_required", eligibilityStatus: "not_started" });
        }
        if (!browserSession) {
          setPrincipalId(null);
          setSignedOut(true);
          return;
        }
        setPrincipalId(browserSession.principalId);
        const fetchWithSignal: typeof fetch = (input, init) => fetch(input, { ...init, signal: controller.signal });
        const [publicQueue, privateQueue] = await loadAnswerQueues(nextQuery, "all", fetchWithSignal);
        if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
        setTasks((publicQueue.body.tasks ?? []) as PublicAnswerTask[]);
        setAssignments((privateQueue.body.assignments ?? []) as PrivateAnswerAssignment[]);
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
        else setError(cause instanceof Error ? cause.message : "Unable to load the Answer queue.");
      } finally {
        if (!controller.signal.aborted && generation === loadGenerationRef.current) setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    setScope(initialScope);
    void load(initialQuery);
  }, [initialQuery, initialScope, load]);

  useEffect(() => subscribeToBrowserAuthSessionChanges(() => void load()), [load]);

  function changeScope(nextScope: VisibleScope) {
    setScope(nextScope);
    router.push(`${pathname}?q=${encodeURIComponent(query)}&scope=${nextScope}`);
  }

  const showScopeControls = !loading && tasks.length > 0 && assignments.length > 0;

  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-4">
      <h1 className="sr-only">Review work</h1>
      <div className="flex flex-wrap items-center gap-2">
        {showScopeControls ? (
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Review sources">
            {(["all", "public", "private"] as const).map(value => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={scope === value}
                onClick={() => changeScope(value)}
                className={`tab-control px-4 py-1.5 text-base font-medium capitalize transition-colors ${
                  scope === value ? "pill-active" : "pill-inactive"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        ) : null}
        {query ? (
          <span className="surface-card-nested ml-auto rounded-lg px-3 py-2 text-sm text-base-content/65">
            Results for <strong className="font-medium text-base-content">&quot;{query}&quot;</strong>
          </span>
        ) : null}
      </div>

      <div className="space-y-4">
        <AsyncSection loading={loading} loadingLabel="Loading review work">
          {null}
        </AsyncSection>
        {!loading && !signedOut && scope !== "public"
          ? assignments.map(assignment => (
              <PrivateAssignmentCard key={assignment.assignmentId} assignment={assignment} />
            ))
          : null}
        {!loading && !signedOut && principalId && scope !== "private"
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
            description="Review work is available to eligible, signed-in RateLoop humans."
            headingLevel={2}
            layout="embedded"
            preview={<HumanReviewExample />}
            title="Sign in to discover review work"
            titleId="human-discover-sign-in-title"
          />
        ) : null}
        {!loading && !signedOut && !error && tasks.length === 0 && assignments.length === 0 ? (
          <div className="surface-card flex min-h-48 flex-col items-center justify-center gap-4 rounded-lg p-6 text-center">
            <p className="text-base text-base-content/60">No review work is available right now.</p>
            <button type="button" className="btn btn-sm rateloop-secondary-action" onClick={() => void load()}>
              Check again
            </button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg bg-red-400/10 p-4 text-sm text-red-100">
            {error}
          </p>
        ) : null}
      </div>
    </AppPageShell>
  );
}
