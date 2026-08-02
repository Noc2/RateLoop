import { LocalizedPublicContent } from "~~/components/docs/LocalizedPublicContent";
import { PublicLink as Link } from "~~/components/docs/PublicLink";
import { Card } from "~~/components/tokenless/ui/Card";
import type { Locale } from "~~/i18n/config";
import { TOKENLESS_BILLING_PLANS, TOKENLESS_HOSTED_REVIEW_COPY, formatUsdPrice } from "~~/lib/billing/plans";

const freePlan = TOKENLESS_BILLING_PLANS.free;
const earlyAccessPlan = TOKENLESS_BILLING_PLANS.early_access;

export function WorkspacePlanOverview({ locale = "en" }: { locale?: Locale }) {
  return (
    <LocalizedPublicContent locale={locale} section="site">
      <div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card as="article" variant="marketing" className="relative overflow-hidden rounded-2xl p-6 sm:p-7">
            <div className="absolute inset-x-0 top-0 h-1 bg-[var(--rateloop-blue)]" />
            <h3 className="text-xl font-semibold">{freePlan.displayName}</h3>
            <p className="mt-5 display-section text-5xl leading-none text-base-content">
              {formatUsdPrice(freePlan.monthlyPriceCents)}
            </p>
            <p className="mt-5 text-sm leading-6 text-base-content/65">
              {freePlan.decisionsPerPeriod} completed review decisions each calendar month
              <span aria-hidden="true"> · </span>
              {freePlan.activeAgents} active agent
            </p>
          </Card>

          <Card as="article" variant="marketing" className="relative overflow-hidden rounded-2xl p-6 sm:p-7">
            <div className="absolute inset-x-0 top-0 h-1 bg-[var(--rateloop-green)]" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xl font-semibold">{earlyAccessPlan.displayName}</h3>
              <span className="rounded-full border border-[var(--rateloop-green)]/40 bg-[var(--rateloop-green)]/10 px-2.5 py-1 font-mono text-[0.68rem] uppercase tracking-wider text-[var(--rateloop-green)]">
                First 12 months
              </span>
            </div>
            <div className="mt-5 flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="display-section text-5xl leading-none text-base-content">
                {formatUsdPrice(earlyAccessPlan.monthlyPriceCents)}
              </p>
              <p className="pb-0.5 text-sm text-base-content/55">per workspace/month</p>
            </div>
            <p className="mt-5 text-sm leading-6 text-base-content/65">
              {earlyAccessPlan.decisionsPerPeriod} completed review decisions each subscription period
              <span aria-hidden="true"> · </span>
              {earlyAccessPlan.activeAgents} active agents
            </p>
          </Card>

          <Card as="article" variant="marketing" className="relative overflow-hidden rounded-2xl p-6 sm:p-7">
            <div className="absolute inset-x-0 top-0 h-1 bg-[var(--rateloop-pink)]" />
            <h3 className="text-xl font-semibold">Enterprise</h3>
            <p className="mt-5 display-section text-5xl leading-none text-base-content">Custom</p>
            <p className="mt-5 text-sm leading-6 text-base-content/65">Custom volumes and terms</p>
          </Card>
        </div>

        <p className="mt-5 text-sm leading-6 text-base-content/60">{TOKENLESS_HOSTED_REVIEW_COPY.planSummary}</p>
        <div className="mt-6">
          <Link href="/pricing" className="btn rateloop-secondary-action min-h-11 px-5">
            Compare plans
          </Link>
        </div>
      </div>
    </LocalizedPublicContent>
  );
}
