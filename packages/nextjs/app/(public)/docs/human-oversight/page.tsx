import Link from "next/link";
import { DocsTitle } from "~~/components/docs/DocsTitle";

const OVERSIGHT_SECTIONS = [
  {
    id: "monitor",
    requirement: "Article 14(4)(a)",
    title: "Monitor operation",
    body: "Your designated people monitor operation from the oversight dashboard: sampling coverage, response latency, disagreement, and blocked outputs, per scope. In-app, email, and browser alerts flag disagreement spikes, coverage-floor hits, blocked outputs, failed or expired reviews, and workspace stops, and event webhooks feed your own monitoring. Per-agent evidence summaries show the declared provider and model alongside observed workflows and risk tiers — declared metadata labelled host-reported, not independently verified.",
    responsibility:
      "You remain responsible for watching those surfaces, understanding the agent's capacities and limitations, and acting on what they show for your use case.",
  },
  {
    id: "automation-bias",
    requirement: "Article 14(4)(b)",
    title: "Counter automation bias",
    body: "Independent blinded panels judge the output before your decision: sealed answers keep early judgments private, so reviewers cannot anchor on each other. The decision prompt ships with no preselected choice, disagreement and calibration signals appear above the decision buttons, and the deciding person's own override-rate trend stays visible to them.",
    responsibility:
      "You remain responsible for staying aware of the pull to over-rely on the system and keeping each decision a considered one.",
  },
  {
    id: "interpret",
    requirement: "Article 14(4)(c)",
    title: "Correctly interpret the output",
    body: "The owner case view shows the oversight person the actual output, its source context, reviewer rationales, and surfaced disagreement before their decision. For workspace-internal cases your workspace owns that data; public-network cases keep the aggregate-only view.",
    responsibility:
      "You remain responsible for correctly interpreting the output within your domain, workflow, and context.",
  },
  {
    id: "override",
    requirement: "Article 14(4)(d)",
    title: "Disregard, override, or reverse",
    body: "Every go, revise, and stop decision is recorded against the case. Per-output override records carry a required reasons field and join the workspace audit chain, and the override rate is a first-class metric on the dashboard and in coverage exports.",
    responsibility: "You remain responsible for deciding when to disregard, override, or reverse an output.",
  },
  {
    id: "stop",
    requirement: "Article 14(4)(e)",
    title: "Intervene or stop",
    body: "Only a verified host adapter that controls delivery can establish that an eligible output stayed undelivered until a person decided. Ordinary Codex, plugin, and MCP integrations are advisory: they report the review lifecycle but do not verify interception or withheld delivery. RateLoop's workspace stop blocks new review-triggered release authorizations; a verified host must honor that state at delivery, while an advisory host can bypass it. Releasing the stop restores no agent grant automatically.",
    responsibility: "You remain responsible for choosing which outputs are gated, when to intervene, and when to halt.",
  },
] as const;

export default function HumanOversightPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Oversight">Human</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        RateLoop can support a deployer&apos;s configured human oversight of AI agent outputs: monitor, interpret,
        override, and stop, with records of each step. This page maps Article 14(4) measures to relevant RateLoop
        capabilities and the duties that remain with the deployer.
      </p>

      <aside className="not-prose my-8 rounded-2xl border-l-2 border-[var(--rateloop-yellow)] bg-amber-300/[0.06] p-5 sm:p-6">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[var(--rateloop-yellow)]">
          Shared responsibility
        </p>
        <p className="mt-3 max-w-4xl text-base font-semibold leading-7 text-base-content sm:text-lg">
          Your people provide oversight. RateLoop supports the configured workflow and records its evidence.
        </p>
        <p className="mt-3 max-w-4xl text-sm leading-7 text-base-content/75 sm:text-base">
          RateLoop does not determine whether the EU AI Act applies or establish compliance. That depends on your
          system, role, context, organization, and operation. RateLoop operates around your AI system; only a verified
          host integration can enforce its review state at the output boundary.
        </p>
      </aside>

      <h2 id="article-14-4">The five Article 14(4) measures</h2>
      <div className="not-prose my-8 grid gap-4">
        {OVERSIGHT_SECTIONS.map((section, index) => (
          <section key={section.id} id={section.id} className="rateloop-surface-card rounded-2xl border-l-2 p-5 sm:p-6">
            <p className="font-mono text-xs text-base-content/55">
              {String(index + 1).padStart(2, "0")} · {section.requirement}
            </p>
            <h3 className="mt-2 text-lg font-bold text-base-content">{section.title}</h3>
            <p className="mt-3 text-sm leading-7 text-base-content/65">{section.body}</p>
            <p className="mt-3 text-sm font-semibold leading-7 text-base-content/75">{section.responsibility}</p>
          </section>
        ))}
      </div>

      <h2 id="designation-and-literacy">Designation, competence, and literacy</h2>
      <p>
        Article 26(2) requires oversight to be assigned to natural persons with competence, training, and authority.
        RateLoop records oversight designations with attestation records — competence basis, training completed, and
        authority granted — exportable as an assignment record, and emits audit events on every role assignment and
        change. Reviewer and oversight-person training and calibration records can be exported as evidence relevant to
        Article 4 AI-literacy duties. Choosing those people, and ensuring their competence, training, and authority,
        remains yours.
      </p>
      <p>
        Audit and evidence exports map to the Commission&apos;s draft Article 73 serious-incident reporting template —
        labelled draft-aligned until the template is final — and the workspace&apos;s oversight configuration exports as
        a factual description of the implemented oversight measures, usable as input for an Article 27
        fundamental-rights impact assessment.
      </p>

      <h2 id="reviewer-lanes">Which reviewer lane carries this</h2>
      <p>
        Invited reviewers are your personnel: the people your organization designates, whose competence, training, and
        authority you attest. That lane can support your configured oversight workflow. The public network is
        supplementary review capacity and an independent quality signal; neither lane by itself establishes that Article
        14 or Article 26 duties are met.
      </p>
      <p>
        The shared-responsibility matrix and the exportable evidence behind each capability live on{" "}
        <Link href="/docs/evidence">Evidence &amp; Compliance</Link>.
      </p>
    </article>
  );
}
