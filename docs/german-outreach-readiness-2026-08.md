# Before pitching German companies — readiness list

Written 6 August 2026 against `d65c67183`, from four agent audits: an end-to-end product
walkthrough, a German commercial and legal review, a claim-integrity audit that re-ran the
in-product claim gate against the sales collateral, and a regulatory currency check.

This list is long because the gap is not in one place. The German *story* is ready and the
German *surface* is unusually good. The German *paper* is not, the *product* has one
working lane rather than the several the collateral implies, and the claim gate that
protects the website does not protect the deck.

Nothing here is legal or tax advice. Items marked **counsel** or **Steuerberater** should
not be drafted in-house.

## The decision that governs everything else

Two products can be described from this codebase, and only one of them exists.

**What ships today:** software that lets a company's own named experts review its own AI
output, initiated by an AI agent over MCP, with an exportable evidence record. Reviewers
are invited by the customer, unpaid, and supplied by the customer.

**What the collateral implies:** a human-assurance network with paid reviewers, USDC
settlement, proof-of-human admission and incentive mechanisms.

The second is weeks-to-months away and blocked by six frozen release capabilities plus a
qualified-timestamping procurement contract. Pitching it while shipping the first is the
fastest way to lose a German reference customer, because German enterprise buyers verify
before they sign, not after.

**Decide this first.** Every item below is easier once it is settled.

## Tier 0 — before you send a single email

These are cheap, and each one currently costs you credibility in the first five minutes.

### 0.1 The pitch URL lands on an empty reviewer inbox

`https://rateloop-tokenless.vercel.app/rate` does not render a product page.
[`rate/page.tsx:19-20`](../packages/nextjs/app/[locale]/(app)/rate/page.tsx) redirects
through `rateRedirectHref`
([`humanNavigation.ts:61-64`](../packages/nextjs/components/tokenless/human/humanNavigation.ts))
to `/human/review` — the **reviewer's work queue**. A German procurement lead following
that link sees "No review work is assigned to you right now."

Send prospects to `/` or `/agents`. This is a one-line change to what you paste into an
email, and it is the single highest-return item on this list.

### 0.2 The contact of record is a personal ProtonMail address

`hawigxyz@proton.me` is simultaneously the Impressum contact
([`imprint/page.tsx:44`](../packages/nextjs/app/[locale]/(public)/legal/imprint/page.tsx)),
the data-protection controller contact, the DPA instruction channel, the subprocessor
objection address, the cookies contact, and the Enterprise "Book demo" button
([`WorkspacePlanCards.tsx:148`](../packages/nextjs/components/pricing/WorkspacePlanCards.tsx)).

In Germany this reads as "not a real company" to a Rechtsabteilung or Einkauf. A domain
mailbox is an hour of work and changes how every legal document is received.

### 0.3 There is no working booking link

`TOKENLESS_DEMO_BOOKING_URL` is empty (`.env.example:290`), so "Book demo" falls back to
`mailto:` ([`demoBooking.ts:12-26`](../packages/nextjs/lib/marketing/demoBooking.ts)).

### 0.4 Two Impressum defects under § 5 DDG

The page correctly cites **§ 5 DDG** — the right statute, since DDG replaced TMG in May
2024 — and carries the company, Rechtsform, ladungsfähige Anschrift, Geschäftsführer,
`HRB 24975, Amtsgericht Bad Kreuznach`, and a § 18 Abs. 2 MStV responsible person. Two
things are missing:

- **No USt-IdNr.** Required by § 5 Abs. 1 Nr. 6 DDG *sofern vorhanden*, and you will need
  one to invoice EU B2B at all.
- **No second fast contact channel.** § 5 Abs. 1 Nr. 2 requires means of *unmittelbare
  Kommunikation* beyond email. Per **EuGH C-298/07**, email alone is insufficient; a
  contact form counts only if answered within roughly 30–60 minutes. A telephone number is
  the only unambiguously safe option. There is no phone number anywhere in the repo.

Also **delete the ODR paragraph** (`:65-80`). Regulation (EU) 2024/3228 repealed the ODR
Regulation and the platform shut on 20 July 2025 — the reference is now itself a defect.
The § 36 VSBG sentence applies only to Verbraucher and is unnecessary for pure B2B.

Exposure is not really the €50,000 Bußgeld ceiling; it is an Abmahnung plus a
strafbewehrte Unterlassungserklärung, typically €2,500–5,100 per repeat including an
accidental regression after a redesign.

### 0.5 The pricing page contradicts your own deck

The Kundenpitch quotes **€ 2.500 netto**. The live page shows **$29** with a struck-through
**$99** and a blanket 20% future discount
([`WorkspacePlanCards.tsx:24,81,94`](../packages/nextjs/components/pricing/WorkspacePlanCards.tsx),
[`terms/page.tsx:111`](../packages/nextjs/app/[locale]/(public)/legal/terms/page.tsx),
and both message catalogues). Your own Preisempfehlung lists removing these as steps 1–3
**"vor Outreach"**. They are still live in six places.

A prospect who opens the pricing page during your pitch sees a different offer than the
one you just made.

### 0.6 "sufficient AI literacy" is still shipped

Your own Vertriebsleitfaden § 8 flags this for correction before outreach. It is live in
`docs/human-oversight/page.tsx:152`, `docs/evidence/page.tsx:88`,
`public/docs/evidence.md:24`, and both catalogues at `:528` and `:630` — and it is locked
in by a test assertion at `docs/human-oversight/page.test.tsx:81`, so fixing it means
touching the test too. The Omnibus softened Article 4 to *taking measures to support the
development* of AI literacy, with an explicit statement that no specific level need be
guaranteed.

## Tier 1 — the claim problem

This is the most serious section, because it is the one that can end a deal after you have
already won it.

### 1.1 The claim gate is language-asymmetric, and your German collateral sits in the gap

The product has an unusually strong in-product claim gate: a capability map of nineteen
capabilities — sixteen hardcoded `false` — and eighteen regex rules that fail the build
when a public page or shipped doc makes a claim the deployment cannot support
([`publicEvidenceClaims.ts`](../packages/nextjs/lib/tokenless/publicEvidenceClaims.ts)).

**Only three of those eighteen rules carry German patterns** (`:107`, `:117`, `:250`), and
the verified-host caveat regex (`:324`) is English-only.

Run against the three `docs/sales/` binaries, the real matrix produces **zero violations**.
Translate six of their German claims into natural English and re-run, and
`signed_decision_packets_offline` fires immediately. Same claim. German passes silently;
English fails the build.

The gate also cannot see `.docx` or `.pptx` at all — there is no OOXML extraction anywhere
in the repo — and does not scan the root `README.md`, which is in the deployment-claim file
list for a different purpose but is never passed to the claim scan.

### 1.2 The specific claims to fix before the first conversation

| Where | Claim | Problem |
| ----- | ----- | ------- |
| Kundenpitch slide 5 | „Signiertes, exportierbares Paket" | German twin of a build-blocked English claim. `managed_evidence_signing`, `published_evidence_signing_key_history` and `offline_evidence_packet_verifier` are all `false` |
| Kundenpitch slides 4–5 | The Go/Revise/Stop decision is inside the signed packet | The product documents the opposite: the owner decision is a **separate** artifact (`public/docs/evidence.md:57`) |
| Vertriebsleitfaden ¶183 | „Erzeugt signierte, integritätsprüfbare Nachweispakete" | Sits in the guide's **"belastbar"** column — the document tells the salesperson this claim is safe. It is the German equivalent of a phrase that fails the build |
| Vertriebsleitfaden ¶155 | Offline verification as a **contractual success gate** | Worst possible placement for a gated claim |
| Vertriebsleitfaden ¶191 | „Pseudonyme pro Run" | Reviewer identities are excluded and pseudonymised, but per-run rotation is unconfirmed. Do not assert it |
| Root `README.md:3-4,14-16` | USDC payment, proof-of-human admission, RBTS, Surprisingly Popular | All unreachable; the mock-token caveat is 16 lines later under a different heading |

Note the mechanism for signing genuinely works — Ed25519 signing, a public unauthenticated
trusted-keys endpoint, a CLI verifier and a synthetic example packet all ship. The
capability flags mean "deployed and exercised for public claims", not "code exists"
(`:29-31`). So the honest form is to describe the mechanism and state that it has not been
externally exercised, rather than to claim the capability.

### 1.3 What is genuinely safe to say

Verified against shipped code. Use these.

- Policy, review question and options are frozen before assignments begin.
- Named invited reviewers judge independently, without seeing each other's answers.
- Go, Revise or Stop, the reasons and the disagreement are recorded.
- Reviewer identities and raw rationales are excluded from the export; small cells are
  suppressed.
- Private content is encrypted before storage — **and authorised RateLoop workloads can
  decrypt it. There are no customer-held keys.** (`ARTIFACT_PRIVACY.md:11`)
- Current integrations are advisory: they document the lifecycle but do not physically
  withhold any output. **No host currently holds the verified tier.**
- RateLoop makes nobody compliant. Your organisation judges applicability and adequacy.
- RateLoop holds no SOC 2, ISO 42001, HIPAA or residency attestation.
- Model identity is host-reported; RateLoop does not independently verify which model
  produced an output.
- The panel is your invited reviewers — not an independent or representative sample.

Your deck's slide 6 („LIEFERT NICHT") and the Vertriebsleitfaden's „Macht uns das
compliant?" → „**Nein.**" are the strongest claim discipline in the entire corpus. Keep
them verbatim.

### 1.4 Never say these, in either language

"Compliance-ready" · "RateLoop makes/keeps you compliant" · "garantiert Konformität" ·
"RateLoop is SOC 2 / ISO 42001 / HIPAA certified" · "RateLoop ist DSGVO-konform" ·
"RateLoop is your EU AI Act Article 14 or 26 human oversight" · "Unabhängige verblindete
Panels" · "manipulationssicher / tamper-evident" · "Independently witnessed" · "Feeds
Vanta, Drata and your SIEM" · "Kundengehaltene Schlüssel" · "Anonyme Prüfende" · any
population point estimate or confidence interval · any present-tense USDC, network,
hybrid or proof-of-human claim.

## Tier 2 — the product gap

### 2.1 There is no way for a human to request a review

`/ask` is a redirect stub
([`ask/page.tsx:4-7`](../packages/nextjs/app/[locale]/(app)/ask/page.tsx)). There is no
compose form anywhere. Reviews exist only through the MCP tool `rateloop_request_review`,
or through `POST /api/agent/v1/asks` — which requires a bounty above zero, rejects private
visibility, and calls `requireWorkspacePaidPanels`, making it **unusable today by
construction**.

**The product cannot be evaluated in a browser.** A Mittelstand buyer who wants to try it
by clicking cannot. This is the single biggest commercial gap in the product, and it is
what makes every demo depend on you alt-tabbing into an IDE.

### 2.2 A live demo can visibly return "inconclusive"

Resolution requires `responseCount === panelSize` — **every assigned reviewer must
answer** ([`privateReviewResponses.ts:621`](../packages/nextjs/lib/tokenless/privateReviewResponses.ts)).
Default panel size is 2, default window 3600 s. A tie is `inconclusive`; a deadline passing
without full quorum is forced `inconclusive`.

At the default, one slow or disagreeing reviewer produces "inconclusive" in front of the
prospect. Pre-stage the demo or do not run it live.

### 2.3 The API never returns the reasons

`rationale: { summaryAllowed: false, aggregateSummary: null }` is **hardcoded**
([`privateReviewResponses.ts:742`](../packages/nextjs/lib/tokenless/privateReviewResponses.ts)).
The customer's agent receives an outcome enum only.

The landing page promises "Results keep the question, verdict, **reasons**, disagreement,
and review context together"
([`page.tsx:29-31`](../packages/nextjs/app/[locale]/(public)/page.tsx)). An enterprise
buying auditable human oversight wants the rationale text. Either ship it or stop
promising it — and note that showing the landing page and then the API response in the same
meeting exposes the gap directly.

### 2.4 The setup chain before a first review is long and unguided

[`privateReviewFoundation.ts:183-402`](../packages/nextjs/lib/tokenless/privateReviewFoundation.ts)
requires all of: an active agent integration bound to an approved, non-superseded
human-review binding matching an exact profile hash; an owner-approved publishing policy
with `panel:publish` scope; an active private project; a review request profile that is
`ready` and approved; an active private group; and an active `customer_invited` cohort.
Then each reviewer needs an active row, a live access grant covering the project and data
classification through the deadline, and cohort membership with capacity headroom.

There is no guided wizard past the initial connect step.

### 2.5 Everything visible will be empty

Dashboards render "No decisions in this period.", "No completed cases in this period.",
"No active reviewers yet.", "No evaluations yet". The reviewer profile renders **nothing at
all** — no explanatory text — where paid work would be
([`HumanProfileContent.tsx:11-40`](../packages/nextjs/components/tokenless/human/HumanProfileContent.tsx)).
Landing-page social proof is filtered out rather than shown as zero, so there is no
traction claim at all. Selecting a paid or network review path throws "Dieser Prüfpfad ist
noch nicht verfügbar."

### 2.6 Chain inspection leads somewhere you do not want to go

Contracts resolve to Base Sepolia with a `MockERC20` "TestUSDC". Do not invite
blockchain-literate questions, and do not describe settlement in the present tense.

## Tier 3 — nobody can pay you

Four independent gates, each fatal on its own.

1. **`TOKENLESS_SUBSCRIPTIONS_ENABLED=false`** (`.env.example:278`). Checkout throws 503;
   the UI shows "Online upgrades are temporarily unavailable."
2. **No Stripe credentials exist** — no secret, no webhook secret, no price ID.
3. **Nobody can be marked a verified business.** `requireVerifiedBusinessCustomer` gates
   checkout, top-ups and paid panels. Its only writer,
   `recordOperatorBusinessVerification`
   ([`businessCustomerEligibility.ts:136`](../packages/nextjs/lib/billing/businessCustomerEligibility.ts)),
   has **no route, no UI and no script** — zero non-test callers, deliberately
   (`:131-135`). Even with Stripe fully live, every checkout returns 403.
4. **The deployment is code-forbidden from live money.** The readiness script fails the
   deploy if `STRIPE_SECRET_KEY` starts with `sk_live_`
   ([`check-tokenless-production-readiness.mjs:657`](../packages/nextjs/scripts/check-tokenless-production-readiness.mjs)).
   Taking real money means promoting to `main`, which trips all six frozen release
   capabilities.

**And the currency is wrong.** Pricing is USD-only and hard-enforced (`currency: "usd"` in
three places), and prepaid top-ups require `us_bank_transfer`
([`stripe.ts:60`](../packages/nextjs/lib/billing/stripe.ts)). **A German company cannot
SEPA-transfer you money.** Every German document prices in EUR netto and promises SEPA.

So the €2,500 pilot will be hand-invoiced outside the product — and there is no
§ 14-compliant invoice template anywhere in the repo.

### 3.1 VAT items to settle before invoicing

- **§ 14a Abs. 1**: invoice by the 15th of the following month, carrying **both VAT IDs**.
- **§ 14a Abs. 5**: the invoice must state **"Steuerschuldnerschaft des
  Leistungsempfängers"**.
- **Validate the customer's USt-IdNr.** via the BZSt § 18e qualifizierte
  Bestätigungsabfrage and store the response. Today validation is a format check only
  ([`fieldFormats.ts:50-55`](../packages/nextjs/lib/validation/fieldFormats.ts)) — no
  country prefix, no checksum, no VIES, no BZSt. If the ID turns out invalid the Finanzamt
  can treat the supply as domestic, assess 19% out of consideration you already received,
  and add § 233a interest.
- **ZM quarterly by the 25th** (§ 18a Abs. 2). Nothing tracks per-customer
  intra-Community turnover.
- **Ask a Steuerberater** about a USD-denominated invoice carrying German VAT — the
  conversion question under § 14 Abs. 4 Nr. 8 is unresolved and is a further argument for
  EUR.

Stripe Tax itself is wired thoughtfully: `automatic_tax` on both paths, `tax_id_collection`
enabled, required billing address, and a careful invariant preventing an absent VAT ID on a
top-up from silently dropping reverse charge from subscription renewals
([`stripe.ts:187-220`](../packages/nextjs/lib/billing/stripe.ts)).

## Tier 4 — the paper German procurement will actually ask for

### 4.1 The Terms page has no commercial contract clauses at all

Counted across the whole file: **liability 0, warranty 0, governing law 0, jurisdiction 0,
indemnity 0, IP 0, SLA 0, force majeure 0, termination 0, severability 0.**

In Germany this is the worst configuration, not a neutral one:

- **SaaS is Mietvertrag** (BGH 15.11.2006 – XII ZR 120/04). Therefore **§ 536 BGB:
  Minderung tritt kraft Gesetzes ein.** With no SLA defining availability you owe **100%
  availability**, and every minute of downtime reduces the fee automatically — no notice,
  no fault. An SLA's primary legal job in Germany is to be the Beschaffenheitsvereinbarung
  that defines what a Mangel *is*.
- **§ 536a Abs. 1 Alt. 1 BGB** imposes verschuldensunabhängige Garantiehaftung for defects
  present at contract conclusion. This can be excluded in B2B AGB and should be. It is the
  most common defect in English-origin SaaS terms used in Germany.
- **No cap means unlimited statutory liability.** § 310 Abs. 1 S. 2 BGB gives §§ 308/309
  Indizwirkung in B2B, and § 306 Abs. 2 forbids geltungserhaltende Reduktion — so one
  bad formulation voids the whole clause and drops you back to unlimited. This is why
  German liability clauses are structurally verbose, and why this must be **counsel-drafted**.
- **Kollidierende AGB.** German buyers send Einkaufsbedingungen with an Abwehrklausel;
  courts apply the Restgültigkeitstheorie, so conflicting clauses on both sides fall away
  and dispositives Recht applies — your cap disappears. The only reliable defence is a
  **signed order form with a Rangfolgeklausel**.

Also: the Early Access price clause (`terms/page.tsx:109-114`) is a Preisanpassungsklausel
facing double control under § 307 and the Preisklauselgesetz; it needs objective,
verifiable adjustment factors.

### 4.2 The three documents that must physically exist

| Document | Status | Why |
| -------- | ------ | --- |
| **Pilot-Order-Form (Auftragsformular)** | Does not exist, though `dpa/page.tsx:26` and the Terms both reference "a signed order form" as controlling | 1–2 pages: parties, Leistungsumfang, EUR netto zzgl. USt., Zahlungsziel, Laufzeit, Datenarten, stop conditions, deletion, **Rangfolgeklausel** |
| **Signable German AVV PDF** | Only a web page | Art. 28(9) permits Textform, but the buyer's Art. 5(2) Rechenschaftspflicht file needs a signed, dated, versioned PDF. Needs a signature block, liability alignment, named Weisungsberechtigte |
| **Versioned TOM annex PDF** | Five bullets on a page | German DPOs call the TOM annex *"das Herzstück des AVV"* and check it first |

The DPA's **substance** is genuinely good — it maps cleanly onto Art. 28(3)(a)–(h), the
subprocessor mechanics (30 days' notice, 14-day objection, terminate if no alternative)
match what German buyers accept, and the audit clause states outright that you hold no
SOC 2 or ISO report. It is the *form* that fails.

### 4.3 The TOM annex needs rebuilding

Current: five bullets (`dpa/page.tsx:173-195`). Expected: the **hybrid** structure —
Art. 32 Schutzziele at the top level, mapped underneath to the eight classic controls from
the repealed Anlage zu § 9 BDSG a.F. (Zutritts-, Zugangs-, Zugriffs-, Weitergabe-,
Eingabe-, Auftrags-, Verfügbarkeits-, Trennungskontrolle), which German DPOs still tick
off from memory.

Missing entirely: Zutrittskontrolle, Eingabekontrolle, Auftragskontrolle,
Trennungskontrolle, and the Art. 32(1)(d) review cadence. Also missing are the specifics
that make an annex pass rather than read as marketing: named algorithms (AES-256,
TLS 1.3), backup frequency and retention, RTO/RPO, log retention, pentest cadence and
provider.

Ship it as **page + versioned dated PDF** (`TOM v1.0, Stand …`) referenced in the AVV by
version, with a no-material-reduction undertaking and a version archive.

### 4.4 The subprocessor table is missing three columns

It lists provider, purpose and when used. German DPOs will ask for **corporate seat,
country of processing, and per-provider transfer mechanism**. Vercel and Railway are US
entities, and the residency claim is qualified — *"RateLoop selects EEA hosting regions
where the deployed provider and feature support them"*.

Add DPF certification status per provider, **pre-signed dormant SCCs** (Implementing
Decision (EU) 2021/914, Module 2 or 3) and a **TIA**. This matters more in 2026 than it did
in 2024: DPF adequacy survived the General Court on 3 September 2025, but **Latombe's
appeal is pending as C-703/25 P**, so German DPOs want belt and braces. EDPB Opinion
22/2024 additionally requires the controller to know every entity in the nested chain.

Be ready for one specific question: your subprocessor list includes Sigstore's **public
Rekor transparency log**. A public append-only log invites DSGVO questions. Have the
answer prepared — what is published is a signed digest, not personal data.

### 4.5 Procurement artifacts, in the order they get asked for

| Artifact | Status |
| -------- | ------ |
| ISO/IEC 27001 | None. The default German ask, amplified by NIS2 supply-chain duties |
| ISO/IEC 42001 | **Mapped, not certified.** Do not let the map be read as certification |
| Penetration test report | None. **Highest return per euro of anything on this list** for an uncertified vendor |
| Trust page / security whitepaper naming an EU hosting region | None |
| Pre-filled CAIQ or SIG Lite | None. Free, and usually short-circuits a bespoke questionnaire |
| TIA + dormant SCCs | None |
| Löschkonzept, BCM, Art. 30(2) Verzeichnis, cyber liability | None |
| BSI C5 / TISAX / SOC 2 | None — only pursue when a named, sized deal requires them |

The framing that works with an uncertified vendor: the buyer is discharging *its* own
obligation (NIS2, DORA Art. 28, GDPR Art. 28(1) "sufficient guarantees", AI Act Art. 26).
Give them the evidence for their file and the missing certificate becomes negotiable.

## What you already have and are under-selling

Verify each before saying it, but the code is real:

- **A complete German UI.** 3,981 message keys, **zero** missing German translations, and
  the legal pages fully localised with idiomatic terminology. Most competitors at this
  stage have machine-translated marketing and English legal pages. Lead with this.
- **SAML/OIDC SSO and SCIM**, admin-configurable in-product
  ([`betterAuth.ts:86-110`](../packages/nextjs/lib/auth/betterAuth.ts)).
- **Hash-chained append-only audit log** with `home_region: 'eu'` on every event and chain
  verification ([`audit.ts:169-293`](../packages/nextjs/lib/privacy/audit.ts)).
- **Frankfurt-pinned hosting** (`vercel.json` `"regions": ["fra1"]`).
- **A machine-readable OSCAL compliance map** mapping evidence artifacts to ISO/IEC 42001,
  NIST AI RMF, EU AI Act Art. 26(5)-(6) and Art. 73, and FINRA. Very few vendors this size
  ship this. **Two caveats before showing it** — see 6.1.
- **SIEM streaming** (CloudEvents + OCSF 1.8.0) and **GRC connectors** for Drata and Vanta
  — though neither delivery has been exercised, so describe the mechanism, not the
  capability.
- **A stated, dated security-questionnaire posture** that answers against deployed
  configuration rather than substituting a trust claim.

## What to add to make the product more attractive

Ordered by commercial return, not by size.

1. **A browser path to request a review** (2.1). Without it there is no self-serve
   evaluation and every demo is a screen-share of your IDE. Roughly 1–2 weeks.
2. **Return the reasons** (2.3). You already promise them. Enterprise buyers of auditable
   oversight consider this the product.
3. **A standalone evidence verifier** — two files, no repo checkout.
   `scripts/assurance-evidence-core.mjs` is 547 lines with exactly one internal import
   (`@rateloop/node-utils/jcs`) plus Node built-ins. Today verification requires cloning a
   private repo and running yarn; no interne Revision or Wirtschaftsprüfer will do that.
   **2–3 days for outsized credibility.**
4. **EUR pricing and SEPA** (Tier 3). Blocks recurring revenue entirely.
5. **An operator route to verify a business customer** (Tier 3, gate 3). Two to four days
   of code plus a documented KYB procedure, and it unblocks every payment path at once.
6. **A PDF export of the evidence record.** Exports are JSON/CSV only. German compliance
   functions want a signed PDF for the Prüfer.
7. **An in-app audit-log viewer.** Today the only surface is a JSON download link.
8. **Teams and Slack notification.** Zero hits repo-wide; only generic HMAC webhooks. Teams
   is near-mandatory for German enterprise.
9. **Localise transactional email** — at minimum the reviewer invitation, which is the
   first thing a German reviewer ever sees from you. All email is currently hardcoded
   English with `<html lang="en">`.
10. **A status page and a support channel with a stated response time.** Zero hits for SLA,
    uptime or 99.9% anywhere in the repo.
11. **Enforce plan limits** — the decision meter's only caller sits on an unreachable path,
    so Free and Early Access are functionally identical and nobody has a reason to upgrade.
12. **Guard against silent translation regressions.** `translateCatalogString` returns
    English when a phrase is missing. Coverage is 100% today and nothing keeps it there.

## What to verify with additional research before pitching

1. **Get a documented AI Act classification from the BNetzA KI-Servicedesk.** Free, and an
   authority-sourced classification is worth a great deal in an enterprise conversation.
   The Bundesnetzagentur became the central market surveillance authority with full effect
   from 2 August 2026.
2. **Confirm the works-council position.** German buyers will need a § 87 Abs. 1 Nr. 6,
   § 90 Abs. 1 Nr. 3 and § 95 Abs. 2a BetrVG pack — "what we log and what we do not". This
   is a common late-stage blocker and cheap to pre-empt.
3. **Check what an Art. 13(3) instructions-for-use pack must contain in German**, since
   deployer customers will ask for it: capabilities, limitations, accuracy metrics, input
   specs, how to interpret output and logs.
4. **Draft the Art. 25(4) compliance-cooperation annex before a buyer drafts it for you.**
   Buyers are lifting clauses from the Commission's MCC-AI.
5. **Confirm "Pseudonyme pro Run"** or drop it (1.2).
6. **Settle the pricing hypothesis.** The commercial research document and the German
   Preisempfehlung, written the same day, disagree on whether to keep the public $29
   anchor. One owner, one document.

## Two corrections to make in code, not in a document

These came out of the regulatory research and matter because they are claims a German
compliance buyer may actually check.

### 6.1 The FINRA citation is wrong

[`assuranceComplianceMap.mjs:208-218`](../packages/nextjs/config/assuranceComplianceMap.mjs)
maps "records of human review, configured escalation, model metadata … for a member firm's
supervision analysis" to **FINRA Regulatory Notice 24-09**. The notice supports none of
that — it is a reminder that existing rules apply to Gen AI, and its only mention of a
human is a parenthetical about compliance personnel receiving surveillance summaries. The
language actually relied on is from FINRA's **2026 Annual Regulatory Oversight Report**
(9 December 2025).

Separately, the same file cites bare `A.6` (`:132`), `MEASURE` (`:170`) and `MANAGE`
(`:180`) — whole ISO life-cycle objectives and whole NIST functions. That claims two of the
RMF's four functions. Narrow to A.6.2.6/A.6.2.8 and A.9.2, and to MEASURE 2.8, MEASURE 3.3,
MANAGE 2.4 and MANAGE 4.1, all of which the product genuinely evidences.

Worth knowing while you are there: **Rule 3110.07** is the strongest citation available to
this product and neither the map nor the legal analysis uses it. It requires evidence of
review to identify the reviewer, the item reviewed, the date and the action taken — a
binding, named record schema matching what you already emit, needing no new AI regulation.

### 6.2 The OSCAL map cites a superseded regulation

It cites Regulation (EU) 2024/1689 but not the **2026/1744** amendment already used
elsewhere in `docs/`. Add it.

## Ordering

If you do nothing else, do Tier 0 — it is a day of work and it changes the first
impression completely.

Then settle the product question at the top of this document, fix the claims in Tier 1, and
build the order form, the AVV PDF and the TOM annex. Those three documents plus a
penetration test are what stand between you and a credible first pitch, and only counsel
and the pentest need external parties.

Payment (Tier 3) can wait until a pilot is verbally agreed, since the first invoices will
be manual anyway — but not longer, because the second and third customers will not accept
a hand-written invoice in USD.
