import type { ReactNode } from "react";
import { LocalizedPublicContent } from "~~/components/docs/LocalizedPublicContent";
import { PublicLink as Link } from "~~/components/docs/PublicLink";
import { Card } from "~~/components/tokenless/ui/Card";
import type { Locale } from "~~/i18n/config";
import { TOKENLESS_BILLING_PLANS, TOKENLESS_HOSTED_REVIEW_COPY, formatUsdPrice } from "~~/lib/billing/plans";

type WorkspacePlanCardsProps = {
  subscriptionsEnabled: boolean;
  workspaceId?: string;
  /** Resolved by `resolveDemoBookingUrl`; null falls back to the enterprise mailto. */
  demoBookingUrl?: string | null;
  locale?: Locale;
};

const freePlan = TOKENLESS_BILLING_PLANS.free;
const earlyAccessPlan = TOKENLESS_BILLING_PLANS.early_access;
const earlyAccessListPrice = formatUsdPrice(earlyAccessPlan.listPriceCents ?? earlyAccessPlan.monthlyPriceCents);

function workspacePlanHref(workspaceId: string | undefined, billing?: "upgrade") {
  const query = new URLSearchParams();
  if (workspaceId) query.set("workspace", workspaceId);
  if (billing) query.set("billing", billing);
  const search = query.toString();
  return `/agents/billing${search ? `?${search}` : ""}`;
}

export function WorkspacePlanCards({
  subscriptionsEnabled,
  workspaceId,
  demoBookingUrl = null,
  locale = "en",
}: WorkspacePlanCardsProps) {
  const earlyAccessHref = subscriptionsEnabled
    ? workspacePlanHref(workspaceId, "upgrade")
    : "mailto:hawigxyz@proton.me?subject=RateLoop%20Early%20Access";
  const earlyAccessCta = subscriptionsEnabled ? "Choose Early Access" : "Join Early Access";

  return (
    <LocalizedPublicContent locale={locale} section="site">
      <div className="grid gap-5 lg:grid-cols-3">
        <PlanCard
          name={freePlan.displayName}
          accent="var(--rateloop-blue)"
          priceRow={
            <div className="mt-8 flex items-end gap-3">
              <span className="display-section text-6xl leading-none">
                {formatUsdPrice(freePlan.monthlyPriceCents)}
              </span>
              <span className="pb-1 text-sm text-base-content/50">No card required</span>
            </div>
          }
          features={[
            `${freePlan.decisionsPerPeriod} completed review decisions each calendar month`,
            `${freePlan.activeAgents} active agent`,
            TOKENLESS_HOSTED_REVIEW_COPY.planBenefit,
          ]}
          footer={
            <Link
              href={workspacePlanHref(workspaceId)}
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
            "Unlimited invited, unpaid reviewers",
            "First 12 months. Then 20% off the comparable plan; 60 days’ notice before changes. Cancel before they apply.",
          ]}
          footer={
            earlyAccessHref.startsWith("mailto:") ? (
              <a href={earlyAccessHref} className="rateloop-gradient-action min-h-12 w-full justify-center px-5">
                {earlyAccessCta}
              </a>
            ) : (
              <Link href={earlyAccessHref} className="rateloop-gradient-action min-h-12 w-full justify-center px-5">
                {earlyAccessCta}
              </Link>
            )
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
            "Evidence export support",
          ]}
          footer={
            demoBookingUrl ? (
              // The scheduler is a third-party page, so it leaves the app in a new tab rather than
              // being embedded: an embed would need its origin in the CSP and would set third-party
              // storage on page view.
              <a
                href={demoBookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rateloop-gradient-action min-h-12 w-full justify-center px-5"
              >
                Book demo
              </a>
            ) : (
              <a
                className="rateloop-gradient-action min-h-12 w-full justify-center px-5"
                href="mailto:hawigxyz@proton.me?subject=RateLoop%20Enterprise"
              >
                Request a demo
              </a>
            )
          }
        />
      </div>
    </LocalizedPublicContent>
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
    <Card as="article" className="relative flex min-h-[28rem] flex-col overflow-hidden rounded-2xl p-7 sm:p-9">
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
    </Card>
  );
}
