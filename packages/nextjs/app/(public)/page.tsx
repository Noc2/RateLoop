import Link from "next/link";
import { HumanAssuranceUseCasesStrip } from "~~/components/home/HumanAssuranceUseCasesStrip";
import { TokenlessOrb } from "~~/components/home/TokenlessOrb";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";

const steps = [
  ["01", "Set the Standard", "Ask one clear question about the work.", "#359EEE"],
  ["02", "Review Blind", "People answer without seeing anyone else's vote.", "#03CEA4"],
  ["03", "Make the Call", "Use the result and reasons to decide what ships.", "#EF476F"],
] as const;

const benefits = [
  ["Launch Decisions", "Check one quality bar before you ship.", "#359EEE"],
  ["Less Groupthink", "Blind reviews hide the crowd's answers.", "#03CEA4"],
  ["Reasons Included", "See why people agreed or disagreed.", "#EF476F"],
  ["Audit Trail", "Inspect commitments, scoring, and payments.", "#FFC43D"],
  ["Paid Reviewers", "Reward people for accepted work.", "#359EEE"],
  ["Privacy Has Limits", "Keep secrets out. RateLoop and assigned reviewers may read submitted content.", "#359EEE"],
] as const;

const agentClients = ["Claude Code", "OpenAI Codex", "Cursor", "GitHub Copilot", "Gemini CLI", "OpenClaw"] as const;

const agentTools = [
  ["rateloop_capabilities", "Check what the server supports."],
  ["rateloop_create_handoff", "Create a private browser handoff."],
  ["rateloop_get_handoff_status", "Check if the handoff is still waiting."],
  ["rateloop_get_result", "Get the finished result."],
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
    "No. The agent creates a draft. A person must approve and submit it in the browser.",
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
              <span className="block">Human Assurance</span>
              <span className="block">
                <span className="rateloop-text-gradient">for AI</span>
              </span>
            </h1>
            <p className="mt-4 max-w-[40rem] text-center text-[1.05rem] leading-8 text-base-content/80 sm:text-[1.25rem] lg:text-left lg:text-[1.35rem]">
              Get blind human feedback before you ship.
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
          <HumanAssuranceUseCasesStrip />
        </section>

        <section className="relative z-10 mt-12 w-full sm:mt-16 lg:mt-20">
          <SectionTitle number="01" gradient="Works">
            How It
          </SectionTitle>
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
            Why RateLoop
          </SectionTitle>
          <div className="grid grid-cols-1 gap-x-12 gap-y-14 md:grid-cols-2 lg:grid-cols-6">
            {benefits.map(([title, body, color], index) => (
              <article
                key={title}
                className="flex min-h-52 flex-col border-l-2 py-2 pl-6 lg:col-span-2"
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
          <SectionTitle number="03" gradient="Workflow">
            Agent
          </SectionTitle>
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
            <div>
              <p className="max-w-xl text-[1.15rem] leading-8 text-base-content/70 sm:text-[1.3rem]">
                Your agent drafts the request. You approve it. RateLoop opens the browser to review and submit.
              </p>
              <div className="mt-7 flex flex-wrap gap-2" aria-label="Supported agent clients">
                {agentClients.map(client => (
                  <span
                    key={client}
                    className="rounded-full border border-base-content/15 bg-base-content/[0.05] px-3 py-2 text-sm font-semibold text-base-content/80"
                  >
                    {client}
                  </span>
                ))}
              </div>
              <div className="rateloop-surface-card mt-7 rounded-2xl p-5 sm:p-6">
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#03CEA4]">You stay in control</p>
                <ol className="mt-4 space-y-3 text-base leading-7 text-base-content/70">
                  <li>
                    <strong className="text-base-content">1. Draft.</strong> The agent prepares the question.
                  </li>
                  <li>
                    <strong className="text-base-content">2. Approve.</strong> You see exactly what will be shared.
                  </li>
                  <li>
                    <strong className="text-base-content">3. Submit.</strong> Review the quote and send it from the
                    browser.
                  </li>
                </ol>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {agentTools.map(([name, description], index) => (
                <article key={name} className="rateloop-surface-card rounded-2xl p-5 sm:p-6">
                  <span className="font-mono text-xs text-[#359EEE]">{String(index + 1).padStart(2, "0")}</span>
                  <h3 className="mt-3 break-words font-mono text-sm font-semibold text-base-content sm:text-base">
                    {name}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-base-content/60">{description}</p>
                </article>
              ))}
              <div className="sm:col-span-2">
                <p className="mt-2 text-sm leading-6 text-base-content/55">
                  Use only public, test, or redacted content. {sandboxMode ? "This sandbox is simulated." : null}
                </p>
                <Link
                  href="/docs/ai"
                  className="mt-5 inline-flex text-sm font-semibold text-base-content underline decoration-base-content/35 underline-offset-4 hover:decoration-base-content"
                >
                  Set up MCP
                </Link>
              </div>
            </div>
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
