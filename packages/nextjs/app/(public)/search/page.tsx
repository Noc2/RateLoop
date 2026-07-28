import { cookies } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { AuthorizedSiteSearchResults } from "~~/components/tokenless/navigation/AuthorizedSiteSearchResults";
import { SiteSearchResults } from "~~/components/tokenless/navigation/SiteSearchResults";
import { Card } from "~~/components/tokenless/ui/Card";
import { PageHeading } from "~~/components/tokenless/ui/PageHeading";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { type AuthorizedSiteSearchResult, searchAuthorizedSiteData } from "~~/lib/search/authorizedSiteSearch";

export const metadata: Metadata = {
  title: "Search",
  description: "Search RateLoop tasks, pages, documentation, and review work.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function SearchPageContent({
  authorizedResults,
  query,
}: {
  authorizedResults: readonly AuthorizedSiteSearchResult[];
  query: string;
}) {
  return (
    <AppPageShell outerClassName="pb-8" contentClassName="pt-6 sm:pt-10">
      <PageHeading
        accent="blue"
        heading={
          query ? (
            <>
              Results for <span className="rateloop-text-gradient">&quot;{query}&quot;</span>
            </>
          ) : (
            "Search RateLoop"
          )
        }
      />

      {query ? (
        <>
          <AuthorizedSiteSearchResults results={authorizedResults} />
          <SiteSearchResults query={query} />
          <section aria-labelledby="review-work-heading" className="mt-10">
            <div className="flex items-center justify-between gap-4">
              <h2 id="review-work-heading" className="text-xl font-semibold text-base-content">
                Review work
              </h2>
              <span className="font-mono text-xs text-base-content/55">1 destination</span>
            </div>
            <Card
              as={Link}
              href={`/human/review?q=${encodeURIComponent(query)}`}
              prefetch={false}
              className="group mt-4 block rounded-xl px-4 py-3 transition-colors hover:border-base-content/20 hover:bg-base-content/[0.04]"
            >
              <h3 className="font-semibold text-base-content transition-colors group-hover:text-[var(--rateloop-blue)]">
                Search review work for &quot;{query}&quot;
              </h3>
              <p className="mt-1 text-sm leading-6 text-base-content/60">
                Open the full review queue with this search applied.
              </p>
            </Card>
          </section>
        </>
      ) : (
        <Card as="p" className="mt-8 rounded-xl p-5 text-sm text-base-content/60">
          Enter a search in the navigation, then press Enter or choose Search.
        </Card>
      )}
    </AppPageShell>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const params = await searchParams;
  const query = (first(params.q) ?? "").trim().slice(0, 120);
  const session = query ? await findAuthSession((await cookies()).get(AUTH_SESSION_COOKIE)?.value) : null;
  const authorizedResults = session
    ? await searchAuthorizedSiteData({ accountAddress: session.principalId, query })
    : [];

  return <SearchPageContent authorizedResults={authorizedResults} query={query} />;
}
