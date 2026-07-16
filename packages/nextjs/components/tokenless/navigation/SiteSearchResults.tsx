import Link from "next/link";
import { searchSite } from "~~/lib/search/siteSearch";

export function SiteSearchResults({ query }: { query: string }) {
  const results = searchSite(query);

  return (
    <section aria-labelledby="site-results-heading" className="mt-8">
      <div className="flex items-center justify-between gap-4">
        <h2 id="site-results-heading" className="text-xl font-semibold text-base-content">
          Pages and docs
        </h2>
        <span className="font-mono text-xs text-base-content/45">
          {results.length} {results.length === 1 ? "result" : "results"}
        </span>
      </div>
      {results.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {results.map(result => (
            <Link
              key={result.href}
              href={result.href}
              prefetch={false}
              className="surface-card group rounded-xl p-5 transition-colors hover:border-base-content/20 hover:bg-base-content/[0.04]"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-base-content transition-colors group-hover:text-[var(--rateloop-blue)]">
                  {result.title}
                </h3>
                <span className="shrink-0 rounded-full bg-base-content/[0.08] px-2 py-1 font-mono text-[0.65rem] uppercase tracking-wider text-base-content/55">
                  {result.area}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-base-content/60">{result.description}</p>
            </Link>
          ))}
        </div>
      ) : (
        <p className="surface-card mt-4 rounded-xl p-5 text-sm text-base-content/60">
          No pages or docs match &quot;{query}&quot;.
        </p>
      )}
    </section>
  );
}
