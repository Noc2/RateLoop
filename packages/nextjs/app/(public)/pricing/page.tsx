import Link from "next/link";
import type { Metadata } from "next";

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
      "Paid and public panels when production-ready",
    ],
    cta: "Choose Early Access",
    href: "/agents?tab=overview&billing=upgrade",
  },
] as const;

const questions = [
  ["Do I need a card for Free?", "No. Create a workspace and begin with your own reviewers without adding a card."],
  [
    "What is a review decision?",
    "One frozen case or agent output that reaches an authorized terminal human result. Multiple responses on the same case still count as one decision.",
  ],
  [
    "When does usage reset?",
    "Free usage resets at the start of each UTC calendar month. Early Access usage follows the workspace subscription period. Unused decisions do not roll over.",
  ],
  [
    "Are reviewer payments included?",
    "No. Public-network bounty, attempt reserve, and the 7.5% execution fee are separate panel costs. Private reviews with your own invited people can remain unpaid.",
  ],
  [
    "What happens when I cancel or downgrade?",
    "Early Access remains available through the paid period. Existing evidence stays readable and accepted work can finish, but new work must fit the Free limits after downgrade.",
  ],
  [
    "How are taxes handled?",
    "The subscription is sold to approved business customers. Tax and VAT details are collected during checkout and shown on the applicable invoice.",
  ],
] as const;

export default function PricingPage() {
  const subscriptionsEnabled = process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED === "true";

  return (
    <div className="flex grow flex-col items-center px-4 pb-20 pt-12 sm:pt-16 lg:pt-20">
      <div className="w-full max-w-6xl">
        <header className="max-w-4xl">
          <p className="font-mono text-sm uppercase tracking-[0.22em] text-[var(--rateloop-blue)]">Simple pricing</p>
          <h1 className="hero-headline mt-5 text-[3.25rem] leading-[0.95] text-base-content sm:text-[4.6rem] lg:text-[5.4rem]">
            Start with your own reviewers. <span className="rateloop-text-gradient">Add paid human supply</span> when
            you need it.
          </h1>
          <p className="mt-7 max-w-3xl text-lg leading-8 text-base-content/65 sm:text-xl">
            The subscription pays for RateLoop&apos;s assurance workspace. Human rewards and public-panel execution stay
            separate, so private teams are not forced through a USDC transaction.
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
                  className="surface-card relative flex min-h-[31rem] flex-col overflow-hidden rounded-2xl p-7 sm:p-9"
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

        <section className="mt-16 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="surface-card rounded-2xl p-7 sm:p-9">
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-yellow)]">
              Usage, without surprise overages
            </p>
            <h2 className="mt-4 text-3xl font-semibold">One completed case is one decision.</h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-base-content/60">
              Drafts, rejected requests, polling, API calls, and failed or cancelled cases do not count. RateLoop
              reserves capacity when a run is frozen so concurrent work cannot silently exceed the plan. At the limit,
              new runs pause; there is no automatic overage charge.
            </p>
          </article>
          <article className="surface-card rounded-2xl border-l-2 border-[var(--rateloop-pink)] p-7 sm:p-9">
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">
              Paid panels are separate
            </p>
            <h2 className="mt-4 text-3xl font-semibold">Fund people, not a vague bundle.</h2>
            <p className="mt-4 text-base leading-7 text-base-content/60">
              Public-network work itemizes participant bounty, attempt reserve, and RateLoop&apos;s 7.5% execution fee
              before funding. Those USDC amounts are not included in the $99 subscription.
            </p>
          </article>
        </section>

        <section className="mt-16 rounded-2xl border border-white/10 bg-base-content/[0.03] p-7 sm:p-9">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">
            Founding customer treatment
          </p>
          <p className="mt-4 max-w-4xl text-lg leading-8 text-base-content/70">
            The $99 Early Access price applies for the first 12 months. RateLoop gives at least 60 days&apos; notice
            before a later price change; after the first year, founding customers receive 20% off the then-current
            comparable monthly plan. There is no lifetime grandfathering, and you can cancel before a new price takes
            effect.
          </p>
        </section>

        <section aria-labelledby="pricing-faq" className="mt-20">
          <p className="font-mono text-sm tracking-widest text-base-content/55">01</p>
          <h2 id="pricing-faq" className="display-section mt-5 text-[3.25rem] sm:text-[4.4rem]">
            Pricing <span className="rateloop-text-gradient">questions</span>
          </h2>
          <div className="mt-10 grid gap-x-12 gap-y-3 lg:grid-cols-2">
            {questions.map(([question, answer]) => (
              <details
                key={question}
                className="group border-l border-base-content/20 py-2 pl-5 open:border-base-content/50"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3 text-left [&::-webkit-details-marker]:hidden">
                  <span className="text-lg font-semibold">{question}</span>
                  <span
                    aria-hidden="true"
                    className="text-xl text-base-content/50 transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="pb-5 pr-4 text-base leading-7 text-base-content/60">{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <aside className="mt-20 flex flex-col items-start justify-between gap-6 border-t border-white/10 pt-10 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold">Need a design-partner arrangement?</h2>
            <p className="mt-2 text-base text-base-content/55">
              Talk to us about a larger workflow without buying an imaginary enterprise tier.
            </p>
          </div>
          <a
            href="mailto:hawigxyz@proton.me?subject=RateLoop%20design%20partner"
            className="btn min-h-11 rounded-lg border border-base-content/15 bg-base-content/[0.07] px-5 hover:bg-base-content/[0.12]"
          >
            Contact RateLoop
          </a>
        </aside>
      </div>
    </div>
  );
}
