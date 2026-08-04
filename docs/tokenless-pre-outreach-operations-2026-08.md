# Tokenless pre-outreach operations record

**Owner:** RateLoop operator

**Applies to:** `tokenless`, `rateloop-tokenless.vercel.app`, and the isolated
`rateloop-tokenless` Railway project

**Last reviewed:** 4 August 2026

This is the internal index and rehearsal procedure for a first customer conversation. It does
not replace the implementation plan, the public terms, a signed order, or a legal review. A
dated hosted release result must accompany it before anyone describes a capability as verified
in the live tokenless environment.

## Prospect-response index

Answer from the current source named below. Do not maintain a separate sales answer that can
drift from the product.

| Question                                       | Current source                                                                                                                                                                                                                                                                                                     | Bounded answer                                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What does RateLoop do?                         | [`packages/nextjs/public/docs/human-oversight.md`](../packages/nextjs/public/docs/human-oversight.md) and [`packages/nextjs/public/docs/use-cases.md`](../packages/nextjs/public/docs/use-cases.md)                                                                                                                | It records a configured human-review workflow and its evidence. It does not replace the customer's accountable decision-maker.                                                                                      |
| What evidence is produced?                     | [`packages/nextjs/public/docs/evidence.md`](../packages/nextjs/public/docs/evidence.md)                                                                                                                                                                                                                            | Current-schema packets bind policy, responses, aggregation, limitations, decision references, and available chain references. The packet signature and owner-decision digest have distinct verification boundaries. |
| Can a prospect verify an example?              | [`packages/nextjs/public/docs/examples/synthetic-evidence-v4.json`](../packages/nextjs/public/docs/examples/synthetic-evidence-v4.json), its [pinned public key](../packages/nextjs/public/docs/examples/synthetic-evidence-v4.spki.txt), and the [verification guide](../packages/nextjs/public/docs/evidence.md) | Yes, using fully synthetic data and the checked-in offline command. The example is not evidence from a customer deployment.                                                                                         |
| What personal data is processed?               | [`packages/nextjs/app/[locale]/(public)/legal/privacy/page.tsx`](<../packages/nextjs/app/[locale]/(public)/legal/privacy/page.tsx>)                                                                                                                                                                                | Use the current public notice; do not summarize data categories, roles, retention, or transfers from memory.                                                                                                        |
| What processor terms apply?                    | [`packages/nextjs/app/[locale]/(public)/legal/dpa/page.tsx`](<../packages/nextjs/app/[locale]/(public)/legal/dpa/page.tsx>)                                                                                                                                                                                        | The published DPA is the standard response, subject to the applicable signed order. It states controller/processor roles, security measures, assistance, deletion, transfer, and audit terms.                       |
| Which vendors receive data?                    | [`packages/nextjs/app/[locale]/(public)/legal/subprocessors/page.tsx`](<../packages/nextjs/app/[locale]/(public)/legal/subprocessors/page.tsx>)                                                                                                                                                                    | Distinguish core hosted subprocessors, feature-conditional providers, and independent services. Never imply that an unconfigured optional provider is active.                                                       |
| Which security assurance exists?               | DPA section 9 and the [evidence guide](../packages/nextjs/public/docs/evidence.md)                                                                                                                                                                                                                                 | Describe implemented controls and verifiable records. RateLoop does not currently claim a SOC 2, ISO, HIPAA, or residency attestation it does not hold.                                                             |
| What are the service limits?                   | [`packages/nextjs/app/[locale]/(public)/legal/terms/page.tsx`](<../packages/nextjs/app/[locale]/(public)/legal/terms/page.tsx>), current plan definitions, and the evidence guide                                                                                                                                  | State only enforced plan limits and the deployed workflow's actual limits. A review result represents participating reviewers, not a population or automatic compliance conclusion.                                 |
| Is checkout available?                         | `TOKENLESS_SUBSCRIPTIONS_ENABLED` plus the live pricing/settings UI                                                                                                                                                                                                                                                | Keep self-serve checkout unavailable until independent business verification and the full Stripe lifecycle have passed in the target environment. Offer a controlled pilot instead.                                 |
| Are enterprise identity and archives verified? | Dated test evidence for SSO/SCIM, project-auditor access, or WORM delivery                                                                                                                                                                                                                                         | The code surface is not proof of an operating integration. Say “available for controlled validation” unless a current environment-specific exercise exists. SCIM Groups are not supported.                          |

## Five-to-eight-minute demonstration

Use synthetic or customer-authorized, safely redacted content. Start at the product, not at an
architecture slide.

1. State the audience and problem: an accountable owner needs independent review before an
   agent output proceeds.
2. Connect one agent in a fresh isolated workspace and configure one review question with two
   invited reviewers.
3. Submit one synthetic output through the connected agent. Show the waiting state and who acts
   next.
4. Complete both independent reviewer responses. Do not expose one reviewer's answer to the
   other before submission.
5. Let the owner see the bounded result and choose go, revise, or stop without a preselected
   choice.
6. Open the evidence packet, create a seven-day share, and open it signed out. Point out the
   automatic verification result and the stated sample/privacy limitations.
7. Revoke the link and show the same generic unavailable response used for a wrong secret.
8. End with the prospect's intended workflow, the limits that apply to it, and a controlled
   pilot next step.

Keep WORM, SIEM, GRC, SCIM, chain internals, raw JSON, and protocol identifiers out of the first
path unless the prospect asks. Those capabilities demonstrate depth after the core loop is
understood.

## Rehearsal workspace lifecycle

The hosted core journey is the only release test allowed to create review responses. Its
account, isolation, and cleanup rules are defined in
[`packages/nextjs/e2e/hosted-auth/README.md`](../packages/nextjs/e2e/hosted-auth/README.md).

- Use the three dedicated synthetic owner/reviewer mailboxes and one newly created workspace per
  run. Never use a real customer's account or content.
- Give every rehearsal workspace a dated or random suffix. Never reuse ordinary development or
  customer records as a demo fixture.
- Use the real email-OTP, session, API, persistence, indexing, and Base Sepolia path. Hosted
  runtime fixtures and direct database edits remain prohibited.
- At the end, disconnect the agent, request workspace deletion through the product, sign out all
  accounts, and close the browser contexts. Retained evidence/audit records follow their normal
  policy; they are not reusable fixtures.
- If cleanup fails, confirm that no release run is active, locate the `Hosted E2E` workspace from
  the safe test attachment, and use the normal workspace deletion control. Never repair or erase
  the rehearsal with ad-hoc SQL.

For a live sales rehearsal, create a separate workspace with the same synthetic-content rule.
After the meeting, either delete it through the product or keep it as a dated read-only example
with an explicit owner and retention decision. Replace it before records become confusing; do
not “reset” it by mutating historical responses.

## Release evidence to record

Run the guarded sequence from the exact tokenless checkout:

```sh
E2E_EXPECTED_GIT_REF=tokenless \
E2E_EXPECTED_GIT_SHA="$(git rev-parse HEAD)" \
yarn next:e2e:hosted:release
```

The required secrets and mailboxes must be supplied by the controlled environment without being
printed. Record only:

- exact Git SHA and `tokenless` ref;
- Vercel deployment ID and canonical tokenless URL;
- Ponder deployment key and start block;
- keeper chain ID, deployment key, and start block;
- active `tokenless-v4` contract artifact identity;
- hosted smoke/core terminal status and safe artifact location; and
- cleanup status and any bounded limitation discovered.

Before and after publishing, follow the repository's tokenless isolation guard: record remote
`main` and `tokenless` SHAs, validate the Vercel project ID, inspect both the tokenless `/rate`
page and `rateloop.ai`, and prove that the legacy deployment did not move.

## Enterprise validation boundary

These checks do not block initial outreach when their controlled credentials or destinations do
not already exist. They do block a claim that the corresponding live integration is verified.

- **SSO/SCIM:** exercise verified domain ownership, SSO-only enforcement, provisioning,
  deprovisioning, and token revocation with a controlled provider. Record that SCIM Groups are
  unsupported.
- **Project auditor:** grant read/export access, read and export evidence, confirm mutation and
  generation are denied, revoke access, then confirm subsequent access is denied.
- **WORM delivery:** only with an existing controlled destination, deliver one synthetic object,
  compare its checksum, retrieve it, and record the provider retention result. Do not add a new
  storage provider solely for this rehearsal.
- **AI-CAIQ:** answer a control only when a current artifact above supports both the answer and
  its justification. An unanswered control is preferable to an unsupported claim.

## Stop conditions

Do not begin or continue a prospect demonstration when any of these is true:

- the app, Ponder, keeper, or contract deployment identities disagree;
- the deployed SHA is not the intended `tokenless` SHA;
- a CTA or sign-in path is broken;
- production fixtures or direct database intervention would be required;
- real personal/confidential content lacks explicit customer authorization and suitable
  redaction; or
- the intended claim exceeds the public DPA, privacy notice, terms, evidence guide, or recorded
  environment proof.
