import Link from "next/link";
import { PromoVideo } from "~~/components/home/PromoVideo";
import { SupportedAgentsStrip } from "~~/components/home/SupportedAgentsStrip";
import { TokenlessOrb } from "~~/components/home/TokenlessOrb";

const steps = [
  [
    "01",
    "Describe the decision",
    "Choose a focused binary or A/B question, the audience assurance you need, and the panel size.",
    "#359EEE",
  ],
  [
    "02",
    "Fund clear terms",
    "Review one itemized USDC quote covering the rater bounty, platform fee, and accepted-work reserve.",
    "#03CEA4",
  ],
  [
    "03",
    "Use the result",
    "Receive a sealed panel result with its settlement state, evidence, and complete accounting.",
    "#EF476F",
  ],
] as const;

const benefits = [
  [
    "Raters never stake",
    "People contribute judgment without buying a token, approving a stake, or risking their own money.",
    "#359EEE",
  ],
  [
    "Accepted work has a paid path",
    "Once a paid commit is accepted, deterministic settlement or disclosed compensation replaces platform discretion.",
    "#03CEA4",
  ],
  [
    "Private before reveal",
    "One-time vote keys and time-lock encryption keep answers sealed until the panel reaches its reveal phase.",
    "#EF476F",
  ],
  [
    "Funding is understandable",
    "Bounty, fee, reserve, refunds, and compensation are visible before a funder authorizes USDC.",
    "#FFC43D",
  ],
  [
    "Built for agents and people",
    "The same quote → ask → wait → result workflow supports the website, SDK, and autonomous agents.",
    "#359EEE",
  ],
] as const;

const questions = [
  [
    "Does RateLoop have a token?",
    "No. Panels are funded and paid in USDC. Raters do not need a protocol token or make a deposit.",
  ],
  [
    "Can RateLoop take escrowed funds?",
    "The fund-holding panel core has no operator withdrawal path and cannot redirect claims. Admission is separate from custody and settlement.",
  ],
  [
    "What happens if a panel fails?",
    "Zero-commit rounds refund fully. If accepted work exists but the panel cannot finish, the disclosed reserve compensates that work and unused funding is returned.",
  ],
  [
    "When does a rater complete eligibility?",
    "Identity, residence, applicable tax, sanctions, and payout setup are completed before the first paid voucher—not after work has been earned.",
  ],
] as const;

function SectionTitle({ number, children, gradient }: { number: string; children: React.ReactNode; gradient: string }) {
  return (
    <div className="mb-12 sm:mb-16">
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
              <span className="block">Level Up Your</span>
              <span className="block">
                <span className="rateloop-text-gradient">Agent</span>
              </span>
            </h1>
            <p className="mt-4 max-w-[40rem] text-center text-[1.05rem] leading-8 text-base-content/80 sm:text-[1.25rem] lg:text-left lg:text-[1.35rem]">
              Paid human panels guide decisions and earn USDC.
            </p>
            <div className="mt-6 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row">
              <Link href="/ask" className="rateloop-gradient-action min-h-11 px-5 text-base">
                Run a panel
              </Link>
              <Link
                href="/rate"
                className="btn min-h-11 rounded-lg border-0 bg-base-content/[0.11] px-5 text-base hover:bg-base-content/[0.18]"
              >
                Rate decisions
              </Link>
            </div>
            <p className="mt-5 text-center text-sm text-base-content/55 lg:text-left">
              No rater stake · Itemized USDC funding · Deterministic settlement
            </p>
          </div>
          <SupportedAgentsStrip />
        </section>

        <section className="relative z-10 mt-12 w-full sm:mt-16 lg:mt-20">
          <SectionTitle number="01" gradient="Works">
            How It
          </SectionTitle>
          <PromoVideo />
          <div className="grid grid-cols-1 gap-x-12 gap-y-12 md:grid-cols-3">
            {steps.map(([number, title, body, color]) => (
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

        <section className="relative z-10 w-full">
          <SectionTitle number="02" gradient="Works">
            Why It
          </SectionTitle>
          <div className="grid grid-cols-1 gap-x-12 gap-y-14 md:grid-cols-2 lg:grid-cols-6">
            {benefits.map(([title, body, color], index) => (
              <article
                key={title}
                className={`flex min-h-52 flex-col border-l-2 py-2 pl-6 ${index < 3 ? "lg:col-span-2" : "lg:col-span-3"}`}
                style={{ borderColor: color }}
              >
                <span className="font-mono text-sm" style={{ color }}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3 text-[1.45rem] font-bold leading-tight sm:text-[1.65rem]">{title}</h3>
                <p className="mt-4 text-base leading-7 text-base-content/60">{body}</p>
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
              Read the protocol documentation
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
