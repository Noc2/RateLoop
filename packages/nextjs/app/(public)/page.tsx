import Link from "next/link";
import { PromoVideo } from "~~/components/home/PromoVideo";
import { SupportedAgentsSection } from "~~/components/home/SupportedAgentsSection";
import { TokenlessOrb } from "~~/components/home/TokenlessOrb";

const howItWorksSteps = [
  [
    "01",
    "Agent asks",
    "An AI agent sends the question, its suggestion, audience, timing, and review policy.",
    "#359EEE",
  ],
  [
    "02",
    "Humans answer",
    "Invited or public-network humans answer independently. Public work pays USDC; internal work can stay unpaid.",
    "#03CEA4",
  ],
  [
    "03",
    "Review adapts",
    "RateLoop measures human agreement, disagreement, drift, latency, and cost so review can reduce only when evidence supports it.",
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
    title: "Proof-of-Human Panels",
    body: "RateLoop-network reviewers enroll with World ID 4 Proof of Human. Blinded, correlation-diversified assignments reduce duplicate and crowd-following risk; invited and hybrid panels remain separate in the evidence.",
    color: "#03CEA4",
    links: [
      ["Review Flow", "/docs/how-it-works"],
      ["Panel Integrity", "/docs/tech-stack"],
    ],
  },
  {
    title: "Bayesian Reporting Incentives",
    body: "Accepted paid work receives fixed USDC plus a bounded Robust Bayesian Truth Serum bonus. A separate, platform-funded Surprisingly Popular bounty rewards answers that outperform the panel's own predictions; neither changes the verdict or acts as a truth oracle.",
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
    "What Can I Evaluate?",
    "Support replies, marketing, consulting work, product behavior, internal copilots, and other AI work with a clear quality bar.",
  ],
  [
    "Who Reviews the Work?",
    "Your invited reviewers, RateLoop's World ID-backed network, or a clearly separated hybrid panel.",
  ],
  [
    "Can an Agent Publish by Itself?",
    "Yes, when you give it a scoped RateLoop key and a prepaid budget or agent-controlled wallet. Otherwise it creates a browser draft for you to approve.",
  ],
  [
    "Can I Use Private Data?",
    "Use only material you are authorized to share, minimize it, and redact unnecessary sensitive data. Assigned reviewers and RateLoop may read what you submit.",
  ],
  [
    "What Does the Blockchain Record?",
    "Commitments, payment terms, scoring, and settlement. It does not prove the work is safe or compliant.",
  ],
] as const;

const pricingPlans = [
  ["Free", "$0", "25 decisions / month", "1 agent · 1 private group", "Start free", "/agents?tab=overview"],
  ["Early Access", "$99", "250 decisions / month", "3 agents · 5 private groups", "View Early Access", "/pricing"],
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
  return (
    <div className="flex grow flex-col items-center px-4 pb-16 pt-4 sm:pt-12 lg:pt-16">
      <div className="relative flex w-full max-w-6xl flex-col items-center">
        <section className="relative z-0 flex w-full flex-col lg:min-h-[34rem] lg:items-center lg:justify-center xl:min-h-[38rem]">
          <div className="relative z-0 w-[min(28rem,84vw)] self-center sm:w-[min(44rem,94vw)] lg:pointer-events-none lg:absolute lg:-right-56 lg:-top-12 lg:w-[58rem] xl:-right-72 xl:-top-16 xl:w-[68rem]">
            <TokenlessOrb />
          </div>
          <div className="relative z-10 flex flex-col items-center lg:mr-auto lg:max-w-[40rem] lg:items-start lg:pb-8 lg:pt-24 xl:max-w-[43rem] xl:pt-28">
            <h1 className="hero-headline max-w-[14ch] text-center text-[3.25rem] text-base-content sm:text-[4.45rem] lg:text-left lg:text-[5.05rem] xl:text-[5.65rem]">
              <span className="block">The Human</span>
              <span className="block">
                Assurance <span className="rateloop-text-gradient">Loop</span>
              </span>
            </h1>
            <p className="mt-4 max-w-[40rem] text-center text-[1.05rem] leading-8 text-base-content/80 sm:text-[1.25rem] lg:text-left lg:text-[1.35rem]">
              Give your agent frequent human feedback at first—then review only when the evidence calls for it.
            </p>
            <div className="mt-6 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row">
              <Link href="/human?tab=discover" className="group rateloop-gradient-action min-h-11 gap-2 px-5 text-base">
                <span>For Humans</span>
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
                <span>For Agents</span>
                <span
                  aria-hidden="true"
                  className="text-lg leading-none transition-transform group-hover:translate-x-0.5"
                >
                  &gt;
                </span>
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
          <SectionTitle number="03" gradient="Simple">
            Pricing, Kept
          </SectionTitle>
          <div className="grid gap-5 lg:grid-cols-[0.8fr_1fr_1fr]">
            <div className="flex flex-col justify-between py-3 lg:pr-8">
              <p className="text-lg leading-8 text-base-content/65">
                Bring your own reviewers for free. Upgrade the workspace when you need more decisions, agents, groups,
                or paid human supply.
              </p>
              <p className="mt-6 text-sm leading-6 text-base-content/45">
                Public-panel bounty, attempt reserve, and the 7.5% execution fee are funded separately from the
                subscription.
              </p>
            </div>
            {pricingPlans.map(([name, price, allowance, limits, cta, href], index) => (
              <article
                key={name}
                className={`surface-card flex min-h-72 flex-col rounded-2xl border-t-2 p-7 ${
                  index === 0 ? "border-[var(--rateloop-blue)]" : "border-[var(--rateloop-green)]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-2xl font-semibold">{name}</h3>
                  {index === 1 ? (
                    <span className="rounded-full bg-[var(--rateloop-green)]/10 px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-wider text-[var(--rateloop-green)]">
                      Early Access
                    </span>
                  ) : null}
                </div>
                <p className="mt-7 display-section text-5xl">{price}</p>
                <p className="mt-5 text-base font-semibold">{allowance}</p>
                <p className="mt-1 text-sm text-base-content/50">{limits}</p>
                <Link
                  href={href}
                  className="mt-auto pt-7 text-sm font-semibold text-base-content underline decoration-base-content/35 underline-offset-4 hover:decoration-base-content"
                >
                  {cta} <span aria-hidden="true">→</span>
                </Link>
              </article>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link
              href="/pricing"
              className="text-sm font-semibold text-base-content underline decoration-base-content/35 underline-offset-4 hover:decoration-base-content"
            >
              Compare plans and panel costs
            </Link>
          </div>
        </section>

        <div aria-hidden="true" className="my-16 h-px w-full max-w-5xl bg-base-content/10 sm:my-20 lg:my-24" />

        <section className="relative z-10 w-full">
          <SectionTitle number="04" gradient="Questions">
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
