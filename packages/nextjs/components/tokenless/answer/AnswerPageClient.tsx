"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  const [query, setQuery] = useState(initialQuery);
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

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(`${pathname}?q=${encodeURIComponent(query)}&scope=${scope}`);
    void load(query, scope);
  }

  function changeScope(nextScope: Scope) {
    setScope(nextScope);
    router.push(`${pathname}?q=${encodeURIComponent(query)}&scope=${nextScope}`);
    void load(query, nextScope);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <div className="border-l-2 border-[var(--rateloop-green)] pl-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Answer queue</p>
        <h1 className="display-section mt-3 text-4xl sm:text-5xl">Make the call. Explain the difference.</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-base-content/60">
          Answer public questions or open private reviews assigned to this account. Paid eligibility is checked before
          paid voucher issuance.
        </p>
      </div>
      <form onSubmit={submitSearch} className="mt-8 flex gap-2">
        <label className="sr-only" htmlFor="answer-query">
          Search Answer
        </label>
        <input
          id="answer-query"
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="input grow border-white/10 bg-[var(--rateloop-field)]"
          placeholder="Search public questions or assigned project names"
        />
        <button type="submit" className="rateloop-gradient-action px-5">
          Search
        </button>
      </form>
      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Answer scopes">
        {(["all", "public", "private", "submitted"] as const).map(value => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={scope === value}
            onClick={() => changeScope(value)}
            className={`rounded-full border px-4 py-2 text-sm capitalize transition-colors ${scope === value ? "border-base-content bg-base-content font-semibold text-base-100" : "border-white/10 text-base-content/60 hover:border-white/25"}`}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="space-y-5">
          {loading ? (
            <div className="rateloop-surface-card p-6 text-sm text-base-content/55">Loading Answer queue…</div>
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
            <div className="rateloop-surface-card p-6 text-sm leading-6 text-base-content/55">
              Submitted history will appear here once public result history is exposed by the tokenless read model.
            </div>
          ) : null}
          {!loading && scope !== "submitted" && tasks.length === 0 && assignments.length === 0 ? (
            <div className="rateloop-surface-card p-6 text-sm leading-6 text-base-content/55">
              No answers match this view. Public questions appear after moderation and funding; private work appears
              only after a customer assigns it to this account.
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-lg bg-red-400/10 p-4 text-sm text-red-100">
              {error}
            </p>
          ) : null}
        </main>
        <aside className="rateloop-surface-card sticky top-24 h-fit p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">Answer safely</p>
          <h2 className="mt-2 text-xl font-semibold">Two queues, two boundaries</h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-base-content/60">
            <li>Public prompts never include confidential customer material.</li>
            <li>Private artifacts are released only after assignment terms and a short lease.</li>
            <li>Recovery packages are encrypted locally; RateLoop never receives your recovery secret.</li>
          </ul>
          <p className="mt-5 border-t border-white/10 pt-5 text-xs leading-5 text-base-content/45">
            {sandboxMode
              ? "Sandbox environment: simulated panels and test funds."
              : "Early access: review panel and network terms before answering."}
          </p>
        </aside>
      </div>
    </div>
  );
}
