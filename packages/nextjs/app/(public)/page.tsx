import Link from "next/link";
import { PromoVideo } from "~~/components/home/PromoVideo";
import { SupportedAgentsSection } from "~~/components/home/SupportedAgentsSection";
import { TokenlessOrb } from "~~/components/home/TokenlessOrb";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";

const howItWorksSteps = [
  ["01", "Ask", "A person or AI agent defines the question, cases, audience, budget, and quality bar.", "#359EEE"],
  [
    "02",
    "Answer & Earn",
    "Assigned human reviewers answer independently, explain their choice, and earn USDC for accepted paid work.",
    "#03CEA4",
  ],
  [
    "03",
    "Evaluation",
    "RateLoop returns the result, reasons, disagreement, limitations, and any valid settlement evidence. The customer decides what happens next.",
    "#EF476F",
  ],
] as const;

const whyItWorksFeatures = [
  {
    title: "Built for AI Workflows",
    body: "Agents can draft approval-bound browser handoffs or use a scoped workspace policy. Agents ask; human reviewers provide the judgment.",
    color: "#359EEE",
    links: [
      ["Agents & MCP", "/docs/ai"],
      ["SDK", "/docs/sdk"],
    ],
  },
  {
    title: "Independent Human Review",
    body: "Blinded assignments prevent reviewers from following the crowd. Invited, network, and hybrid panels remain separate in the evidence.",
    color: "#03CEA4",
    links: [
      ["Review Flow", "/docs/how-it-works"],
      ["Panel Integrity", "/docs/tech-stack"],
    ],
  },
  {
    title: "Transparent Incentives",
    body: "Accepted paid work receives a fixed USDC payment plus a bounded scoring bonus. The scoring rule rewards useful signal; it is not a truth oracle.",
    color: "#EF476F",
    links: [
      ["Scoring & Incentives", "/docs/tech-stack"],
      ["Fund Core", "/docs/smart-contracts"],
    ],
  },
  {
    title: "Auditable Settlement",
    body: "Commitments, economic terms, scoring, compensation, refunds, and settlement can be verified. The customer still owns the final decision.",
    color: "#FFC43D",
    links: [
      ["Smart Contracts", "/docs/smart-contracts"],
      ["Decision Evidence", "/docs/how-it-works"],
    ],
  },
  {
    title: "Privacy with Clear Limits",
    body: "Private artifacts are minimized, encrypted, and leased only to assigned reviewers. Public-chain evidence remains visible and cannot be erased.",
    color: "#359EEE",
    links: [
      ["Privacy Notice", "/legal/privacy"],
      ["Privacy & Recovery", "/docs/how-it-works"],
    ],
  },
] as const;

const questions = [
  [
    "What Does RateLoop Do?",
    "It gathers blind human reviews of AI work and returns a clear result with reasons. Your team makes the final decision.",
  ],
  [
    "What Can I Test?",
    "Support replies, marketing, consulting work, product behavior, internal copilots, and other AI work with a clear quality bar.",
  ],
  [
    "Who Reviews the Work?",
    "Your invited reviewers, RateLoop's network, or both. The public sandbox uses simulated reviewers.",
  ],
  [
    "Can an Agent Publish by Itself?",
    "Yes, when you give it a scoped RateLoop key and a prepaid budget or agent-controlled wallet. Otherwise it creates a browser draft for you to approve.",
  ],
  [
    "Can I Use Private Data?",
    "Not in the sandbox. Use public, test, or safely redacted content. Reviewers and RateLoop may read what you submit.",
  ],
  [
    "What Does the Blockchain Record?",
    "Commitments, payment terms, scoring, and settlement. It does not prove the work is safe or compliant.",
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

export default function TokenlessLandingPage() {
  const sandboxMode = isTokenlessSandboxMode();
  return (
    <div className="flex grow flex-col items-center px-4 pb-16 pt-4 sm:pt-12 lg:pt-16">
      <div className="relative flex w-full max-w-6xl flex-col items-center">
        <section className="relative z-0 flex w-full flex-col lg:min-h-[34rem] lg:items-center lg:justify-center xl:min-h-[38rem]">
          <div className="relative z-0 w-[min(28rem,84vw)] self-center sm:w-[min(44rem,94vw)] lg:pointer-events-none lg:absolute lg:-right-56 lg:-top-12 lg:w-[58rem] xl:-right-72 xl:-top-16 xl:w-[68rem]">
            <TokenlessOrb />
          </div>
          <div className="relative z-10 flex flex-col items-center lg:mr-auto lg:max-w-[40rem] lg:items-start lg:pb-8 lg:pt-24 xl:max-w-[43rem] xl:pt-28">
            <h1 className="hero-headline max-w-[14ch] text-center text-[3.25rem] text-base-content sm:text-[4.45rem] lg:text-left lg:text-[5.05rem] xl:text-[5.65rem]">
              <span className="block">Humans In The </span>
              <span className="block">
                <span className="rateloop-text-gradient">Loop</span>
              </span>
            </h1>
            <p className="mt-4 max-w-[40rem] text-center text-[1.05rem] leading-8 text-base-content/80 sm:text-[1.25rem] lg:text-left lg:text-[1.35rem]">
              Human raters guide decisions and earn USDC.
            </p>
            {sandboxMode ? (
              <p className="mt-4 max-w-[40rem] rounded-lg border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-center text-sm leading-6 text-amber-50 lg:text-left">
                Reviews and payments are simulated. Use test or redacted content.
              </p>
            ) : null}
            <div className="mt-6 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row">
              <Link href="/rate" className="rateloop-gradient-action min-h-11 px-5 text-base">
                Answer
              </Link>
              <Link
                href="/ask"
                className="btn min-h-11 rounded-lg border-0 bg-base-content/[0.11] px-5 text-base hover:bg-base-content/[0.18]"
              >
                Ask
              </Link>
            </div>
          </div>
          <SupportedAgentsSection />
        </section>

        <section id="how-it-works" className="relative z-10 mt-12 w-full sm:mt-16 lg:mt-20">
          <SectionTitle number="01" gradient="Works" className="mb-6">
            How It
          </SectionTitle>
          <PromoVideo />
          <div className="grid grid-cols-1 gap-x-12 gap-y-12 md:grid-cols-3">
            {howItWorksSteps.map(([number, title, body, color]) => (
              <article key={number} className="h-full border-l-2 py-2 pl-6" style={{ borderColor: color }}>
                <span className="font-mono text-sm" style={{ color }}>
                  {number}
                </span>
                <h3 className="mt-3 text-[1.55rem] font-bold leading-tight sm:text-[1.75rem]">{title}</h3>
                <p className="mt-4 text-[1.05rem] leading-8 text-base-content/60">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <div aria-hidden="true" className="my-16 h-px w-full max-w-5xl bg-base-content/10 sm:my-20 lg:my-24" />

        <section id="why-it-works" className="relative z-10 w-full">
          <SectionTitle number="02" gradient="Works">
            Why It
          </SectionTitle>
          <div className="grid grid-cols-1 gap-x-12 gap-y-14 md:grid-cols-2 lg:grid-cols-6">
            {whyItWorksFeatures.map((feature, index) => (
              <article
                key={feature.title}
                className={`flex min-h-56 flex-col border-l-2 py-2 pl-6 ${index < 3 ? "lg:col-span-2" : "lg:col-span-3"}`}
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
                      key={`${feature.title}-${href}`}
                      href={href}
                      prefetch={false}
                      className="rounded-md border border-base-content/10 bg-base-content/[0.06] px-3 py-1.5 text-xs font-semibold text-base-content/72 transition hover:border-base-content/20 hover:bg-base-content/[0.1] hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
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
          <SectionTitle number="03" gradient="Questions">
            Common
          </SectionTitle>
          <div className="grid grid-cols-1 gap-x-12 gap-y-4 xl:grid-cols-2">
            {questions.map(([question, answer]) => (
              <details
                key={question}
                className="group border-l border-base-content/20 py-2 pl-5 hover:border-base-content/40 open:border-base-content/50"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3 text-left [&::-webkit-details-marker]:hidden">
                  <span className="text-lg font-semibold sm:text-xl">{question}</span>
                  <span className="text-xl text-base-content/50 transition-transform group-open:rotate-45">+</span>
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
