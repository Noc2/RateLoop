import Link from "next/link";
import type { Metadata } from "next";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { SiteSearchResults } from "~~/components/tokenless/navigation/SiteSearchResults";

export const metadata: Metadata = {
  title: "Search",
  description: "Search RateLoop tasks, pages, documentation, and review work.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const params = await searchParams;
  const query = (first(params.q) ?? "").trim().slice(0, 120);

  return (
    <AppPageShell outerClassName="pb-8" contentClassName="pt-6 sm:pt-10">
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
          <section aria-labelledby="review-work-heading" className="mt-10">
            <div className="flex items-center justify-between gap-4">
              <h2 id="review-work-heading" className="text-xl font-semibold text-base-content">
                Review work
              </h2>
              <span className="font-mono text-xs text-base-content/55">1 destination</span>
            </div>
            <Link
              href={`/human/review?q=${encodeURIComponent(query)}`}
              prefetch={false}
              className="surface-card group mt-4 block rounded-xl px-4 py-3 transition-colors hover:border-base-content/20 hover:bg-base-content/[0.04]"
            >
              <h3 className="font-semibold text-base-content transition-colors group-hover:text-[var(--rateloop-blue)]">
                Search review work for &quot;{query}&quot;
              </h3>
              <p className="mt-1 text-sm leading-6 text-base-content/60">
                Open the full review queue with this search applied.
              </p>
            </Link>
          </section>
        </>
      ) : (
        <p className="surface-card mt-8 rounded-xl p-5 text-sm text-base-content/60">
          Enter a search in the navigation, then press Enter or choose Search.
        </p>
      )}
    </AppPageShell>
  );
}
