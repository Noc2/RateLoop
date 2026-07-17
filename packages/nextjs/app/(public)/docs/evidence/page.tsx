import Link from "next/link";
import { DocsTitle } from "~~/components/docs/DocsTitle";

const PACKET_FIELDS = [
  {
    title: "Frozen scope",
    body: "Run, suite, audience-policy, admission-policy, and manifest versions are included with their exact hashes.",
  },
  {
    title: "Review context",
    body: "The selection trigger, delivery authority, gate type, reviewer-qualification counts, review period, coverage, and response latency describe how the check operated.",
  },
  {
    title: "Judgment evidence",
    body: "Privacy-safe result counts, disagreement, failure-tag counts, rationale digests, Merkle roots, and recomputation inputs bind the derived result to the stored judgments.",
  },
  {
    title: "Settlement and limits",
    body: "Available deployment, round, transaction, indexed-event, refund, compensation, and claim references sit beside explicit limitations and suppression rules.",
  },
] as const;

const OVERSIGHT_MATRIX = [
  {
    requirement: "Art 14(4)(a) · Monitor",
    provides:
      "An oversight dashboard (sampling, latency, disagreement, blocked outputs), in-app, email, and browser alerts, event webhooks, and per-agent capability cards.",
    yours: "Watching those surfaces, understanding the agent's capacities and limitations, and acting on anomalies.",
  },
  {
    requirement: "Art 14(4)(b) · Automation bias",
    provides:
      "Independent blinded review panels, decision prompts with no preselected choice, and override-rate visibility for the deciding person.",
    yours: "Staying aware of the pull to over-rely on the system and keeping each decision a considered one.",
  },
  {
    requirement: "Art 14(4)(c) · Interpret",
    provides:
      "An owner case view with the actual output, source context, reviewer rationales, and surfaced disagreement before the decision.",
    yours: "Correctly interpreting the output within your domain, workflow, and context.",
  },
  {
    requirement: "Art 14(4)(d) · Override",
    provides:
      "Recorded go, revise, and stop decisions, plus per-output override records with required reasons on the audit chain.",
    yours: "Deciding when to disregard, override, or reverse an output.",
  },
  {
    requirement: "Art 14(4)(e) · Stop",
    provides:
      "A fail-closed output gate — on host-enforced integrations output is held undelivered until a person decides — and a workspace stop control that halts new releases workspace-wide.",
    yours: "Choosing which outputs are gated, when to intervene, and when to halt.",
  },
  {
    requirement: "Art 26(2) · Assignment",
    provides:
      "Oversight designations with attestation records — competence basis, training completed, authority granted — exportable as an assignment record.",
    yours: "Choosing those natural persons and ensuring they are competent, trained, and authorized.",
  },
  {
    requirement: "Art 26(5) · Monitoring",
    provides: "The same monitoring surfaces, coverage exports, and alerting, retained as workspace evidence.",
    yours: "Monitoring operation against your instructions for use and pausing use when risks appear.",
  },
  {
    requirement: "Art 26(6) · Log retention",
    provides: "A six-month retention floor with retention export, scheduled enforcement, and legal hold.",
    yours: "Your full legal and contractual retention schedule beyond that floor.",
  },
  {
    requirement: "Art 4 · AI literacy",
    provides: "Exportable training and calibration records for reviewers and oversight persons.",
    yours: "Ensuring sufficient AI literacy across the staff who operate the system.",
  },
] as const;

const COMPLIANCE_ROWS = [
  {
    framework: "ISO/IEC 42001:2023",
    href: "https://www.iso.org/standard/81230.html",
    references: "A.6, including A.6.2.8, and A.9.2",
    artifacts: "Review packet, coverage export, audit chain, gate evidence, and host-reported execution context.",
    boundary:
      "Supports lifecycle, event-log, and responsible-use evidence; it does not demonstrate control implementation, effectiveness, or certification.",
  },
  {
    framework: "EU AI Act",
    href: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
    references: "Articles 12, 14(3)(b), 14(4), 26(2), 26(5)-(6), 72, and 73",
    artifacts: "Review packet, coverage export, audit chain, gate evidence, and host-reported execution context.",
    boundary: "Supports your implementation and evidence of these duties; the duties remain yours.",
  },
  {
    framework: "NIST AI RMF",
    href: "https://airc.nist.gov/airmf-resources/playbook/",
    references: "MEASURE and MANAGE",
    artifacts: "Coverage, agreement, disagreement, latency, escalation, gate, exception, and follow-up records.",
    boundary:
      "Supports measurement and risk-response evidence; it is not a NIST assessment, endorsement, or risk-acceptance decision.",
  },
  {
    framework: "FINRA",
    href: "https://www.finra.org/rules-guidance/notices/24-09",
    secondarySource: {
      label: "FINRA Rule 3110",
      href: "https://www.finra.org/rules-guidance/rulebooks/finra-rules/3110",
    },
    references: "Regulatory Notice 24-09 and Rule 3110",
    artifacts: "Configured review, escalation, host-reported model metadata, outcomes, exceptions, and audit history.",
    boundary:
      "May be incorporated into a member firm's supervision records; it does not establish or approve the supervisory system.",
  },
  {
    framework: "SEC Exchange Act records",
    href: "https://www.ecfr.gov/current/title-17/chapter-II/part-240/section-240.17a-4",
    references: "17 CFR 240.17a-4(f)",
    artifacts: "Integrity-checkable review packets and workspace audit exports.",
    boundary:
      "May be delivered into a separately compliant recordkeeping system; it does not establish Rule 17a-4 conformance or replace the customer's storage, retention, undertakings, or production process.",
  },
] as const;

const REDACTED_PACKET = `{
  "payload": {
    "schemaVersion": "rateloop.human-assurance.evidence.v3",
    "tenantCommitment": "hmac-sha256:[redacted]",
    "frozen": {
      "runManifestHash": "sha256:…",
      "suiteManifestHash": "sha256:…",
      "policyHash": "sha256:…"
    },
    "reviewContext": {
      "selectionTrigger": { "kind": "owner_required" },
      "deliveryAuthority": { "mode": "workspace_authorized_member" },
      "gate": { "type": "advisory" },
      "reviewerQualifications": "[privacy-safe counts]",
      "period": { "coverage": "[counts]", "responseSubmissionLatencyFromPeriodStartMs": "[summary]" }
    },
    "roots": { "caseRoot": "sha256:…", "responseRoot": "sha256:…" },
    "aggregation": { "cases": "[privacy-safe counts]", "judgmentCoverage": "[counts]" },
    "settlement": { "mode": "[recorded mode]" },
    "chainEvidence": "[available source-derived references]",
    "limitations": "[explicit non-claims and suppressed cells]"
  },
  "signing": { "algorithm": "Ed25519", "keyId": "ed25519:…" },
  "packetDigest": "sha256:…",
  "signature": "[base64url]"
}`;

export default function EvidencePage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Mapping">Evidence &amp; Compliance</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        RateLoop records a bounded human-review run as an integrity-bearing packet. The packet shows which review policy
        operated, what the panel returned, how coverage was measured, and which settlement references were available.
      </p>

      <aside className="not-prose my-8 rounded-2xl border-l-2 border-[var(--rateloop-yellow)] bg-amber-300/[0.06] p-5 sm:p-6">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[var(--rateloop-yellow)]">
          Shared responsibility
        </p>
        <p className="mt-3 max-w-4xl text-base font-semibold leading-7 text-base-content sm:text-lg">
          Your people provide the oversight. RateLoop provides the instrument — and the proof.
        </p>
        <p className="mt-3 max-w-4xl text-sm leading-7 text-base-content/75 sm:text-base">
          Whether a specific deployment meets a legal requirement depends on your system, context, and organization —
          you configure and operate RateLoop for your purpose; RateLoop provides the capabilities and the evidence.
        </p>
      </aside>

      <h2 id="shared-responsibility">Who provides what</h2>
      <div className="not-prose my-8 overflow-x-auto rounded-2xl border border-base-content/10">
        <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
          <thead className="bg-base-content/[0.05] text-base-content">
            <tr>
              <th className="px-4 py-3 font-semibold">Requirement</th>
              <th className="px-4 py-3 font-semibold">RateLoop provides</th>
              <th className="px-4 py-3 font-semibold">You remain responsible for</th>
            </tr>
          </thead>
          <tbody>
            {OVERSIGHT_MATRIX.map(row => (
              <tr key={row.requirement} className="border-t border-base-content/10 align-top">
                <td className="whitespace-nowrap px-4 py-4 font-mono text-xs font-semibold text-base-content">
                  {row.requirement}
                </td>
                <td className="px-4 py-4 leading-6 text-base-content/70">{row.provides}</td>
                <td className="px-4 py-4 leading-6 text-base-content/60">{row.yours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        RateLoop operates around your AI system, gating its outputs; it does not modify the system itself. Execution
        provenance is host-reported and labelled so; RateLoop does not verify which model actually produced an output.
        RateLoop does not market SOC 2 / ISO / HIPAA / residency attestations it does not hold, and no evidence export
        by itself makes anyone compliant. The capability-by-capability mapping behind each row lives on{" "}
        <Link href="/docs/human-oversight">Human Oversight</Link>.
      </p>

      <h2 id="packet">What an evidence packet contains</h2>
      <div className="not-prose my-8 grid gap-4 sm:grid-cols-2">
        {PACKET_FIELDS.map((field, index) => (
          <section key={field.title} className="rateloop-surface-card rounded-2xl border-l-2 p-5 sm:p-6">
            <p className="font-mono text-xs text-base-content/55">{String(index + 1).padStart(2, "0")}</p>
            <h3 className="mt-2 text-lg font-bold text-base-content">{field.title}</h3>
            <p className="mt-3 text-sm leading-7 text-base-content/65">{field.body}</p>
          </section>
        ))}
      </div>
      <p>
        Reviewer identities and raw or decryptable rationales are excluded. Small cells are suppressed according to the
        frozen minimum aggregation size. Host-reported execution metadata remains marked as not independently verified.
      </p>
      <details>
        <summary>Redacted packet example</summary>
        <pre>
          <code>{REDACTED_PACKET}</code>
        </pre>
      </details>

      <h2 id="verify">How to check the evidence</h2>
      <ol>
        <li>
          <strong>Signature and key pin.</strong> Export the packet and obtain the expected key ID and public-key pin
          from the authenticated workspace key history. In the Evidence Center, select the packet and download its
          matching SPKI pin. Never treat the public key embedded in the same packet as its own trust anchor. Then run:
          <pre>
            <code>{`yarn workspace @rateloop/nextjs evidence:verify ./packet.json \\
  --public-key ./evidence-public-key.txt \\
  --key-id ed25519:…`}</code>
          </pre>
        </li>
        <li>
          <strong>Merkle roots and recomputation.</strong> The same command checks canonical packet hashing, the case
          and response roots, privacy-safe aggregation, and the frozen pass rule. Treat any reported error as a failed
          check.
        </li>
        <li>
          <strong>Chain references.</strong> For a packet that includes paid settlement evidence, compare its deployment
          key and block, chain ID, panel address, round-creation transaction hash, receipt block number and hash,
          execution state, and stored indexed-event fields with an independently selected Base RPC or indexer. The
          packet also records settlement mode, statement, and links; it does not embed a complete transaction receipt or
          independently recompute chain accounting. Missing chain evidence stays an explicit packet limitation.
        </li>
        <li>
          <strong>Optional external receipts.</strong> When a completed attestation includes a non-null Rekor bundle,
          select the intended log independently and check its UUID, index, inclusion data, and signed entry time. An
          absent bundle means there is no Rekor receipt. When the separate TSA field is non-null, validate its RFC 3161
          message imprint, certificate path, policy, and time against trust roots selected by your organization. An
          absent token means there is no TSA receipt.
        </li>
      </ol>
      <p>
        Download a completed witness from its public attestation URL. Select the signer, Rekor log key, and TSA
        certificate chain independently, pin the witness signer key ID, then run:
      </p>
      <pre>
        <code>{`yarn workspace @rateloop/nextjs attestation:verify ./attestation-witness.json \\
  --signer-public-key ./trusted-attestation-signer.pem \\
  --signer-key-id ed25519:… \\
  --rekor-public-key ./trusted-rekor-public-key.pem \\
  --tsa-ca ./trusted-tsa-ca.pem \\
  --tsa-chain ./trusted-tsa-chain.pem`}</code>
      </pre>
      <p>
        The TSA arguments are required when <code>rfc3161</code> is non-null; omit them for a witness without a
        timestamp. The verifier checks the DSSE signature and statement binding, Rekor body, signed entry timestamp and
        inclusion proof, and the RFC 3161 token when present.
      </p>
      <p>
        The workspace audit chain is a separate export. Pin its expected head from another trusted record when possible:
      </p>
      <pre>
        <code>{`yarn workspace @rateloop/nextjs audit:verify ./audit-export.json \\
  --expected-head sha256:…`}</code>
      </pre>

      <h2 id="exports">Export surfaces</h2>
      <pre>
        <code>{`GET /api/account/workspaces/{workspaceId}/assurance/runs/{runId}/evidence
GET /api/account/workspaces/{workspaceId}/assurance/coverage/export
GET /api/account/workspaces/{workspaceId}/audit/export
GET /api/account/workspaces/{workspaceId}/assurance/trusted-keys
GET /api/account/workspaces/{workspaceId}/assurance/trusted-keys?format=spki&keyId=ed25519:…
GET /api/public/assurance/attestations/{jobId}`}</code>
      </pre>
      <p>
        The workspace routes require an authorized workspace session. The public witness is digest-only and is
        retrievable only by its opaque job ID. A workspace retention policy cannot be configured below six months, but
        that product floor does not determine the customer&apos;s legal or contractual retention schedule. Scheduled
        enforcement removes due private artifact content and access logs unless a legal hold applies. Artifact digests,
        signed packets, witness and WORM receipts, and the canonical audit chain remain as integrity records; deleting
        private content does not rewrite that history.
      </p>

      <h2 id="compliance-map">Compliance mapping</h2>
      <p>
        Every row means <em>supports evidence for</em>. It is a cross-reference, not an assessment result, legal
        opinion, certification, or assertion that a customer&apos;s controls are implemented or effective.
      </p>
      <div className="not-prose my-8 overflow-x-auto rounded-2xl border border-base-content/10">
        <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
          <thead className="bg-base-content/[0.05] text-base-content">
            <tr>
              <th className="px-4 py-3 font-semibold">Reference</th>
              <th className="px-4 py-3 font-semibold">RateLoop artifacts</th>
              <th className="px-4 py-3 font-semibold">Boundary</th>
            </tr>
          </thead>
          <tbody>
            {COMPLIANCE_ROWS.map(row => (
              <tr key={row.framework} className="border-t border-base-content/10 align-top">
                <td className="px-4 py-4">
                  <a href={row.href} className="font-semibold text-base-content underline underline-offset-4">
                    {row.framework}
                  </a>
                  <span className="mt-1 block text-base-content/55">{row.references}</span>
                  {"secondarySource" in row ? (
                    <a
                      href={row.secondarySource.href}
                      className="mt-2 block text-xs text-base-content/60 underline underline-offset-4"
                    >
                      {row.secondarySource.label}
                    </a>
                  ) : null}
                </td>
                <td className="px-4 py-4 leading-6 text-base-content/70">{row.artifacts}</td>
                <td className="px-4 py-4 leading-6 text-base-content/60">{row.boundary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Download the machine-readable{" "}
        <a href="/docs/rateloop-human-assurance-component-definition.oscal.json">OSCAL 1.2.2 component definition</a>,
        or continue with <Link href="/docs/sdk#evidence-exports">SDK evidence exports</Link> and{" "}
        <Link href="/docs/smart-contracts#settlement-evidence">settlement evidence</Link>.
      </p>
    </article>
  );
}
