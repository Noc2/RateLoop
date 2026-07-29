import Link from "next/link";
import { HumanAssuranceLoop } from "~~/components/assurance/HumanAssuranceLoop";
import { UseCaseIcon } from "~~/components/docs/UseCaseVisuals";
import { SupportedAgentsSection } from "~~/components/home/SupportedAgentsSection";
import { TokenlessOrb } from "~~/components/home/TokenlessOrb";
import { Card } from "~~/components/tokenless/ui/Card";
import { TOKENLESS_BILLING_PLANS, formatUsdPrice } from "~~/lib/billing/plans";
import type { LandingSocialProofItem } from "~~/lib/home/socialProof";
import { getLandingPageSocialProofItems } from "~~/lib/home/socialProofServer";

export const revalidate = 300;

const whyItWorksFeatures = [
  {
    title: "Agent-native",
    body: "Connect an agent once, then request review through its normal tool workflow.",
    color: "#359EEE",
    links: [["Agent guide", "/docs/ai"]],
  },
  {
    title: "Private by default",
    body: "Invited reviewers see only assigned material and submit their answers independently.",
    color: "#03CEA4",
    links: [["Review flow", "/docs/how-it-works#reviewer-flow"]],
  },
  {
    title: "Evidence you can inspect",
    body: "Results keep the question, verdict, reasons, disagreement, and review context together.",
    color: "#EF476F",
    links: [["Evidence reference", "/docs/evidence"]],
  },
] as const;

const useCases = [
  {
    title: "Customer replies",
    body: "A grounded reply can still frustrate. Would you send it?",
    href: "/docs/use-cases#customer-replies",
    color: "var(--rateloop-blue)",
    icon: "reply",
  },
  {
    title: "Research and client work",
    body: "Citations can still support weak conclusions. Are the claims supported?",
    href: "/docs/use-cases#research-deliverables",
    color: "var(--rateloop-green)",
    icon: "research",
  },
  {
    title: "AI-assisted hiring",
    body: "Hiring AI can be high-risk. Should an authorized recruiter approve it?",
    href: "/docs/use-cases#hiring-decisions",
    color: "var(--rateloop-pink)",
    icon: "hiring",
  },
] as const;

const questions = [
  ["Who Reviews the Work?", "Your invited workspace reviewers."],
  [
    "Can an Agent Run Reviews Automatically?",
    "Connection alone does not intercept outputs. An active agent can call RateLoop for each eligible output; only a verified host adapter that controls delivery can enforce waiting before release. No host currently holds that tier. Ordinary Codex integrations are advisory.",
  ],
  [
    "Can I Use Private Data?",
    "Only submit material you are authorized to share. Minimize it, redact sensitive data, and remember assigned reviewers and RateLoop may read it.",
  ],
  [
    "What Does RateLoop Record?",
    "The review question, policy, responses, result, and available evidence. Private context stays in workspace-scoped storage, and the record supports—but does not replace—your final judgment.",
  ],
  [
    "How can RateLoop support EU AI Act human oversight?",
    "RateLoop can support configured human-review controls and export evidence relevant to Article 14. It does not determine whether the Act applies or establish compliance; you remain responsible for classification, deployment, competent oversight, and operation.",
  ],
] as const;

function SectionTitle({
  number,
  children,
  gradient,
  className = "mb-12 sm:mb-16",
}: {
  number: string;
  children: React.ReactNode;
  gradient: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="mb-6 block font-mono text-sm tracking-widest text-base-content/70">{number}</span>
      <h2 className="display-section text-[2.85rem] text-base-content sm:text-[4.3rem] lg:text-[5.4rem]">
        {children} <span className="rateloop-text-gradient">{gradient}</span>
      </h2>
    </div>
  );
}

export function TokenlessLandingPage({ socialProofItems }: { socialProofItems: LandingSocialProofItem[] }) {
  return (
    <div className="flex grow flex-col items-center px-4 pb-16 pt-4 sm:pt-12 lg:pt-16">
      <div className="relative flex w-full max-w-6xl flex-col items-center">
        <section className="relative z-0 flex w-full flex-col lg:min-h-[34rem] lg:items-center lg:justify-center xl:min-h-[38rem]">
          <div className="relative z-10 flex flex-col items-center lg:mr-auto lg:max-w-[40rem] lg:items-start lg:pb-8 lg:pt-24 xl:max-w-[43rem] xl:pt-28">
            <h1 className="hero-headline max-w-[14ch] text-center text-[3.25rem] text-base-content sm:text-[4.45rem] lg:text-left lg:text-[5.05rem] xl:text-[5.65rem]">
              <span className="block">The Human</span>
              <span className="block">
                Assurance <span className="rateloop-text-gradient">Loop</span>
              </span>
            </h1>
            <p className="mt-4 max-w-[40rem] text-center text-[1.05rem] leading-8 text-base-content/80 sm:text-[1.25rem] lg:text-left lg:text-[1.35rem]">
              Scale AI autonomy without scaling blind trust.
            </p>
            <div className="mt-6 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row">
              <Link href="/human/review" className="group rateloop-gradient-action min-h-11 gap-2 px-5 text-base">
                <span>Start Reviewing</span>
                <span
                  aria-hidden="true"
                  className="text-lg leading-none transition-transform group-hover:translate-x-0.5"
                >
                  &gt;
                </span>
              </Link>
              <Link
                href="/agents/connections"
                className="group btn min-h-11 gap-2 rounded-lg border-0 bg-base-content/[0.11] px-5 text-base hover:bg-base-content/[0.18]"
              >
                <span>Connect Agent</span>
                <span
                  aria-hidden="true"
                  className="text-lg leading-none transition-transform group-hover:translate-x-0.5"
                >
                  &gt;
                </span>
              </Link>
            </div>
            {socialProofItems.length > 0 ? (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center text-sm text-base-content/76 sm:text-[0.95rem] lg:justify-start lg:text-left">
                {socialProofItems.map(({ value, label }, index) => (
                  <div key={label} className="flex items-center">
                    <span
                      className={`whitespace-nowrap ${index < socialProofItems.length - 1 ? "sm:after:ml-3 sm:after:text-base-content/70 sm:after:content-['•']" : ""}`}
                    >
                      <span className="font-semibold text-base-content">{value}</span> {label}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="relative z-0 mt-5 w-[min(28rem,84vw)] self-center sm:w-[min(44rem,94vw)] lg:pointer-events-none lg:absolute lg:-right-56 lg:-top-12 lg:mt-0 lg:w-[58rem] xl:-right-72 xl:-top-16 xl:w-[68rem]">
            <TokenlessOrb />
          </div>
          <SupportedAgentsSection />
        </section>

        <section id="use-cases" className="relative z-10 mt-12 w-full sm:mt-16 lg:mt-20">
          <SectionTitle number="01" gradient="Matter" className="mb-6">
            Where Humans
          </SectionTitle>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {useCases.map(useCase => (
              <Card
                as="article"
                variant="marketing"
                key={useCase.title}
                className="rounded-2xl border-l-2 p-5 sm:p-6"
                style={{ borderColor: useCase.color }}
              >
                <div className="flex items-center gap-3">
                  <UseCaseIcon kind={useCase.icon} color={useCase.color} />
                  <h3 className="text-xl font-bold leading-tight">
                    <Link href={useCase.href} className="transition-colors hover:text-base-content/70">
                      {useCase.title}
                    </Link>
                  </h3>
                </div>
                <p className="mt-3 text-base leading-7 text-base-content/65">{useCase.body}</p>
              </Card>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link
              href="/docs/use-cases"
              className="text-sm font-semibold text-base-content underline decoration-base-content/35 underline-offset-4 hover:decoration-base-content"
            >
              Explore example workflows
            </Link>
          </div>
        </section>

        <div aria-hidden="true" className="my-16 h-px w-full max-w-5xl bg-base-content/10 sm:my-20 lg:my-24" />

        <section id="how-it-works" className="relative z-10 w-full">
          <SectionTitle number="02" gradient="Works" className="mb-6">
            How It
          </SectionTitle>
          <HumanAssuranceLoop className="mb-14" concise />
        </section>

        <div aria-hidden="true" className="my-16 h-px w-full max-w-5xl bg-base-content/10 sm:my-20 lg:my-24" />

        <section id="why-it-works" className="relative z-10 w-full">
          <SectionTitle number="03" gradient="Works">
            Why It
          </SectionTitle>
          <div className="grid grid-cols-1 gap-x-10 gap-y-12 md:grid-cols-3">
            {whyItWorksFeatures.map((feature, index) => (
              <article
                key={feature.title}
                className="flex min-h-52 flex-col border-l-2 py-2 pl-6"
                style={{ borderColor: feature.color }}
              >
                <span className="font-mono text-sm" style={{ color: feature.color }}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3 text-[1.45rem] font-bold leading-tight sm:text-[1.65rem]">{feature.title}</h3>
                <p className="mt-4 text-base leading-7 text-base-content/60">{feature.body}</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-5">
                  {feature.links.map(([label, href]) => (
                    <Link
                      key={href}
                      href={href}
                      prefetch={false}
                      className="rounded-lg border border-base-content/15 bg-base-content/[0.06] px-3 py-2 text-xs font-semibold text-base-content/70 transition-colors hover:border-base-content/30 hover:text-base-content"
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <div aria-hidden="true" className="my-16 h-px w-full max-w-5xl bg-base-content/10 sm:my-20 lg:my-24" />

        <section className="relative z-10 w-full">
          <SectionTitle number="04" gradient="Simple" className="mb-6">
            Pricing, Kept
          </SectionTitle>
          <Card
            as="div"
            className="flex flex-col gap-6 rounded-2xl p-7 sm:flex-row sm:items-center sm:justify-between sm:p-9"
          >
            <div>
              <p className="font-mono text-sm uppercase tracking-[0.18em] text-[var(--rateloop-green)]">Start free</p>
              <p className="mt-3 text-3xl font-semibold text-base-content">
                {formatUsdPrice(TOKENLESS_BILLING_PLANS.free.monthlyPriceCents)}
              </p>
              <p className="mt-3 max-w-2xl text-base leading-7 text-base-content/65">
                {TOKENLESS_BILLING_PLANS.free.decisionsPerPeriod} completed decisions each month,{" "}
                {TOKENLESS_BILLING_PLANS.free.activeAgents} active agent, and invited unpaid reviews.
              </p>
            </div>
            <Link href="/pricing" className="btn rateloop-secondary-action min-h-11 shrink-0 px-5">
              See pricing
            </Link>
          </Card>
        </section>

        <div aria-hidden="true" className="my-16 h-px w-full max-w-5xl bg-base-content/10 sm:my-20 lg:my-24" />

        <section id="faq" className="relative z-10 w-full">
          <SectionTitle number="05" gradient="Questions">
            Common
          </SectionTitle>
          <div className="grid grid-cols-1 gap-x-12 gap-y-4 xl:grid-cols-2">
            {questions.map(([question, answer]) => (
              <details
                key={question}
                className="group border-l border-base-content/20 py-2 pl-5 transition-colors hover:border-base-content/40 open:border-base-content/50"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3 text-left [&::-webkit-details-marker]:hidden">
                  <span className="text-lg font-semibold sm:text-xl">{question}</span>
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
          <div className="mt-12 text-center">
            <Link
              href="/docs"
              className="text-sm font-semibold text-base-content underline decoration-base-content/35 underline-offset-4 hover:decoration-base-content"
            >
              Read the docs
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

export default async function LandingPage() {
  return <TokenlessLandingPage socialProofItems={await getLandingPageSocialProofItems()} />;
}
