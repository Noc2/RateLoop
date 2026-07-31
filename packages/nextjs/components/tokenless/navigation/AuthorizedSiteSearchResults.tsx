import { translatePublicString } from "~~/components/docs/LocalizedPublicContent";
import { PublicLink as Link } from "~~/components/docs/PublicLink";
import { Card } from "~~/components/tokenless/ui/Card";
import type { Locale } from "~~/i18n/config";
import type { AuthorizedSiteSearchResult } from "~~/lib/search/authorizedSiteSearch";

export function AuthorizedSiteSearchResults({
  locale = "en",
  results,
}: {
  locale?: Locale;
  results: readonly AuthorizedSiteSearchResult[];
}) {
  if (results.length === 0) return null;
  const t = (value: string) => translatePublicString(value, locale, "site");

  return (
    <section aria-labelledby="authorized-results-heading" className="mt-8">
      <div className="flex items-center justify-between gap-4">
        <h2 id="authorized-results-heading" className="text-xl font-semibold text-base-content">
          {t("Your workspace data")}
        </h2>
        <span className="font-mono text-xs text-base-content/55">
          {results.length} {results.length === 1 ? t("result") : t("results")}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {results.map(result => (
          <Card
            as={Link}
            key={`${result.area}-${result.href}`}
            href={result.href}
            prefetch={false}
            className="group block rounded-xl px-4 py-3 transition-colors hover:border-base-content/20 hover:bg-base-content/[0.04]"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-base-content transition-colors group-hover:text-[var(--rateloop-blue)]">
                {result.title}
              </h3>
              <span className="shrink-0 rounded-full bg-base-content/[0.08] px-2 py-1 font-mono text-[0.65rem] uppercase tracking-wider text-base-content/55">
                {t(result.area)}
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-base-content/60">{result.description}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
