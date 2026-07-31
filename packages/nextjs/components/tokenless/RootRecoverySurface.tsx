import type { ReactNode } from "react";
import Link from "next/link";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { Card } from "~~/components/tokenless/ui/Card";
import { DEFAULT_LOCALE, type Locale } from "~~/i18n/config";
import { getMessagesForLocale } from "~~/i18n/messages";

const destinations = [
  { href: "/search", labelKey: "search" },
  { href: "/human/review", labelKey: "reviewWork" },
  { href: "/agents/overview", labelKey: "manageAgents" },
  { href: "/docs", labelKey: "readDocs" },
] as const;

export function RootRecoverySurface({
  eyebrow,
  title,
  description,
  actions,
  destinationLabels,
  locale = DEFAULT_LOCALE,
  navigationLabel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  destinationLabels?: Partial<Record<(typeof destinations)[number]["labelKey"], string>>;
  locale?: Locale;
  navigationLabel?: string;
}) {
  const recoveryMessages = getMessagesForLocale(locale).shared.recovery;
  return (
    <AppPageShell outerClassName="justify-center py-10 sm:py-16">
      <Card
        as="section"
        className="mx-auto w-full max-w-2xl rounded-2xl p-6 sm:p-9"
        aria-labelledby="root-recovery-heading"
      >
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--rateloop-pink)]">{eyebrow}</p>
        <h1 id="root-recovery-heading" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-base-content/65">{description}</p>

        {actions ? <div className="mt-6 flex flex-wrap gap-3">{actions}</div> : null}

        <nav
          className="mt-8 border-t border-base-content/10 pt-6"
          aria-label={navigationLabel ?? recoveryMessages.navigation}
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {destinations.map(destination => (
              <li key={destination.href}>
                <Link
                  href={locale === DEFAULT_LOCALE ? destination.href : `/${locale}${destination.href}`}
                  className="block rounded-lg border border-base-content/10 px-4 py-3 font-medium text-base-content/75 transition-colors hover:border-base-content/20 hover:bg-base-content/[0.04] hover:text-base-content"
                >
                  {destinationLabels?.[destination.labelKey] ?? recoveryMessages[destination.labelKey]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Card>
    </AppPageShell>
  );
}
