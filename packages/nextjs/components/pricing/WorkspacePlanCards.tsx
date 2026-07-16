import Link from "next/link";
import { TOKENLESS_BILLING_PLANS, formatUsdPrice } from "~~/lib/billing/plans";

type WorkspacePlanCardsProps = {
  subscriptionsEnabled: boolean;
};

const freePlan = TOKENLESS_BILLING_PLANS.free;
const earlyAccessPlan = TOKENLESS_BILLING_PLANS.early_access;

const plans = [
  {
    name: freePlan.displayName,
    price: formatUsdPrice(freePlan.monthlyPriceCents),
    detail: "No card required",
    accent: "var(--rateloop-blue)",
    features: [
      `${freePlan.decisionsPerPeriod} completed review decisions each calendar month`,
      `${freePlan.activeAgents} active agent`,
      `${freePlan.activePrivateGroups} active private group`,
      "Unpaid reviews with your own invited reviewers",
    ],
    cta: "Start free",
    href: "/agents?tab=overview",
  },
  {
    name: earlyAccessPlan.displayName,
    price: formatUsdPrice(earlyAccessPlan.monthlyPriceCents),
    detail: "per workspace / month",
    accent: "var(--rateloop-green)",
    features: [
      `${earlyAccessPlan.decisionsPerPeriod} completed review decisions each subscription period`,
      `${earlyAccessPlan.activeAgents} active agents`,
      `${earlyAccessPlan.activePrivateGroups} active private groups`,
      "Unlimited invited reviewers",
      `${formatUsdPrice(earlyAccessPlan.monthlyPriceCents)} price for the first 12 months`,
    ],
    cta: "Choose Early Access",
    href: "/agents?tab=overview&billing=upgrade",
  },
] as const;

export function WorkspacePlanCards({ subscriptionsEnabled }: WorkspacePlanCardsProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {plans.map(plan => {
        const isPaid = plan.name === earlyAccessPlan.displayName;
        const href =
          isPaid && !subscriptionsEnabled ? "mailto:hawigxyz@proton.me?subject=RateLoop%20Early%20Access" : plan.href;
        const cta = isPaid && !subscriptionsEnabled ? "Join Early Access" : plan.cta;

        return (
          <article
            key={plan.name}
            className="surface-card relative flex min-h-[28rem] flex-col overflow-hidden rounded-2xl p-7 sm:p-9"
          >
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: plan.accent }} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-2xl font-semibold">{plan.name}</h3>
              {isPaid ? (
                <span className="rounded-full border border-[var(--rateloop-green)]/40 bg-[var(--rateloop-green)]/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-[var(--rateloop-green)]">
                  Early Access price
                </span>
              ) : null}
            </div>
            <div className="mt-8 flex items-end gap-3">
              <span className="display-section text-6xl leading-none">{plan.price}</span>
              <span className="pb-1 text-sm text-base-content/50">{plan.detail}</span>
            </div>
            <ul className="mt-9 space-y-4 text-base leading-7 text-base-content/70">
              {plan.features.map(feature => (
                <li key={feature} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: plan.accent }}
                  />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-8">
              <Link
                href={href}
                className={`min-h-12 w-full justify-center px-5 ${isPaid ? "rateloop-gradient-action" : "btn rateloop-secondary-action"}`}
              >
                {cta}
              </Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
