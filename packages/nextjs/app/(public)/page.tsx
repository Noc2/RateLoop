import Link from "next/link";
import { HumanAssuranceUseCasesStrip } from "~~/components/home/HumanAssuranceUseCasesStrip";
import { TokenlessOrb } from "~~/components/home/TokenlessOrb";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";

const steps = [
  [
    "01",
    "Set the Quality Bar",
    "Turn a real rollout decision—such as an AI support reply, campaign, product behavior, or internal copilot—into one focused binary or A/B panel.",
    "#359EEE",
  ],
  [
    "02",
    "Humans Evaluate Blind",
    "Eligible people review the same material and submit sealed signals, forecasts, and any required rationale without seeing the crowd's answers.",
    "#03CEA4",
  ],
  [
    "03",
    "Decide With Evidence",
    "Use the panel signal, written reasons, and settlement evidence as inputs to a human-owned rollout decision. Accepted rater work follows a paid or compensated path.",
    "#EF476F",
  ],
] as const;

const benefits = [
  [
    "Built for Rollout Decisions",
    "Test one declared quality criterion before release, at a workflow gate, or after a meaningful AI-system change.",
    "#359EEE",
  ],
  [
    "Independent Human Signal",
    "Blinded responses reduce visible herding. Eligibility and audience requirements can be chosen per panel without making one identity provider universal.",
    "#03CEA4",
  ],
  [
    "Reasons, Not Just a Score",
    "Ask for written rationale and a crowd forecast so your team can see objections, disagreement, and the limits of the result.",
    "#EF476F",
  ],
  [
    "Auditable Settlement",
    "Sealed commitments, deterministic scoring, and itemized settlement evidence make the panel process inspectable without pretending the result is a compliance certificate.",
    "#FFC43D",
  ],
  [
    "Paid Human Work",
    "Funded panels compensate eligible raters for accepted work, with a bounded prediction-accuracy bonus for useful forecasts.",
    "#359EEE",
  ],
  [
    "Honest Privacy Boundaries",
    "Question and rater text stays off-chain but may be readable by RateLoop and participating raters. Settlement evidence may be public, so current early access is not suitable for secrets or regulated personal data.",
    "#359EEE",
  ],
] as const;

const agentClients = ["Claude Code", "OpenAI Codex", "Cursor", "GitHub Copilot", "Gemini CLI", "OpenClaw"] as const;

const agentTools = [
  ["rateloop_capabilities", "Check the current environment and supported handoff contract."],
  ["rateloop_create_handoff", "Open an approval-bound browser handoff from an agreed draft."],
  ["rateloop_get_handoff_status", "Check whether the browser flow is still waiting or complete."],
  ["rateloop_get_result", "Retrieve the final structured result when it is available."],
] as const;

const questions = [
  [
    "What Is Human Assurance?",
    "Human assurance is a structured check on whether AI-enabled work meets a declared quality bar. RateLoop gathers blinded human judgment and reasons, then returns inspectable panel and settlement evidence. Your team still owns the decision.",
  ],
  [
    "Which AI-Enabled Workflows Fit?",
    "Good candidates include customer-support replies, marketing and content review, AI consulting acceptance checks, product behavior, internal copilots, and other decisions where a narrow human quality gate can change the next action.",
  ],
  [
    "Is RateLoop an Automated Approval System?",
    "No. A panel is decision support, not an automatic release, safety, legal, or compliance approval. Define the criterion before the round, consider the result with other evidence, and keep an accountable person responsible for the final action.",
  ],
  [
    "Who Evaluates the Work?",
    "RateLoop is designed for eligible human raters. Audience controls and optional identity credentials can add assurance where needed, but the current test stage does not promise universal proof of personhood or endorse one identity provider for every panel.",
  ],
  [
    "Can We Invite Our Own Reviewers?",
    "The private workflow supports one-time, Base-Account-bound invitations, reusable cohorts, assignment-only artifact access, and separate invited/network/hybrid reporting. The current public deployment remains a sandbox and does not recruit or pay live reviewers.",
  ],
  [
    "Can I Submit Sensitive Company Data?",
    "Private artifacts are encrypted and released only through short assignment leases, but reviewers still read their assigned material and the service retains controlled operational access. Do not use the sandbox for secrets, production credentials, regulated personal data, or safety-critical workflows.",
  ],
  [
    "What Does the On-Chain Trail Prove?",
    "It can make round commitments, economic terms, and deterministic settlement outcomes inspectable. It does not prove that a business decision was correct, that every rater is independent, or that the reviewed workflow is safe or compliant.",
  ],
  [
    "How Do Funding and Rater Payments Work?",
    "Every paid panel includes an itemized USDC quote for the rater bounty, platform fee, and accepted-work reserve. Accepted work follows the disclosed settlement or compensation path, including defined failure outcomes.",
  ],
  [
    "Why Is Evaluation Blind?",
    "Raters cannot see the crowd's direction before submitting. Sealed responses keep accepted answers fixed before the panel result is revealed, reducing visible copycat herding without claiming to eliminate every form of bias.",
  ],
  [
    "How Do Raters Earn?",
    "Eligible raters do not pay to participate. Accepted work earns a disclosed base share, and a bounded prediction-accuracy pool can reward useful forecasts. Required rationale is included in the quoted compensation.",
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
                <span className="rateloop-text-gradient">for AI Workflows</span>
              </span>
            </h1>
            <p className="mt-4 max-w-[40rem] text-center text-[1.05rem] leading-8 text-base-content/80 sm:text-[1.25rem] lg:text-left lg:text-[1.35rem]">
              Test AI-enabled work with blinded human panels before rollout.{" "}
              <br className="hidden lg:block 2xl:hidden" />
              {sandboxMode
                ? "Preview the suite, reviewer, and decision-evidence workflow with simulated activity."
                : "Get clear reasons and verifiable settlement evidence."}
            </p>
            {sandboxMode ? (
              <p className="mt-4 max-w-[40rem] rounded-lg border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-center text-sm leading-6 text-amber-50 lg:text-left">
                This isolated deployment is a product sandbox. Reviewer activity, results, and payments are simulated;
                use only synthetic or redacted test material.
              </p>
            ) : null}
            <div className="mt-6 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row">
              <Link href="/ask" className="rateloop-gradient-action min-h-11 px-5 text-base">
                {sandboxMode ? "Set Up a Sandbox Suite" : "Validate a Workflow"}
              </Link>
              <Link
                href="/rate"
                className="btn min-h-11 rounded-lg border-0 bg-base-content/[0.11] px-5 text-base hover:bg-base-content/[0.18]"
              >
                {sandboxMode ? "Preview Reviewer Flow" : "Earn by Evaluating AI"}
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
            Why It
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
            Agent-Ready
          </SectionTitle>
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
            <div>
              <p className="max-w-xl text-[1.15rem] leading-8 text-base-content/70 sm:text-[1.3rem]">
                Add outside human judgment without giving an agent permission to publish a request on its own. The
                integration drafts locally, exposes the exact outbound material for explicit approval, and then opens a
                browser review before quote and submission.
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
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#03CEA4]">Privacy-safe handoff</p>
                <ol className="mt-4 space-y-3 text-base leading-7 text-base-content/70">
                  <li>
                    <strong className="text-base-content">1. Draft locally.</strong> Keep source material in the calling
                    workspace while the question and redaction summary are prepared.
                  </li>
                  <li>
                    <strong className="text-base-content">2. Approve exactly what leaves.</strong> Show the prompt,
                    context, artifact descriptions, classification, and redaction summary before creating a handoff.
                  </li>
                  <li>
                    <strong className="text-base-content">3. Review in the browser.</strong> A person can edit, accept
                    the quote, and submit—or close the flow without publishing anything.
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
                  Use only public, synthetic, or safely redacted non-sensitive material.{" "}
                  {sandboxMode
                    ? "This sandbox returns simulated workflow activity, not live human reviews or paid evidence."
                    : "The browser remains the final quote-and-submit gate."}
                </p>
                <Link
                  href="/docs/ai"
                  className="mt-5 inline-flex text-sm font-semibold text-base-content underline decoration-base-content/35 underline-offset-4 hover:decoration-base-content"
                >
                  Connect an agent with MCP
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
              Read the product and trust documentation
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
