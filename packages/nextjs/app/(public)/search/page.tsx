import type { Metadata } from "next";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { AnswerPageClient } from "~~/components/tokenless/answer/AnswerPageClient";
import { SiteSearchResults } from "~~/components/tokenless/navigation/SiteSearchResults";

export const metadata: Metadata = {
  title: "Search | RateLoop",
  description: "Search RateLoop pages, documentation, and Discover review work.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; scope?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = (first(params.q) ?? "").trim().slice(0, 120);
  const requestedScope = first(params.scope);
  const scope = ["all", "public", "private"].includes(requestedScope ?? "")
    ? (requestedScope as "all" | "public" | "private")
    : "all";

  return (
    <>
      <AppPageShell outerClassName="pb-2" contentClassName="pt-6 sm:pt-10">
        <header>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--rateloop-blue)]">Search</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-base-content sm:text-4xl">
            {query ? (
              <>
                Results for <span className="rateloop-text-gradient">&quot;{query}&quot;</span>
              </>
            ) : (
              "Search RateLoop"
            )}
          </h1>
        </header>

        {query ? (
          <>
            <SiteSearchResults query={query} />
            <div className="mt-10 border-t border-base-content/10 pt-8">
              <h2 className="text-xl font-semibold text-base-content">Discover</h2>
              <p className="mt-1 text-sm text-base-content/55">Questions and review work matching this search.</p>
            </div>
          </>
        ) : (
          <p className="surface-card mt-8 rounded-xl p-5 text-sm text-base-content/60">
            Use the search field in the navigation to find pages, docs, and Discover questions.
          </p>
        )}
      </AppPageShell>

      {query ? <AnswerPageClient initialQuery={query} initialScope={scope} /> : null}
    </>
  );
}
