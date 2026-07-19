import type { Metadata } from "next";
import { WorkspacePlanCards } from "~~/components/pricing/WorkspacePlanCards";
import { InfoPopover } from "~~/components/tokenless/InfoPopover";
import { TOKENLESS_BILLING_PLANS, formatUsdPrice } from "~~/lib/billing/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple workspace pricing for auditable human assurance of AI work.",
};

export const dynamic = "force-dynamic";

export default function PricingPage() {
  const subscriptionsEnabled = process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED === "true";
  const earlyAccessPrice = formatUsdPrice(TOKENLESS_BILLING_PLANS.early_access.monthlyPriceCents);

  return (
    <div className="flex grow flex-col items-center px-4 pb-20 pt-12 sm:pt-16 lg:pt-20">
      <div className="w-full max-w-6xl">
        <header className="max-w-4xl">
          <p className="font-mono text-sm uppercase tracking-[0.22em] text-[var(--rateloop-blue)]">Pricing</p>
          <h1 className="hero-headline mt-5 text-[3.25rem] leading-[0.95] text-base-content sm:text-[4.6rem] lg:text-[5.4rem]">
            Start free. <span className="rateloop-text-gradient">Scale when you need it.</span>
          </h1>
          <p className="mt-7 max-w-3xl text-lg leading-8 text-base-content/65 sm:text-xl">
            Workspace plans cover RateLoop decisions. Paid reviewer costs are separate.
          </p>
        </header>

        <section aria-labelledby="plans-heading" className="mt-14 sm:mt-20">
          <h2 id="plans-heading" className="sr-only">
            Workspace plans
          </h2>
          <div className="mb-6 rounded-xl border border-[var(--rateloop-green)]/25 bg-[var(--rateloop-green)]/5 px-5 py-4 text-sm leading-6 text-base-content/70">
            <strong className="text-base-content">Early Access terms:</strong> {earlyAccessPrice} per workspace each
            month for the first 12 months. We give at least 60 days&apos; notice before a later price change; founding
            customers then receive 20% off the comparable monthly plan and may cancel before the new price applies.
          </div>
          <WorkspacePlanCards subscriptionsEnabled={subscriptionsEnabled} />
        </section>

        <section className="surface-card mt-16 grid gap-8 rounded-2xl p-7 sm:p-9 lg:grid-cols-2">
          <article>
            <h2 className="text-2xl font-semibold">What counts as a decision?</h2>
            <p className="mt-3 text-base leading-7 text-base-content/60">
              One case that reaches an authorized terminal human result. Drafts and failed or cancelled cases do not
              count, and there are no automatic overage charges.
            </p>
          </article>
          <article>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-semibold">Paid panels</h2>
              <InfoPopover label="Explain paid panel costs">
                The bounty pays accepted reviewer work. The attempt reserve covers valid assigned attempts, including
                rounds that do not reach quorum. RateLoop&apos;s execution fee is capped at 7.5%.
              </InfoPopover>
            </div>
            <p className="mt-3 text-base leading-7 text-base-content/60">
              Bounty, attempt reserve, and execution fee are itemized before funding and are not included in the{" "}
              {earlyAccessPrice} subscription.
            </p>
          </article>
        </section>
      </div>
    </div>
  );
}
