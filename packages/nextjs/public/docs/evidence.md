# Evidence & Compliance Mapping

RateLoop records a bounded human-review run as an integrity-bearing packet. The packet describes the frozen review
scope, the human judgments, privacy-safe coverage and latency statistics, available settlement references, and explicit
limitations. It is evidence about operation of the review policy, not an automatic decision.

## What this is not

RateLoop never claims: to be the customer's EU AI Act Article 14/26 human oversight (oversight must be assigned to the
deployer's own natural persons with "competence, training and authority"); to verify what model actually produced an
output (execution provenance is host-reported and labelled so); to make anyone "compliant" by itself; or to market SOC 2
/ ISO / HIPAA / residency attestations RateLoop does not hold.

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

1. Export the packet and obtain the expected key ID and public-key pin from a trusted workspace source. Do not use the
   public key embedded in the same packet as its sole trust anchor.
2. Check the Ed25519 signature, canonical packet digest, case and response roots, privacy-safe aggregation, and frozen
   pass rule:

   ```sh
   yarn workspace @rateloop/nextjs evidence:verify ./packet.json \
     --public-key ./evidence-public-key.txt \
     --key-id ed25519:...
   ```

   Any reported error means the check failed.

3. When paid settlement evidence is present, compare the deployment key, chain ID, contract, transaction receipt,
   indexed terminal event, and recomputed accounting with an independently selected Base RPC or indexer. Missing chain
   evidence remains an explicit packet limitation.
4. Validate optional external receipts only when they are present. For a non-null Rekor bundle, select the intended log
   independently and check its UUID, index, inclusion data, and signed entry time. An absent bundle means there is no
   Rekor receipt. For a non-null TSA field, validate its RFC 3161 message imprint, certificate path, policy, and time
   against trust roots selected by your organization. An absent token means there is no TSA receipt.

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
```

These routes require an authorized workspace session. A workspace retention policy cannot be configured below six
months. That product floor does not determine the customer's legal or contractual retention schedule.

## Compliance map

Every mapping means **supports evidence for**. It is not an assessment result, legal opinion, certification, or assertion
that a customer's controls are implemented or effective.

| Official reference                                                                                                                                                   | RateLoop artifacts                                                                                   | Boundary                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ISO/IEC 42001:2023](https://www.iso.org/standard/81230.html), A.6 including A.6.2.8, and A.9.2                                                                      | Review packet, coverage export, audit chain, gate evidence, host-reported execution context          | Supports lifecycle, event-log, and responsible-use evidence; does not demonstrate control implementation, effectiveness, or certification.                                                      |
| [Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng), Articles 12, 26(5)-(6), 72, and 73                                                  | Review packet, coverage export, audit chain, gate evidence, host-reported execution context          | May support a customer's logging, monitoring, retention, and incident work; does not satisfy or replace those duties.                                                                           |
| [NIST AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/), MEASURE and MANAGE                                                                          | Coverage, agreement, disagreement, latency, escalation, gate, exception, and follow-up records       | Supports measurement and risk-response evidence; is not a NIST assessment, endorsement, or risk-acceptance decision.                                                                            |
| [FINRA Regulatory Notice 24-09](https://www.finra.org/rules-guidance/notices/24-09) and [Rule 3110](https://www.finra.org/rules-guidance/rulebooks/finra-rules/3110) | Configured review, escalation, host-reported model metadata, outcomes, exceptions, and audit history | May be incorporated into a member firm's supervision records; does not establish or approve the supervisory system.                                                                             |
| [17 CFR 240.17a-4(f)](https://www.ecfr.gov/current/title-17/chapter-II/part-240/section-240.17a-4)                                                                   | Integrity-checkable review packets and workspace audit exports                                       | May be delivered into a separately compliant recordkeeping system; does not establish Rule 17a-4 conformance or replace the customer's storage, retention, undertakings, or production process. |

Machine-readable mapping: [`rateloop-human-assurance-component-definition.oscal.json`](./rateloop-human-assurance-component-definition.oscal.json),
pinned to OSCAL 1.2.2.
