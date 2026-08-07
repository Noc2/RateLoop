# Sales collateral — source of truth

**Every factual claim in this folder is sourced in
[quellen-und-belege.md](quellen-und-belege.md).** Read it before a customer conversation.
It marks each claim as primary source, retrieved, secondary or unverified, and it lists
what is still unverified so nobody mistakes an open item for a checked one.

The `.docx` and `.pptx` files in this folder are **build outputs**. The markdown files
beside them are the source. Edit the markdown, then rebuild the Office files from it.

That order matters for one specific reason. The product has a claim gate that fails the
build when a public page or shipped doc makes a claim the deployment cannot support
([`publicEvidenceClaims.ts`](../../packages/nextjs/lib/tokenless/publicEvidenceClaims.ts)).
**The gate cannot read `.docx` or `.pptx`, and only three of its eighteen rules carry German
patterns** — so this collateral is doubly invisible to it.

**But it is not the only blind spot, and treating it as one is how the last mistake
happened.** The gate scans public pages, message catalogues and `public/docs`. It does not
scan **any** of `docs/` — not this folder, not the business plan, not the readiness list.
Three days after the German collateral was corrected to stop claiming a signed,
offline-verifiable packet, the business plan asserted exactly that in English and nothing
caught it. Reviewing the markdown in a diff is the only control anywhere in `docs/`.

| Source | Build output |
| ------ | ------------ |
| [kundenpitch-2026-08.md](kundenpitch-2026-08.md) | `rateloop-deutschland-kundenpitch-2026-08.pptx` |
| [vertriebsleitfaden-2026-08.md](vertriebsleitfaden-2026-08.md) | `rateloop-deutschland-vertriebsleitfaden-2026-08.docx` |
| [preisempfehlung-2026-08.md](preisempfehlung-2026-08.md) | `rateloop-preisempfehlung-deutschland-2026-08.docx` |

**The Office files currently in this folder predate these corrections.** Rebuild them before
the next customer conversation.

## What changed on 6 August 2026, and why

A claim-integrity audit ran the real gate matrix against all three documents. It reported
zero violations — then the same six claims translated into English fired immediately. The
collateral was making, in German, claims the product refuses to print in English.

| Where | Was | Now |
| ----- | --- | --- |
| Pitch slide 5 | „Signiertes, exportierbares Paket" | „Rekonstruierbares Evidenzpaket" — slide 6's own wording |
| Pitch slides 4–5 | Go/Revise/Stop shown inside the signed packet | The owner decision is a **separate** record; the packet carries the review result |
| Leitfaden claim table | „Erzeugt signierte, integritätsprüfbare Nachweispakete" listed as *belastbar* | Moved to the caveat column with the mechanism wording |
| Leitfaden success gates | „offline prüfen" as a contractual gate | Restated as the CLI/browser procedure, not a guaranteed capability |
| Leitfaden | „Pseudonyme pro Run" | Removed pending confirmation |
| Pricing, all three | €2.500 pilot against a live public $29 page | Pilot is the entry price. **Update 7.8.2026: the public anchor has since been deleted and replaced with €0 / €2.500 netto. Only the in-product billing tab still shows $29.** |

## The three rules

**1. Describe the mechanism, never claim the capability.** The signing path works — Ed25519,
a public key endpoint, a CLI verifier, a browser verifier and a synthetic example packet all
ship. But the capability flags mean *"deployed and exercised for public claims"*, not *"code
exists"*, and they are false. So:

> „Der Export trägt eine Ed25519-Signatur und eine Key-ID. Wir veröffentlichen die
> zugehörigen öffentlichen Schlüssel an einem öffentlichen Endpunkt und liefern einen
> Verifier sowie ein synthetisches Beispielpaket. Wir vermarkten das noch nicht als
> verifizierte Fähigkeit, weil der Signaturpfad extern noch nicht erprobt wurde."

Not: „Signiertes, offline verifizierbares Nachweispaket."

**2. Never say these, in either language.** Forbidden regardless of any configuration:

„Compliance-ready" · „RateLoop macht Sie konform" · „garantiert Konformität" · „RateLoop ist
SOC-2-/ISO-42001-/HIPAA-zertifiziert" · „RateLoop ist DSGVO-konform" · „RateLoop ist Ihre
menschliche Aufsicht nach Art. 14 oder 26" · „Unabhängige verblindete Panels" ·
„manipulationssicher" · „Unabhängig bezeugt" · „Kundengehaltene Schlüssel" · „Anonyme
Prüfende" · jede Populations-Punktschätzung oder jedes Konfidenzintervall · jede
Gegenwartsaussage zu USDC, Netzwerk-Panels, Hybrid-Panels oder Proof-of-Human.

**3. Safe to say, verified against shipped code.** Policy and question are frozen before
assignment · named invited reviewers judge independently without seeing each other's answers
· Go/Revise/Stop, reasons and disagreement are recorded · reviewer identities and raw
rationales are excluded from the export and small cells suppressed · private content is
encrypted before storage **and authorised RateLoop workloads can decrypt it — there are no
customer-held keys** · integrations are advisory and withhold no output, and **no host holds
the verified tier** · RateLoop makes nobody compliant · RateLoop holds no SOC 2, ISO 42001,
HIPAA or residency attestation · model identity is host-reported and not independently
verified · the panel is your invited reviewers, not an independent or representative sample.

The strongest asset in the whole corpus is the boundary slide („LIEFERT NICHT") and the
Leitfaden's „Macht uns das compliant?" → „**Nein.**" Keep both verbatim.

## The pricing decision

**Public €0 Sandbox and the €2.500 pilot. No public recurring price until three pilots have
closed, then €1.200/Monat.** The €249 tier is deleted — break-even there needs 24–30
customers, and a €2.500 six-week pilot implies €1.667/Monat of value, so the two cannot both
be right.

All prices **netto zzgl. 19 % USt.**, invoiced in EUR, paid by SEPA. The product cannot
issue a EUR invoice or accept SEPA, so the pilot is invoiced by hand outside the product —
which needs no billing code and is the plan, not a workaround.

Before the first invoice: get the USt-IdNr. onto the Impressum, and validate the customer's
USt-IdNr. through the BZSt qualified confirmation.

## Before you send anything

**Re-verified against the code on 7 August 2026. Both blockers that stood here are gone,
and this folder is now 33 commits behind the product.** That is the wrong direction for a
document whose job is to stop us over-claiming: it now *under*-claims, which costs deals
instead of credibility.

| Was blocking | State on 7 August 2026 |
| ------------ | ---------------------- |
| Public pricing page shows $29 against a struck-through $99 | **Fixed.** [`WorkspacePlanCards.tsx`](../../packages/nextjs/components/pricing/WorkspacePlanCards.tsx) now renders Sandbox **€0** and Founding Pilot **€2,500** from [`foundingPilot.ts`](../../packages/nextjs/lib/marketing/foundingPilot.ts), with „All prices net of 19% VAT" and „Invoiced in euro by bank transfer". **Open the pricing page in a pitch — it is now an asset.** |
| „sufficient AI literacy" shipped in five places | **Fixed** in `376591ef1`. The wording is now „Taking measures to support the development of AI literacy… No specific level must be guaranteed for any individual", which is exactly how Regulation (EU) 2026/1744 amended Article 4. |
| `/rate` lands in the empty reviewer queue | **Fixed** in `47ab6ac67`. A bare `/rate` now redirects to the product page. |

**One place still shows dollars, and it is one click from the fixed page.** The in-product
billing tab renders `$0` and `$29` from the `free` and `early_access` plan records
([`WorkspaceSettingsClient.tsx:1040-1071`](../../packages/nextjs/components/tokenless/WorkspaceSettingsClient.tsx)),
and the pricing page's own „Start free" button sends the visitor to `/agents/billing`. So a
prospect reads €0 / €2,500 netto, clicks once, and lands on a USD $29 subscription card
that contradicts both the price and the currency. **Until that is fixed, do not click
through from the pricing page in a meeting.** It is the last surviving piece of the dollar
anchor and it is now the only pricing inconsistency a prospect can reach.

Cross-references to readiness items `0.5` and `0.6` have been removed from this folder:
those items shipped and were deleted from the readiness list, so the pointers were dangling.
[german-outreach-readiness-2026-08.md](../german-outreach-readiness-2026-08.md) remains the
companion to this folder and should be read first.
