import Link from "next/link";
import { PromoVideo } from "~~/components/home/PromoVideo";
import { SupportedAgentsSection } from "~~/components/home/SupportedAgentsSection";
import { TokenlessOrb } from "~~/components/home/TokenlessOrb";

const howItWorksSteps = [
  ["01", "Agent asks", "An agent sends one focused question and chooses who should review it.", "#359EEE"],
  ["02", "Humans answer", "Eligible reviewers answer independently without seeing early responses.", "#03CEA4"],
  [
    "03",
    "Review adapts",
    "The verdict and reasons return to the workflow so the agent can act or escalate.",
    "#EF476F",
  ],
] as const;

const whyItWorksFeatures = [
  {
    title: "Agent-native",
    body: "MCP Adapter handoffs and x402 funding turn one agent request into a scoped human panel.",
    color: "#359EEE",
    links: [
      ["MCP Adapter", "/docs/tech-stack#mcp-adapter"],
      ["x402", "/docs/tech-stack#x402-usdc"],
    ],
  },
  {
    title: "Verified and blind",
    body: "Proof of Human, audience policies, and commit-reveal keep admission explicit and early answers sealed.",
    color: "#03CEA4",
    links: [
      ["Proof of Human", "/docs/tech-stack#proof-of-human"],
      ["Audience Policies", "/docs/tech-stack#audience-policies"],
      ["Commit-Reveal", "/docs/tech-stack#commit-reveal"],
      ["drand/tlock", "/docs/tech-stack#drand-tlock"],
    ],
  },
  {
    title: "Useful signal, auditable pay",
    body: "RBTS and Surprisingly Popular reward informative reports; Base + USDC makes settlement recomputable.",
    color: "#EF476F",
    links: [
      ["RBTS", "/docs/tech-stack#robust-bayesian-truth-serum"],
      ["Surprisingly Popular", "/docs/tech-stack#surprisingly-popular"],
      ["Base + USDC", "/docs/tech-stack#base-usdc"],
      ["Fund Core", "/docs/smart-contracts#tokenless-panel"],
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
    "Your invited reviewers, RateLoop's World ID-backed network, or clearly separated hybrid panels.",
  ],
  [
    "Can an Agent Run Reviews Automatically?",
    "Yes. Once you approve its connection and limits, an agent can request reviews and receive results without a click on every run. You control the project, audience, data rules, and budget.",
  ],
  [
    "Can I Use Private Data?",
    "Only submit material you are authorized to share. Minimize it, redact unnecessary sensitive data, and remember that assigned reviewers and RateLoop may read what you submit.",
  ],
  [
    "What Does the Blockchain Record?",
    "Funding terms, accepted commitments, scoring inputs, and settlement evidence. Private context stays off-chain, and the chain record does not replace your final judgment.",
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
              Scale AI autonomy without scaling blind trust.
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
          <div className="grid grid-cols-1 gap-x-12 gap-y-12 md:grid-cols-3">
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
          <SectionTitle number="03" gradient="Simple">
            Pricing, Kept
          </SectionTitle>
          <div className="surface-card flex flex-col gap-6 rounded-2xl p-7 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-3xl text-lg leading-8 text-base-content/65">
              Start free with 25 decisions each month. Early Access is $99 for 250 decisions; paid reviewer costs are
              separate.
            </p>
            <Link href="/pricing" className="rateloop-gradient-action shrink-0 px-5">
              See pricing
            </Link>
          </div>
        </section>

        <div aria-hidden="true" className="my-16 h-px w-full max-w-5xl bg-base-content/10 sm:my-20 lg:my-24" />

        <section id="faq" className="relative z-10 w-full">
          <SectionTitle number="04" gradient="Questions">
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
