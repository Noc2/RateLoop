import type { ReactNode } from "react";
import Link from "next/link";
import { TOKENLESS_BILLING_PLANS, formatUsdPrice } from "~~/lib/billing/plans";

type WorkspacePlanCardsProps = {
  subscriptionsEnabled: boolean;
};

const freePlan = TOKENLESS_BILLING_PLANS.free;
const earlyAccessPlan = TOKENLESS_BILLING_PLANS.early_access;
const earlyAccessListPrice = formatUsdPrice(earlyAccessPlan.listPriceCents ?? earlyAccessPlan.monthlyPriceCents);

export function WorkspacePlanCards({ subscriptionsEnabled }: WorkspacePlanCardsProps) {
  const earlyAccessHref = subscriptionsEnabled
    ? "/agents?tab=overview&billing=upgrade"
    : "mailto:hawigxyz@proton.me?subject=RateLoop%20Early%20Access";
  const earlyAccessCta = subscriptionsEnabled ? "Choose Early Access" : "Join Early Access";

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <PlanCard
        name={freePlan.displayName}
        accent="var(--rateloop-blue)"
        priceRow={
          <div className="mt-8 flex items-end gap-3">
            <span className="display-section text-6xl leading-none">{formatUsdPrice(freePlan.monthlyPriceCents)}</span>
            <span className="pb-1 text-sm text-base-content/50">No card required</span>
          </div>
        }
        features={[
          `${freePlan.decisionsPerPeriod} completed review decisions each calendar month`,
          `${freePlan.activeAgents} active agent`,
          "Unpaid reviews with workspace reviewers",
        ]}
        footer={
          <Link
            href="/agents?tab=overview"
            className="btn rateloop-secondary-action min-h-12 w-full justify-center px-5"
          >
            Start free
          </Link>
        }
      />
      <PlanCard
        name={earlyAccessPlan.displayName}
        accent="var(--rateloop-green)"
        badge="Early Access price"
        priceRow={
          <div className="mt-8 flex items-end gap-3">
            <span className="display-section text-6xl leading-none">
              {formatUsdPrice(earlyAccessPlan.monthlyPriceCents)}
            </span>
            <span className="flex flex-col pb-1 text-sm text-base-content/50">
              <s className="text-base-content/40">{earlyAccessListPrice}</s>
              <span>per workspace/month</span>
            </span>
          </div>
        }
        features={[
          `${earlyAccessPlan.decisionsPerPeriod} completed review decisions each subscription period`,
          `${earlyAccessPlan.activeAgents} active agents`,
          "Unlimited invited reviewers",
          `Then ${earlyAccessListPrice}/month after 12 months`,
        ]}
        footer={
          <Link href={earlyAccessHref} className="rateloop-gradient-action min-h-12 w-full justify-center px-5">
            {earlyAccessCta}
          </Link>
        }
      />
      <PlanCard
        name="Enterprise"
        accent="var(--rateloop-pink)"
        priceRow={
          <div className="mt-8 flex items-end gap-3">
            <span className="display-section text-6xl leading-none">Custom</span>
          </div>
        }
        features={[
          "Everything in Early Access",
          "Custom volumes and terms",
          "Custom integrations",
          "Compliance solutions",
        ]}
        footer={
          <Link
            href="mailto:hawigxyz@proton.me?subject=RateLoop%20Enterprise"
            className="btn rateloop-secondary-action min-h-12 w-full justify-center px-5"
          >
            Book demo
          </Link>
        }
      />
    </div>
  );
}

function PlanCard({
  name,
  accent,
  badge,
  priceRow,
  features,
  footer,
}: {
  name: string;
  accent: string;
  badge?: string;
  priceRow: ReactNode;
  features: readonly string[];
  footer: ReactNode;
}) {
  return (
    <article className="surface-card relative flex min-h-[28rem] flex-col overflow-hidden rounded-2xl p-7 sm:p-9">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-2xl font-semibold">{name}</h3>
        {badge ? (
          <span className="rounded-full border border-[var(--rateloop-green)]/40 bg-[var(--rateloop-green)]/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-[var(--rateloop-green)]">
            {badge}
          </span>
        ) : null}
      </div>
      {priceRow}
      <ul className="mt-9 space-y-4 text-base leading-7 text-base-content/70">
        {features.map(feature => (
          <li key={feature} className="flex gap-3">
            <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-8">{footer}</div>
    </article>
  );
}
