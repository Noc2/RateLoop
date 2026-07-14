"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import {
  type PrivateAnswerAssignment,
  PrivateAssignmentCard,
} from "~~/components/tokenless/answer/PrivateAssignmentCard";
import { type PublicAnswerTask, PublicQuestionCard } from "~~/components/tokenless/answer/PublicQuestionCard";

type Scope = "all" | "public" | "private" | "submitted";

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "Answer queue request failed.");
  return body;
}

export function AnswerPageClient({
  initialQuery = "",
  initialScope = "all",
  sandboxMode,
}: {
  initialQuery?: string;
  initialScope?: Scope;
  sandboxMode: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query] = useState(initialQuery);
  const [scope, setScope] = useState<Scope>(initialScope);
  const [tasks, setTasks] = useState<PublicAnswerTask[]>([]);
  const [assignments, setAssignments] = useState<PrivateAnswerAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(nextQuery = query, nextScope = scope) {
    setLoading(true);
    setError(null);
    try {
      const encodedQuery = encodeURIComponent(nextQuery);
      const [publicBody, privateBody] = await Promise.all([
        nextScope === "private" || nextScope === "submitted"
          ? Promise.resolve({ tasks: [] })
          : readJson(
              await fetch(`/api/rater/tasks?q=${encodedQuery}&scope=public`, {
                cache: "no-store",
                credentials: "same-origin",
              }),
            ),
        nextScope === "public" || nextScope === "submitted"
          ? Promise.resolve({ assignments: [] })
          : readJson(
              await fetch(`/api/account/assurance/assignments?q=${encodedQuery}`, {
                cache: "no-store",
                credentials: "same-origin",
              }),
            ),
      ]);
      setTasks((publicBody.tasks ?? []) as PublicAnswerTask[]);
      setAssignments((privateBody.assignments ?? []) as PrivateAnswerAssignment[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the Answer queue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(initialQuery, initialScope);
    // The route owns initial query state; explicit user search owns subsequent refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, initialScope]);

  function changeScope(nextScope: Scope) {
    setScope(nextScope);
    router.push(`${pathname}?q=${encodeURIComponent(query)}&scope=${nextScope}`);
    void load(query, nextScope);
  }

  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Answer scopes">
        {(["all", "public", "private", "submitted"] as const).map(value => (
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
        {query ? (
          <span className="surface-card-nested ml-auto rounded-lg px-3 py-2 text-sm text-base-content/65">
            Results for <strong className="font-medium text-base-content">&quot;{query}&quot;</strong>
          </span>
        ) : null}
      </div>

      <main className="space-y-4">
        {loading ? (
          <div className="surface-card rounded-lg p-6 text-sm text-base-content/55">
            <span className="loading loading-spinner loading-sm mr-2 text-primary" />
            Loading…
          </div>
        ) : null}
        {!loading && scope !== "private" && scope !== "submitted"
          ? tasks.map(task => (
              <PublicQuestionCard
                key={task.roundId}
                task={task}
                sandboxMode={sandboxMode}
                onSubmitted={() => void load()}
              />
            ))
          : null}
        {!loading && scope !== "public" && scope !== "submitted"
          ? assignments.map(assignment => (
              <PrivateAssignmentCard key={assignment.assignmentId} assignment={assignment} />
            ))
          : null}
        {!loading && scope === "submitted" ? (
          <div className="surface-card rounded-lg p-6 text-sm leading-6 text-base-content/55">
            Submitted history will appear here once public result history is exposed by the tokenless read model.
          </div>
        ) : null}
        {!loading && scope !== "submitted" && tasks.length === 0 && assignments.length === 0 ? (
          <div className="surface-card flex min-h-48 items-center justify-center rounded-lg p-6 text-center text-base text-base-content/55">
            No questions are available in this view yet.
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
