import { cookies } from "next/headers";
import type { Metadata } from "next";
import {
  LocalizedPublicContent,
  resolvePublicLocale,
  translatePublicString,
} from "~~/components/docs/LocalizedPublicContent";
import { PublicLink as Link } from "~~/components/docs/PublicLink";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { AuthorizedSiteSearchResults } from "~~/components/tokenless/navigation/AuthorizedSiteSearchResults";
import { SiteSearchResults } from "~~/components/tokenless/navigation/SiteSearchResults";
import { Card } from "~~/components/tokenless/ui/Card";
import { PageHeading } from "~~/components/tokenless/ui/PageHeading";
import type { Locale } from "~~/i18n/config";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { type AuthorizedSiteSearchResult, searchAuthorizedSiteData } from "~~/lib/search/authorizedSiteSearch";

export async function generateMetadata({ params }: { params: Promise<{ locale?: string }> }): Promise<Metadata> {
  const locale = await resolvePublicLocale(params);
  return {
    title: translatePublicString("Search", locale, "site"),
    description: translatePublicString("Search RateLoop tasks, pages, documentation, and review work.", locale, "site"),
  };
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function SearchPageContent({
  authorizedResults,
  locale = "en",
  query,
}: {
  authorizedResults: readonly AuthorizedSiteSearchResult[];
  locale?: Locale;
  query: string;
}) {
  return (
    <LocalizedPublicContent locale={locale} section="site">
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
            <AuthorizedSiteSearchResults locale={locale} results={authorizedResults} />
            <SiteSearchResults locale={locale} query={query} excludeHrefs={["/human/review"]} />
            <Card
              as={Link}
              aria-label={`Search review work for "${query}"`}
              href={`/human/review?q=${encodeURIComponent(query)}`}
              prefetch={false}
              className="group mt-10 block rounded-xl px-4 py-3 transition-colors hover:border-base-content/20 hover:bg-base-content/[0.04]"
            >
              <h2 className="font-semibold text-base-content transition-colors group-hover:text-[var(--rateloop-blue)]">
                Review work
              </h2>
            </Card>
          </>
        ) : (
          <Card as="p" className="mt-8 rounded-xl p-5 text-sm text-base-content/60">
            Enter a search in the navigation, then press Enter or choose Search.
          </Card>
        )}
      </AppPageShell>
    </LocalizedPublicContent>
  );
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params?: Promise<{ locale?: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const locale = await resolvePublicLocale(params);
  const resolvedSearchParams = await searchParams;
  const query = (first(resolvedSearchParams.q) ?? "").trim().slice(0, 120);
  const session = query ? await findAuthSession((await cookies()).get(AUTH_SESSION_COOKIE)?.value) : null;
  const authorizedResults = session
    ? await searchAuthorizedSiteData({ accountAddress: session.principalId, query })
    : [];

  return <SearchPageContent authorizedResults={authorizedResults} locale={locale} query={query} />;
}
