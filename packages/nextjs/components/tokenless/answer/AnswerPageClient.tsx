"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
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

const ThirdwebSessionButton = dynamic(
  () => import("~~/components/thirdweb/ThirdwebSessionButton").then(module => module.ThirdwebSessionButton),
  { ssr: false },
);

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
  const [error, setError] = useState<string | null>(null);

  async function load(nextQuery = query) {
    setLoading(true);
    setError(null);
    setSignedOut(false);
    try {
      const [publicQueue, privateQueue] = await loadAnswerQueues(nextQuery, "all");
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
      if (cause instanceof AnswerRequestError && cause.status === 401) setSignedOut(true);
      else setError(cause instanceof Error ? cause.message : "Unable to load the Answer queue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setScope(initialScope);
    void load(initialQuery);
    // The route owns initial query state; explicit user search owns subsequent refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, initialScope]);

  function changeScope(nextScope: VisibleScope) {
    setScope(nextScope);
    router.push(`${pathname}?q=${encodeURIComponent(query)}&scope=${nextScope}`);
  }

  const showScopeControls = !loading && tasks.length > 0 && assignments.length > 0;

  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-4">
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

      <main className="space-y-4">
        <AsyncSection loading={loading} loadingLabel="Loading review work">
          {null}
        </AsyncSection>
        {!loading && !signedOut && scope !== "public"
          ? assignments.map(assignment => (
              <PrivateAssignmentCard key={assignment.assignmentId} assignment={assignment} />
            ))
          : null}
        {!loading && !signedOut && scope !== "private"
          ? tasks.map(task => (
              <PublicQuestionCard
                key={task.roundId}
                task={task}
                paidAccess={paidAccess}
                onSubmitted={() => void load()}
              />
            ))
          : null}
        {!loading && signedOut ? (
          <section className="surface-card rounded-2xl p-6 text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Human access</p>
            <h2 className="mt-2 text-xl font-semibold">Sign in to discover review work</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-base-content/60">
              Review work is available to eligible, signed-in RateLoop humans.
            </p>
            <HumanReviewExample />
            <div className="mx-auto mt-5 max-w-xs">
              <ThirdwebSessionButton />
            </div>
          </section>
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
      </main>
    </AppPageShell>
  );
}
