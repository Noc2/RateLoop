# Evidence & Compliance Mapping

RateLoop records a bounded human-review run as an integrity-bearing packet. The packet describes the frozen review
scope, the human judgments, privacy-safe coverage and latency statistics, available settlement references, and explicit
limitations. It is evidence about operation of the review policy, not an automatic decision.

## Shared responsibility

Your people provide the oversight. RateLoop provides the instrument — and the proof.

Whether a specific deployment meets a legal requirement depends on your system, context, and organization — you
configure and operate RateLoop for your purpose; RateLoop provides the capabilities and the evidence.

| Requirement                    | RateLoop provides                                                                                                                                                                  | You remain responsible for                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Art 14(4)(a) · Monitor         | An oversight dashboard (sampling, latency, disagreement, blocked outputs), in-app, email, and browser alerts, event webhooks, and per-agent capability cards.                      | Watching those surfaces, understanding the agent's capacities and limitations, and acting on anomalies. |
| Art 14(4)(b) · Automation bias | Independent blinded review panels, decision prompts with no preselected choice, and override-rate visibility for the deciding person.                                              | Staying aware of the pull to over-rely on the system and keeping each decision a considered one.        |
| Art 14(4)(c) · Interpret       | An owner case view with the actual output, source context, reviewer rationales, and surfaced disagreement before the decision.                                                     | Correctly interpreting the output within your domain, workflow, and context.                            |
| Art 14(4)(d) · Override        | Recorded go, revise, and stop decisions, plus per-output override records with required reasons on the audit chain.                                                                | Deciding when to disregard, override, or reverse an output.                                             |
| Art 14(4)(e) · Stop            | A fail-closed output gate — on host-enforced integrations output is held undelivered until a person decides — and a workspace stop control that halts new releases workspace-wide. | Choosing which outputs are gated, when to intervene, and when to halt.                                  |
| Art 26(2) · Assignment         | Oversight designations with attestation records — competence basis, training completed, authority granted — exportable as an assignment record.                                    | Choosing those natural persons and ensuring they are competent, trained, and authorized.                |
| Art 26(5) · Monitoring         | The same monitoring surfaces, coverage exports, and alerting, retained as workspace evidence.                                                                                      | Monitoring operation against your instructions for use and pausing use when risks appear.               |
| Art 26(6) · Log retention      | A six-month retention floor with retention export, scheduled enforcement, and legal hold.                                                                                          | Your full legal and contractual retention schedule beyond that floor.                                   |
| Art 4 · AI literacy            | Exportable training and calibration records for reviewers and oversight persons.                                                                                                   | Ensuring sufficient AI literacy across the staff who operate the system.                                |

RateLoop operates around your AI system, gating its outputs; it does not modify the system itself.
Execution provenance is host-reported and labelled so; RateLoop does not verify which model actually produced an
output. RateLoop does not market SOC 2 / ISO / HIPAA / residency attestations it does not hold, and no evidence
export by itself makes anyone compliant.

## Packet fields

Schema: `rateloop.human-assurance.evidence.v3`

- **Frozen scope:** exact run, suite, audience-policy, admission-policy, and manifest versions and hashes.
- **Review context:** selection trigger, delivery authority, gate type, reviewer-qualification counts, review period,
  coverage, and response latency.
- **Judgment evidence:** privacy-safe result counts, disagreement, failure-tag counts, rationale digests, case and
  response Merkle roots, and recomputation inputs.
- **Settlement:** available deployment, round, transaction, indexed-event, refund, compensation, and claim references.
- **Boundaries:** privacy classification, minimum aggregation size, suppressed cells, exclusions, and limitations.
- **Integrity:** Ed25519 key ID and public key, canonical packet digest, and signature.

Reviewer identities and raw or decryptable rationales are excluded. Host-reported execution metadata remains marked
`independentlyVerified:false`; it does not establish which model produced an output.

Redacted shape:

```json
{
  "payload": {
    "schemaVersion": "rateloop.human-assurance.evidence.v3",
    "tenantCommitment": "hmac-sha256:[redacted]",
    "frozen": {
      "runManifestHash": "sha256:...",
      "suiteManifestHash": "sha256:...",
      "policyHash": "sha256:..."
    },
    "reviewContext": {
      "selectionTrigger": { "kind": "owner_required" },
      "deliveryAuthority": { "mode": "workspace_authorized_member" },
      "gate": { "type": "advisory" },
      "reviewerQualifications": "[privacy-safe counts]",
      "period": { "coverage": "[counts]", "responseSubmissionLatencyFromPeriodStartMs": "[summary]" }
    },
    "roots": { "caseRoot": "sha256:...", "responseRoot": "sha256:..." },
    "aggregation": { "cases": "[privacy-safe counts]", "judgmentCoverage": "[counts]" },
    "settlement": { "mode": "[recorded mode]" },
    "chainEvidence": "[available source-derived references]",
    "limitations": "[explicit non-claims and suppressed cells]"
  },
  "signing": { "algorithm": "Ed25519", "keyId": "ed25519:..." },
  "packetDigest": "sha256:...",
  "signature": "[base64url]"
}
```

## How to check the evidence

1. Export the packet and obtain the expected key ID and public-key pin from the authenticated workspace key history.
   In the Evidence Center, select the packet and download its matching SPKI pin. Do not use the public key embedded in
   the same packet as its sole trust anchor.
2. Check the Ed25519 signature, canonical packet digest, case and response roots, privacy-safe aggregation, and frozen
   pass rule:

   ```sh
   yarn workspace @rateloop/nextjs evidence:verify ./packet.json \
     --public-key ./evidence-public-key.txt \
     --key-id ed25519:...
   ```

   Any reported error means the check failed.

3. When paid settlement evidence is present, compare the deployment key and block, chain ID, panel address,
   round-creation transaction hash, receipt block number and hash, execution state, and stored indexed-event fields with
   an independently selected Base RPC or indexer. The packet also records settlement mode, statement, and links; it does
   not embed a complete transaction receipt or independently recompute chain accounting. Missing chain evidence remains
   an explicit packet limitation.
4. Validate optional external receipts only when they are present. For a non-null Rekor bundle, select the intended log
   independently and check its UUID, index, inclusion data, and signed entry time. An absent bundle means there is no
   Rekor receipt. For a non-null TSA field, validate its RFC 3161 message imprint, certificate path, policy, and time
   against trust roots selected by your organization. An absent token means there is no TSA receipt.

Download a completed witness from its public attestation URL. Select the signer, Rekor log key, and TSA certificate
chain independently, pin the witness signer key ID, then run:

```sh
yarn workspace @rateloop/nextjs attestation:verify ./attestation-witness.json \
  --signer-public-key ./trusted-attestation-signer.pem \
  --signer-key-id ed25519:... \
  --rekor-public-key ./trusted-rekor-public-key.pem \
  --tsa-ca ./trusted-tsa-ca.pem \
  --tsa-chain ./trusted-tsa-chain.pem
```

The TSA arguments are required when `rfc3161` is non-null; omit them for a witness without a timestamp. The verifier
checks the DSSE signature and statement binding, Rekor body, signed entry timestamp and inclusion proof, and the RFC 3161
token when present.

The workspace audit chain is separate. Pin the expected head from another trusted record when possible:

```sh
yarn workspace @rateloop/nextjs audit:verify ./audit-export.json --expected-head sha256:...
```

## Export surfaces

```text
GET /api/account/workspaces/{workspaceId}/assurance/runs/{runId}/evidence
GET /api/account/workspaces/{workspaceId}/assurance/coverage/export
GET /api/account/workspaces/{workspaceId}/audit/export
GET /api/account/workspaces/{workspaceId}/assurance/trusted-keys
GET /api/account/workspaces/{workspaceId}/assurance/trusted-keys?format=spki&keyId=ed25519:...
GET /api/public/assurance/attestations/{jobId}
```

The workspace routes require an authorized workspace session. The public witness is digest-only and is retrievable only
by its opaque job ID. A workspace retention policy cannot be configured below six months. That product floor does not
determine the customer's legal or contractual retention schedule. Scheduled enforcement removes due private artifact
content and access logs unless a legal hold applies. Artifact digests, signed packets, witness and WORM receipts, and the
canonical audit chain remain as integrity records; deleting private content does not rewrite that history.

## Compliance map

Every mapping means **supports evidence for**. It is not an assessment result, legal opinion, certification, or assertion
that a customer's controls are implemented or effective.

| Official reference                                                                                                                                                   | RateLoop artifacts                                                                                   | Boundary                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ISO/IEC 42001:2023](https://www.iso.org/standard/81230.html), A.6 including A.6.2.8, and A.9.2                                                                      | Review packet, coverage export, audit chain, gate evidence, host-reported execution context          | Supports lifecycle, event-log, and responsible-use evidence; does not demonstrate control implementation, effectiveness, or certification.                                                      |
| [Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng), Articles 12, 14(3)(b), 14(4), 26(2), 26(5)-(6), 72, and 73                          | Review packet, coverage export, audit chain, gate evidence, host-reported execution context          | Supports your implementation and evidence of these duties; the duties remain yours.                                                                                                             |
| [NIST AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/), MEASURE and MANAGE                                                                          | Coverage, agreement, disagreement, latency, escalation, gate, exception, and follow-up records       | Supports measurement and risk-response evidence; is not a NIST assessment, endorsement, or risk-acceptance decision.                                                                            |
| [FINRA Regulatory Notice 24-09](https://www.finra.org/rules-guidance/notices/24-09) and [Rule 3110](https://www.finra.org/rules-guidance/rulebooks/finra-rules/3110) | Configured review, escalation, host-reported model metadata, outcomes, exceptions, and audit history | May be incorporated into a member firm's supervision records; does not establish or approve the supervisory system.                                                                             |
| [17 CFR 240.17a-4(f)](https://www.ecfr.gov/current/title-17/chapter-II/part-240/section-240.17a-4)                                                                   | Integrity-checkable review packets and workspace audit exports                                       | May be delivered into a separately compliant recordkeeping system; does not establish Rule 17a-4 conformance or replace the customer's storage, retention, undertakings, or production process. |

Machine-readable mapping: [`rateloop-human-assurance-component-definition.oscal.json`](./rateloop-human-assurance-component-definition.oscal.json),
pinned to OSCAL 1.2.2.
