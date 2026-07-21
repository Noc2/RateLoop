import Link from "next/link";
import { HumanAssuranceLoop } from "~~/components/assurance/HumanAssuranceLoop";
import { UseCaseIcon } from "~~/components/docs/UseCaseVisuals";
import { SupportedAgentsSection } from "~~/components/home/SupportedAgentsSection";
import { TokenlessOrb } from "~~/components/home/TokenlessOrb";
import { WorkspacePlanCards } from "~~/components/pricing/WorkspacePlanCards";
import type { LandingSocialProofItem } from "~~/lib/home/socialProof";
import { getLandingPageSocialProofItems } from "~~/lib/home/socialProofServer";

export const revalidate = 300;

const whyItWorksFeatures = [
  {
    title: "Agent-native",
    body: "Agent handoffs and funding route requests to a human panel.",
    color: "#359EEE",
    links: [
      ["Agent handoffs", "/docs/tech-stack#mcp-adapter"],
      ["Scoped funding", "/docs/tech-stack#x402-usdc"],
    ],
  },
  {
    title: "Verified and blind",
    body: "Audience policies and sealed answers keep admission explicit and early judgments private.",
    color: "#03CEA4",
    links: [
      ["Human eligibility", "/docs/tech-stack#proof-of-human"],
      ["Reviewer rules", "/docs/tech-stack#audience-policies"],
      ["Sealed answers", "/docs/tech-stack#commit-reveal"],
    ],
  },
  {
    title: "Useful signal, auditable pay",
    body: "Published scoring and Base USDC settlement make panel pay recomputable.",
    color: "#EF476F",
    links: [
      ["Quality bonus", "/docs/tech-stack#robust-bayesian-truth-serum"],
      ["Insight bonus", "/docs/tech-stack#surprisingly-popular"],
      ["USDC settlement", "/docs/tech-stack#base-usdc"],
      ["Fund safeguards", "/docs/smart-contracts#tokenless-panel"],
    ],
  },
  {
    title: "Human oversight, operationalized",
    body: "Your people provide the oversight. RateLoop provides the instrument — and the proof.",
    color: "var(--rateloop-yellow)",
    links: [
      ["Human Oversight", "/docs/human-oversight"],
      ["Evidence guide", "/docs/evidence"],
    ],
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
    body: "Candidate-ranking AI can be high-risk under the EU AI Act. Give an authorized recruiter oversight before it affects a candidate.",
    href: "/docs/use-cases#hiring-decisions",
    color: "var(--rateloop-pink)",
    icon: "hiring",
  },
] as const;

const questions = [
  [
    "Who Reviews the Work?",
    "Your invited reviewers, RateLoop's World ID-backed network, or clearly separated hybrid panels.",
  ],
  [
    "Can an Agent Run Reviews Automatically?",
    "Yes. After you approve its connection and limits, an agent can request reviews and receive results automatically. You control the project, audience, data rules, and budget.",
  ],
  [
    "Can I Use Private Data?",
    "Only submit material you are authorized to share. Minimize it, redact sensitive data, and remember assigned reviewers and RateLoop may read it.",
  ],
  [
    "What Does the Blockchain Record?",
    "Funding terms, accepted commitments, scoring inputs, and settlement evidence. Private context stays off-chain, and the chain record does not replace your final judgment.",
  ],
  [
    "Does RateLoop help with EU AI Act human oversight?",
    "Yes. Your designated people monitor, override, and stop AI outputs through RateLoop, and each decision leaves exportable evidence. Configuring RateLoop and using it correctly for your purpose remain yours.",
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

export function TokenlessLandingPage({
  socialProofItems,
  subscriptionsEnabled,
}: {
  socialProofItems: LandingSocialProofItem[];
  subscriptionsEnabled: boolean;
}) {
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
              <Link href="/human?tab=discover" className="group rateloop-gradient-action min-h-11 gap-2 px-5 text-base">
                <span>Start Reviewing</span>
                <span
                  aria-hidden="true"
                  className="text-lg leading-none transition-transform group-hover:translate-x-0.5"
                >
                  &gt;
                </span>
              </Link>
              <Link
                href="/agents?tab=overview"
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
              <article
                key={useCase.title}
                className="rateloop-surface-card rounded-2xl border-l-2 p-5 sm:p-6"
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
              </article>
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
          <div className="grid grid-cols-1 gap-x-10 gap-y-12 md:grid-cols-2 xl:grid-cols-4">
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
          <p className="mb-8 max-w-3xl text-lg leading-8 text-base-content/65 sm:mb-10 sm:text-xl">
            Plans cover RateLoop decisions. Reviewer pay is separate.
          </p>
          <WorkspacePlanCards subscriptionsEnabled={subscriptionsEnabled} />
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
  return (
    <TokenlessLandingPage
      socialProofItems={await getLandingPageSocialProofItems()}
      subscriptionsEnabled={process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED === "true"}
    />
  );
}
