# Tokenless interface language

This is the review standard for product copy on the tokenless application. Use one
term for one concept. A different term needs a real product, legal, security, or
operational distinction.

## Product terms

| Concept | Use | Do not use for this concept |
| --- | --- | --- |
| A completed human-review decision | **result** | evaluation, record, assurance, score |
| The decision state | **outcome**: pass, fail, or insufficient | result, score |
| A signed export for independent verification | **evidence packet** | result, audit trail, report |
| A signed assertion attached to evidence | **attestation** | evidence packet, result |
| Chronological workspace activity | **audit history** | evidence, result, audit trail |
| Reviewers assigned to one request | **reviewer panel** | UI panel, group |
| A bounded application surface | **section** | panel |
| Review the host can technically hold before release | **host-enforced review** | guaranteed review |
| Review the host may ignore | **advisory review** | advisory reviewer |
| Review without a guaranteed bounty | **unpaid review** | advisory review |
| The product workflow | **human assurance** | age assurance, verification |
| The eligibility control for age | **age check** | human assurance |
| Share of eligible decisions matching the configured positive answer | **reviewer endorsement** | accuracy, quality score |
| Pairwise reviewer answer alignment | **reviewer agreement** | reviewer endorsement, accuracy |

Never present one global agent score. Comparisons stay within an exact agent
version and a named scope. Reviewer statistics stay aggregate and rubric-level;
they never introduce a reviewer identity axis.

Use **Results** for the workspace destination containing completed decisions. Use
**Evidence** for signed packets, exports, verification, delivery, retention, and
trusted keys. Do not rename either destination until the planned tree test has
real participant results.

## Labels

Translate stored values into task language:

- `install_required` → **Finish installation**
- `approval_required` → **Approval needed**
- `private_invited` → **Invited reviewers**
- `public_network` → **RateLoop network**
- USDC atomic values → formatted **USDC**
- basis points → percentages
- opaque principal IDs → a known display name or **Workspace member**

Keep precise legal and verification terms when the user needs them: attestation,
DAC7, sanctions screening, terms hash, controller, processor, legal hold,
Ed25519, SPKI, Merkle, Rekor, and TSA. Put cryptographic implementation detail
inside the export-verification disclosure, not in the primary task path.

## Interface copy rules

| Situation | Use | Not |
| --- | --- | --- |
| Caveat the user must read | concise inline sentence | tooltip |
| Detail a minority need | one disclosure with a specific label | “Learn more” |
| Methodology or long-tail detail | descriptive docs link | duplicated in-app prose |
| Blocking problem | inline field error through `useFormErrors` | toast |
| Transient success | toast | persistent banner |
| Persistent state | banner | toast |

Tooltips are limited to icon-only controls and unit hints. Required consequences,
cost, permission, privacy, safety, and recovery information stays visible before
the user acts.

## Writing checks

- Make the heading name the task or state; remove repeated eyebrow labels.
- Prefer sentences of 25 words or fewer and paragraphs of five sentences or fewer.
- Start action labels with a verb and name the object.
- Show instructions only when their action exists.
- Show a disclaimer only in the branch where it is true.
- Replace internal enum names, validator paths, and release states before rendering
  server errors.
- Keep one message channel per event.
