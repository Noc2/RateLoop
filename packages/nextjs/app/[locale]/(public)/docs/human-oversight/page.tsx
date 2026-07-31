import type { Metadata } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import {
  LocalizedPublicContent,
  type PublicLocaleParams,
  getLocalizedPublicMetadata,
  usePublicLocale,
} from "~~/components/docs/LocalizedPublicContent";
import { PublicLink as Link } from "~~/components/docs/PublicLink";
import { Card } from "~~/components/tokenless/ui/Card";

export function generateMetadata({ params }: { params: PublicLocaleParams }): Promise<Metadata> {
  return getLocalizedPublicMetadata({ params, section: "docs", title: "Human oversight" });
}

const OVERSIGHT_SECTIONS = [
  {
    id: "monitor",
    title: "See operation and exceptions",
    body: "Your designated people monitor operation from the oversight dashboard: sampling coverage, response latency, disagreement, and blocked outputs, per scope. In-app, email, and browser alerts flag disagreement spikes, coverage-floor hits, blocked outputs, failed or expired reviews, and workspace stops, and event webhooks feed your own monitoring. Per-agent evidence summaries show the declared provider and model alongside observed workflows and risk tiers — declared metadata labelled host-reported, not independently verified.",
    responsibility:
      "You remain responsible for watching those surfaces, understanding the agent's capacities and limitations, and acting on what they show for your use case.",
    legalContext: "Relevant where a provider addresses Article 14(4)(a) monitoring.",
  },
  {
    id: "automation-bias",
    title: "Collect independent judgments",
    body: "Independent blinded panels judge the output before your decision: sealed answers keep early judgments private, so reviewers cannot anchor on each other. The decision prompt ships with no preselected choice, disagreement and calibration signals appear above the decision buttons, and the deciding person's own override-rate trend stays visible to them.",
    responsibility:
      "You remain responsible for staying aware of the pull to over-rely on the system and keeping each decision a considered one.",
    legalContext: "Relevant where a provider addresses Article 14(4)(b) automation bias.",
  },
  {
    id: "interpret",
    title: "Put the output in context",
    body: "The owner case view shows the oversight person the actual output, its source context, reviewer rationales, and surfaced disagreement before their decision. For workspace-internal cases your workspace owns that data; public-network cases keep the aggregate-only view.",
    responsibility:
      "You remain responsible for correctly interpreting the output within your domain, workflow, and context.",
    legalContext: "Relevant where a provider addresses Article 14(4)(c) interpretation.",
  },
  {
    id: "override",
    title: "Record the human decision",
    body: "Every go, revise, and stop decision is recorded against the case. Per-output override records carry a required reasons field and join the workspace audit chain, and the override rate is a first-class metric on the dashboard and in coverage exports.",
    responsibility: "You remain responsible for deciding when to disregard, override, or reverse an output.",
    legalContext: "Relevant where a provider addresses Article 14(4)(d) disregard, override, or reversal.",
  },
  {
    id: "stop",
    title: "Control intervention and stop",
    body: "Only a verified host adapter that controls delivery can establish that an eligible output stayed undelivered until a person decided. No host currently holds that tier. Ordinary Codex, plugin, and MCP integrations are advisory: they report the review lifecycle but do not verify interception or withheld delivery. RateLoop's workspace stop blocks new review-triggered release authorizations; a verified host must honor that state at delivery, while an advisory host can bypass it. Releasing the stop restores no agent grant automatically.",
    responsibility: "You remain responsible for choosing which outputs are gated, when to intervene, and when to halt.",
    legalContext: "Relevant where a provider addresses Article 14(4)(e) intervention or stop controls.",
  },
] as const;

export default function HumanOversightPage({ params }: { params?: PublicLocaleParams } = {}) {
  const locale = usePublicLocale(params);
  return (
    <LocalizedPublicContent locale={locale} section="docs">
      <article className="prose max-w-none">
        <DocsTitle gradientText="Accountable Oversight">Configure</DocsTitle>
        <p className="lead text-base-content/60 text-lg">
          Article 26(2) requires deployers of high-risk AI systems to assign oversight to people with the necessary
          competence, training, authority, and support. RateLoop can support that configured workflow and record its
          operation; your organization selects, authorizes, and supports the people who perform it.
        </p>

        <h2 id="reviewer-lanes">Start with who has authority</h2>
        <p>
          Customer-invited reviewers can be people your organization designates and authorizes for its oversight
          workflow. RateLoop records the scope you assign to them, but your organization remains responsible for their
          competence, training, authority, and support. A RateLoop-network reviewer is not designated by your
          organization and has no authority over your system. Network review is supplementary quality input, not your
          Article 26(2) oversight.
        </p>

        <aside className="not-prose my-8 rounded-2xl border-l-2 border-[var(--rateloop-yellow)] bg-warning/[0.06] p-5 sm:p-6">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[var(--rateloop-yellow)]">
            Shared responsibility
          </p>
          <p className="mt-3 max-w-4xl text-base font-semibold leading-7 text-base-content sm:text-lg">
            Your people provide oversight. RateLoop supports the configured workflow and records its evidence.
          </p>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-base-content/75 sm:text-base">
            RateLoop does not determine whether the EU AI Act applies or establish compliance. That depends on your
            system, role, context, organization, and operation. RateLoop operates around your AI system; only a verified
            host integration can enforce its review state at the output boundary. No host currently holds that tier.
          </p>
        </aside>

        <h2 id="deployer-duty">The deployer&apos;s people and process</h2>
        <p>
          RateLoop records oversight designations with competence basis, training completed, authority scope, and
          expiry. It records the reviews, decisions, overrides, and stops those people make. These records can support
          your evidence of how oversight was organized; they do not decide whether the Act applies or establish that the
          people or process meet Article 26(2).
        </p>
        <p>
          <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng#art_26" rel="noreferrer" target="_blank">
            Article 26(3)
          </a>{" "}
          preserves the deployer&apos;s freedom to organize its own resources and activities. That is consistent with
          using an outside service, but it does not turn an outside reviewer into your authorized oversight person; your
          organization must still make and support the designation required by Article 26(2).
        </p>

        <h2 id="provider-design-duty">If you also provide the AI system</h2>
        <p>
          Article 14 binds the provider of a high-risk AI system. It requires the system to be designed and developed so
          that natural persons can effectively oversee it. RateLoop operates around the customer&apos;s system and does
          not by itself satisfy that provider design duty. The capabilities below may support an oversight process for a
          system that was designed to expose the necessary controls and information.
        </p>
        <p>
          A customer that is also the system provider should address{" "}
          <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng#art_25" rel="noreferrer" target="_blank">
            Article 25(4)
          </a>{" "}
          only where RateLoop supplies services used or integrated in that high-risk system. In that case the provider
          and RateLoop must document the required information, capabilities, technical access, assistance, and relevant
          expertise in a written agreement. The supplier schedule in the <Link href="/legal/terms">service terms</Link>{" "}
          records that boundary; it is not an attestation or a claim that RateLoop is integrated into every customer
          system.
        </p>

        <h2 id="workflow-controls">Controls the workflow exposes</h2>
        <div className="not-prose my-8 grid gap-4">
          {OVERSIGHT_SECTIONS.map((section, index) => (
            <Card
              as="section"
              variant="marketing"
              key={section.id}
              id={section.id}
              className="rounded-2xl border-l-2 p-5 sm:p-6"
            >
              <p className="font-mono text-xs text-base-content/55">Capability {String(index + 1).padStart(2, "0")}</p>
              <h3 className="mt-2 text-lg font-bold text-base-content">{section.title}</h3>
              <p className="mt-3 text-sm leading-7 text-base-content/65">{section.body}</p>
              <p className="mt-3 text-sm font-semibold leading-7 text-base-content/75">{section.responsibility}</p>
              <p className="mt-3 text-xs leading-6 text-base-content/55">{section.legalContext}</p>
            </Card>
          ))}
        </div>

        <h2 id="designation-and-literacy">Designation, competence, and literacy</h2>
        <p>
          Article 26(2) requires oversight to be assigned to natural persons with competence, training, and authority.
          RateLoop records oversight designations with attestation records — competence basis, training completed, and
          authority granted — exportable as an assignment record, and emits audit events on every role assignment and
          change. Reviewer and oversight-person training and calibration records can support measures under Article 4 to
          develop sufficient AI literacy. Choosing those people, supporting their literacy, and ensuring their
          competence, training, and authority remains yours.
        </p>
        <p>
          Audit and evidence exports map to the Commission&apos;s draft Article 73 serious-incident reporting template —
          labelled draft-aligned until the template is final — and the workspace&apos;s oversight configuration exports
          as a factual description of the implemented oversight measures, usable as input for an Article 27
          fundamental-rights impact assessment.
        </p>

        <p>
          The shared-responsibility matrix and the exportable evidence behind each capability live on{" "}
          <Link href="/docs/evidence">Evidence reference</Link>.
        </p>
      </article>
    </LocalizedPublicContent>
  );
}
