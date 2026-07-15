import Link from "next/link";
import type { Metadata } from "next";
import { InfoPopover } from "~~/components/tokenless/InfoPopover";

export const metadata: Metadata = {
  title: "Pricing | RateLoop",
  description: "Simple workspace pricing for auditable human assurance of AI work.",
};

export const dynamic = "force-dynamic";

const plans = [
  {
    name: "Free",
    price: "$0",
    detail: "No card required",
    accent: "var(--rateloop-blue)",
    features: [
      "25 completed review decisions each calendar month",
      "1 active agent",
      "1 active private group",
      "Unpaid reviews with your own invited reviewers",
    ],
    cta: "Start free",
    href: "/agents?tab=overview",
  },
  {
    name: "Early Access",
    price: "$99",
    detail: "per workspace / month",
    accent: "var(--rateloop-green)",
    features: [
      "250 completed review decisions each subscription period",
      "3 active agents",
      "5 active private groups",
      "Unlimited invited reviewers",
      "$99 price for the first 12 months",
    ],
    cta: "Choose Early Access",
    href: "/agents?tab=overview&billing=upgrade",
  },
] as const;

export default function PricingPage() {
  const subscriptionsEnabled = process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED === "true";

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
          <div className="grid gap-5 lg:grid-cols-2">
            {plans.map(plan => {
              const isPaid = plan.name === "Early Access";
              const href =
                isPaid && !subscriptionsEnabled
                  ? "mailto:hawigxyz@proton.me?subject=RateLoop%20Early%20Access"
                  : plan.href;
              const cta = isPaid && !subscriptionsEnabled ? "Join Early Access" : plan.cta;

              return (
                <article
                  key={plan.name}
                  className="surface-card relative flex min-h-[28rem] flex-col overflow-hidden rounded-2xl p-7 sm:p-9"
                >
                  <div className="absolute inset-x-0 top-0 h-1" style={{ background: plan.accent }} />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-2xl font-semibold">{plan.name}</h2>
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
                      className={`min-h-12 w-full justify-center px-5 ${isPaid ? "rateloop-gradient-action" : "btn rounded-lg border border-base-content/15 bg-base-content/[0.07] hover:bg-base-content/[0.12]"}`}
                    >
                      {cta}
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
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
              Bounty, attempt reserve, and execution fee are itemized before funding and are not included in the $99
              subscription.
            </p>
          </article>
          <details className="lg:col-span-2">
            <summary className="cursor-pointer text-sm font-semibold text-base-content/70">Early Access terms</summary>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-base-content/55">
              The $99 price applies for 12 months. RateLoop gives at least 60 days&apos; notice before a later price
              change; founding customers then receive 20% off the comparable monthly plan and may cancel before the new
              price takes effect.
            </p>
          </details>
        </section>
      </div>
    </div>
  );
}
