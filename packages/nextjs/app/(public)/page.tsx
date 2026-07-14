import Link from "next/link";
import { SupportedAgentsSection } from "~~/components/home/SupportedAgentsSection";
import { TokenlessOrb } from "~~/components/home/TokenlessOrb";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";

const steps = [
  ["01", "Set the Standard", "Define one clear question and the quality bar before anyone reviews.", "#359EEE"],
  ["02", "Review Blind", "Collect independent judgments without showing reviewers anyone else's vote.", "#03CEA4"],
  ["03", "Decide with Evidence", "Use the result, reasons, and audit trail to decide what ships.", "#EF476F"],
] as const;

const problemPoints = [
  ["Variable output", "The same prompt can produce different results across runs and models.", "#359EEE"],
  [
    "Subjective quality",
    "Correctness is only part of the question. Usefulness and tone still need judgment.",
    "#03CEA4",
  ],
  [
    "No independent check",
    "The people building the workflow are rarely the people reviewing its real-world impact.",
    "#EF476F",
  ],
] as const;

const safetyPoints = [
  [
    "Minimize the data",
    "Use public, synthetic, or safely redacted material. Remove secrets and unnecessary context.",
    "#359EEE",
  ],
  [
    "Control the audience",
    "Invite the reviewers you choose or use a scoped policy. Reviewer access is limited to the assigned work.",
    "#03CEA4",
  ],
  [
    "Keep the decision yours",
    "RateLoop records review evidence and settlement. It does not prove safety, compliance, or authorize a release.",
    "#EF476F",
  ],
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
              Human raters evaluate AI outputs, guide better decisions, and earn USDC.
            </p>
            {sandboxMode ? (
              <p className="mt-4 max-w-[40rem] rounded-lg border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-center text-sm leading-6 text-amber-50 lg:text-left">
                Sandbox only. Reviews and payments are simulated. Use test or redacted content.
              </p>
            ) : null}
            <div className="mt-6 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row">
              <Link href="/ask" className="rateloop-gradient-action min-h-11 px-5 text-base">
                {sandboxMode ? "Try the Sandbox" : "Start a Review"}
              </Link>
              <Link
                href="/rate"
                className="btn min-h-11 rounded-lg border-0 bg-base-content/[0.11] px-5 text-base hover:bg-base-content/[0.18]"
              >
                {sandboxMode ? "View Reviewer Flow" : "Become a Reviewer"}
              </Link>
            </div>
          </div>
          <SupportedAgentsSection />
        </section>

        <section id="problem" className="relative z-10 mt-12 w-full sm:mt-16 lg:mt-20">
          <SectionTitle number="01" gradient="Problem">
            The
          </SectionTitle>
          <p className="mb-10 max-w-3xl text-[1.15rem] leading-8 text-base-content/70 sm:text-[1.35rem]">
            AI can generate the work. The hard part is knowing whether it is useful, appropriate, and ready to reach
            real people.
          </p>
          <div className="grid grid-cols-1 gap-x-12 gap-y-12 md:grid-cols-3">
            {problemPoints.map(([title, body, color], index) => (
              <article key={title} className="h-full border-l-2 py-2 pl-6" style={{ borderColor: color }}>
                <span className="font-mono text-sm" style={{ color }}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3 text-[1.55rem] font-bold leading-tight sm:text-[1.75rem]">{title}</h3>
                <p className="mt-4 text-[1.05rem] leading-8 text-base-content/60">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <div aria-hidden="true" className="my-16 h-px w-full max-w-5xl bg-base-content/10 sm:my-20 lg:my-24" />

        <section id="solution" className="relative z-10 w-full">
          <SectionTitle number="02" gradient="Solution">
            The
          </SectionTitle>
          <p className="mb-10 max-w-3xl text-[1.15rem] leading-8 text-base-content/70 sm:text-[1.35rem]">
            Add a human assurance layer before an AI-enabled workflow reaches customers, teammates, or production.
          </p>
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

        <section id="safety-privacy" className="relative z-10 w-full">
          <SectionTitle number="03" gradient="Privacy">
            Safety &
          </SectionTitle>
          <p className="mb-10 max-w-3xl text-[1.15rem] leading-8 text-base-content/70 sm:text-[1.35rem]">
            Share only what reviewers need. Keep the final decision under your control.
          </p>
          <div className="grid grid-cols-1 gap-x-12 gap-y-12 md:grid-cols-3">
            {safetyPoints.map(([title, body, color], index) => (
              <article key={title} className="h-full border-l-2 py-2 pl-6" style={{ borderColor: color }}>
                <span className="font-mono text-sm" style={{ color }}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3 text-[1.55rem] font-bold leading-tight sm:text-[1.75rem]">{title}</h3>
                <p className="mt-4 text-[1.05rem] leading-8 text-base-content/60">{body}</p>
              </article>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-base-content/60">
            <Link
              href="/legal/privacy"
              className="font-semibold underline decoration-base-content/30 underline-offset-4 hover:decoration-base-content"
            >
              Read the privacy notice
            </Link>
            <Link
              href="/docs/ai"
              className="font-semibold underline decoration-base-content/30 underline-offset-4 hover:decoration-base-content"
            >
              Review the agent safety boundary
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
