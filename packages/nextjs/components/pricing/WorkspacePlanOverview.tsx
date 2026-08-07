import { LocalizedPublicContent, translatePublicString } from "~~/components/docs/LocalizedPublicContent";
import { PublicLink as Link } from "~~/components/docs/PublicLink";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import type { Locale } from "~~/i18n/config";
import {
  TOKENLESS_BILLING_PLANS,
  TOKENLESS_HOSTED_REVIEW_COPY,
  activeAgentLimitLabel,
  privateGroupLimitLabel,
} from "~~/lib/billing/plans";
import { FOUNDING_PILOT, SANDBOX_PRICE_CENTS, formatEurPrice } from "~~/lib/marketing/foundingPilot";

const freePlan = TOKENLESS_BILLING_PLANS.free;

export function WorkspacePlanOverview({ locale = "en" }: { locale?: Locale }) {
  const copy = (source: string) => translatePublicString(source, locale, "site");
  return (
    <LocalizedPublicContent locale={locale} section="site">
      <div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card as="article" variant="marketing" className="relative overflow-hidden rounded-2xl p-6 sm:p-7">
            <div className="absolute inset-x-0 top-0 h-1 bg-[var(--rateloop-blue)]" />
            <h3 className="text-xl font-semibold">{copy("Sandbox")}</h3>
            <p className="mt-5 display-section text-5xl leading-none text-base-content">
              {formatEurPrice(SANDBOX_PRICE_CENTS, locale)}
            </p>
            <p className="mt-5 text-sm leading-6 text-base-content/65">
              {copy(activeAgentLimitLabel(freePlan.activeAgents))}
              <span aria-hidden="true"> · </span>
              {copy(privateGroupLimitLabel(freePlan.activePrivateGroups))}
            </p>
          </Card>

          <Card as="article" variant="marketing" className="relative overflow-hidden rounded-2xl p-6 sm:p-7">
            <div className="absolute inset-x-0 top-0 h-1 bg-[var(--rateloop-green)]" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xl font-semibold">{copy("Founding Pilot")}</h3>
              <span className="rounded-full border border-[var(--rateloop-green)]/40 bg-[var(--rateloop-green)]/10 px-2.5 py-1 font-mono text-[0.68rem] uppercase tracking-wider text-[var(--rateloop-green)]">
                {copy("Founding offer")}
              </span>
            </div>
            <div className="mt-5 flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="display-section text-5xl leading-none text-base-content">
                {formatEurPrice(FOUNDING_PILOT.priceCents, locale)}
              </p>
              <p className="pb-0.5 text-sm text-base-content/55">{copy("one-time, net")}</p>
            </div>
            <p className="mt-5 text-sm leading-6 text-base-content/65">
              {copy("6-week structured pilot · 50% creditable")}
            </p>
          </Card>
        </div>

        <p className="mt-3 text-sm leading-6 text-base-content/60">{copy("All prices net of 19% VAT.")}</p>

        <p className="mt-5 text-sm leading-6 text-base-content/60">{TOKENLESS_HOSTED_REVIEW_COPY.planSummary}</p>
        <div className="mt-6">
          <Button as={Link} variant="secondary" size="none" className="min-h-11 px-5" href="/pricing">
            Compare plans
          </Button>
        </div>
      </div>
    </LocalizedPublicContent>
  );
}
