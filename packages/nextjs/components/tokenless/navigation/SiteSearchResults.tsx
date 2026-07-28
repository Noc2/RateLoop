import Link from "next/link";
import { searchSite } from "~~/lib/search/siteSearch";

export function SiteSearchResults({ query }: { query: string }) {
  const results = searchSite(query);
  const taskResults = results.filter(result => result.area === "Task");
  const pageResults = results.filter(result => result.area !== "Task");
  const groups = [
    { title: "Tasks", results: taskResults },
    { title: "Pages and docs", results: pageResults },
  ].filter(group => group.results.length > 0);

  return (
    <section aria-labelledby="site-results-heading" className="mt-8">
      <div className="flex items-center justify-between gap-4">
        <h2 id="site-results-heading" className="text-xl font-semibold text-base-content">
          RateLoop
        </h2>
        <span className="font-mono text-xs text-base-content/55">
          {results.length} {results.length === 1 ? "result" : "results"}
        </span>
      </div>
      {results.length ? (
        <div className="mt-5 space-y-7">
          {groups.map(group => (
            <section key={group.title} aria-labelledby={`search-${group.title.toLowerCase().replaceAll(" ", "-")}`}>
              <div className="flex items-center justify-between gap-4">
                <h3
                  id={`search-${group.title.toLowerCase().replaceAll(" ", "-")}`}
                  className="text-sm font-semibold text-base-content"
                >
                  {group.title}
                </h3>
                <span className="font-mono text-[0.7rem] text-base-content/60">{group.results.length}</span>
              </div>
              <div className="mt-2 space-y-2">
                {group.results.map(result => (
                  <Link
                    key={`${result.area}-${result.href}-${result.title}`}
                    href={result.href}
                    prefetch={false}
                    className="surface-card group block rounded-xl px-4 py-3 transition-colors hover:border-base-content/20 hover:bg-base-content/[0.04]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-semibold text-base-content transition-colors group-hover:text-[var(--rateloop-blue)]">
                        {result.title}
                      </h4>
                      <span className="shrink-0 rounded-full bg-base-content/[0.08] px-2 py-1 font-mono text-[0.65rem] uppercase tracking-wider text-base-content/55">
                        {result.area}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-base-content/60">{result.description}</p>
                  </Link>
                ))}
              </div>
            </section>
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
