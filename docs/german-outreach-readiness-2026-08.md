# Before pitching German companies — readiness list

Written 6 August 2026, last revised against `9a0bbdec1`. Sources: four audits of the
product and its collateral, then a second round covering internal consistency, German
enterprise procurement, the first-run journey, architecture health, and 2026 regulatory
change.

**Completed items have been removed rather than ticked.** Eleven readiness items and four
build items landed between `2853daf74` and `90b7b2d91` — the pitch URL, the ODR notice, the
pricing page, the AI-literacy wording, the README caveats, the reviewer-profile empty state,
reasons in the agent envelope, majority panel resolution, and the FINRA/ISO/NIST citations.
A further round through `9a0bbdec1` closed the dependency audit, four security gaps, the
`no_decision` and panel-size contract mismatches, the missing SIEM terminal events,
deployment-drift detection, inline evidence projection and the up-front paid-lane notice.
Each is a separate commit with tests. What remains is below.

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

### 0.1 The contact of record is a personal ProtonMail address

`hawigxyz@proton.me` is simultaneously the Impressum contact
([`imprint/page.tsx:44`](../packages/nextjs/app/[locale]/(public)/legal/imprint/page.tsx)),
the data-protection controller contact, the DPA instruction channel, the subprocessor
objection address, the cookies contact, and the Enterprise "Book demo" button
([`WorkspacePlanCards.tsx:148`](../packages/nextjs/components/pricing/WorkspacePlanCards.tsx)).

In Germany this reads as "not a real company" to a Rechtsabteilung or Einkauf. A domain
mailbox is an hour of work and changes how every legal document is received.

### 0.2 There is no working booking link

`TOKENLESS_DEMO_BOOKING_URL` is empty (`.env.example:290`), so "Book demo" falls back to
`mailto:` ([`demoBooking.ts:12-26`](../packages/nextjs/lib/marketing/demoBooking.ts)).

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

### 1.2 What is genuinely safe to say

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

### 1.3 Never say these, in either language

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

### 2.2 Demo with a panel of three, not the default two

Majority resolution shipped (B5), so a review now finalises as soon as ⌊n/2⌋+1 reviewers
agree rather than waiting for every assignee. **At the default panel size of 2 that changes
nothing** — the threshold is 2 — so a slow second reviewer still stalls the demo and a 1–1
split is still `inconclusive`, correctly, because it is a real tie.

**Configure the demo panel at 3.** Two agreeing reviewers then resolve immediately and the
third's silence is invisible, which is the behaviour worth showing. A genuine disagreement
still reads `inconclusive`; that is the honest answer and it is defensible in the room.

"Set the panel to 1" remains unavailable: the minimum of 2 is enforced server-side (now from
[`reviewPanelPolicy.ts`](../packages/nextjs/lib/tokenless/reviewPanelPolicy.ts)) and is a
code change, not a setting.

### 2.3 The setup chain before a first review is long and unguided

[`privateReviewFoundation.ts:183-402`](../packages/nextjs/lib/tokenless/privateReviewFoundation.ts)
requires all of: an active agent integration bound to an approved, non-superseded
human-review binding matching an exact profile hash; an owner-approved publishing policy
with `panel:publish` scope; an active private project; a review request profile that is
`ready` and approved; an active private group; and an active `customer_invited` cohort.
Then each reviewer needs an active row, a live access grant covering the project and data
classification through the deadline, and cohort membership with capacity headroom.

There is no guided wizard past the initial connect step.

### 2.4 Chain inspection leads somewhere you do not want to go

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
  Minderung tritt kraft Gesetzes ein** — it operates by law, with no declaration required
  and no fault needed. **But do not overstate it:** §536(1) sentence 3 disregards
  insignificant impairment, so "any downtime reduces the fee" is wrong, and §536(4) makes
  Minderung non-excludable only for residential tenancy — a B2B contract may limit or
  exclude it. The real exposure is that without an SLA the standard is whatever a court
  reads into "fitness for contractual use", which is uncertain rather than absolute. An SLA's primary legal job in Germany is to be the Beschaffenheitsvereinbarung
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

## The build list — what to implement before outreach

Ranked by commercial return **per hour of work**. Absolute impact differs and is noted.
Every item was checked against the code; several existing estimates moved once the code was
read properly.

### B4. A single-file offline verifier — ½ day

**Correction to an earlier estimate.** This was listed at 2–3 days on the belief that no
browser verifier existed. **One does, and it is public, unauthenticated, and verifies
without uploading the packet:** `/docs/evidence/verify`. It is the single most credible
thing you can put in front of a German compliance buyer today, and the earlier draft of this
document did not know it was there.

What remains is genuinely half a day: `assurance-evidence-core.mjs` has **one** import and
uses WebCrypto rather than `node:crypto`, and the only function needed from it needs no
hashing — so inline it, add a build check that the copy matches, and publish it as a
download. Then fix `evidence.md` and the evidence page, which currently tell the reader to
clone the monorepo and run `yarn workspace`.

*Unlocks:* an interne Revision or Wirtschaftsprüfer will not verify a vendor's signature by
visiting the vendor's own website. They want a file.

### B6. Operator business verification as a CLI script — ½ day

Not a route and not a UI. `recordOperatorBusinessVerification` already validates everything;
`migrate-hosted-database.mjs` is the pattern for a script that connects to the hosted
database behind an identity guard. A script also **preserves the documented design intent** —
the service deliberately has no customer-facing route — and needs no admin auth surface,
which does not exist in this repo.

*Honest caveat:* on its own it unblocks nothing. Stripe credentials, the subscriptions flag
and the USD/EUR problem all remain. High return per hour, zero return in 60 days unless the
others land.

### B7. Localise transactional email — 1 day

**The hard part is done:** `buildRateLoopEmailHtml` already takes every user-visible string
as a parameter; there is no embedded copy except `lang="en"` and the wordmark. Add a locale,
thread it to `lang`, move roughly eight strings per sender into the catalogues.

*Unlocks:* the reviewer invitation is the first thing a German reviewer ever sees from you,
and it is the artefact a prospect forwards to their own experts. English there undercuts the
complete-German-UI lead in the same motion.

### B8. A browser path to request a review — 4–8 days

The largest **absolute** return here, ranked eighth purely on cost.

**The cheap design:** do not build a parallel creation path. Resolve the workspace's existing
active agent integration, construct the same principal object the MCP tool builds, then call
`evaluateAdaptiveReviewRequirement` and `routeHumanReviewRequest` — the identical downstream
path. Everything after that is reused untouched.

Two bounded obstacles: the session principal carries no workspace ID (resolve from
membership, as every other workspace route does), and recording provenance honestly needs a
third `caller_credential_kind`, which means a **hand-authored** migration plus a journal
entry because `db:generate` and `db:push` are deliberately disabled. Budget half a day for
the migration alone.

### B9–B12, in order

- **Enforce the decision meter on the live lane** (1–2 days). Reserve at the delivery insert,
  consume at terminal state, passing `requiresPaidPanels: false`. **Note the correction in
  §2.5 — agent and group limits are already enforced**, so this makes the headline number
  real rather than making the plans differ at all.
- **PDF export of the evidence record** (2–3 days). The only item here that adds a
  dependency — there is no PDF tooling anywhere in the repo. Generate server-side from the
  existing case view, not HTML-to-PDF via a headless browser.
- **A status page** (½ day static). Do not publish an availability figure you cannot
  evidence — and note the German legal reason: with no *Beschaffenheitsvereinbarung* you owe
  an undefined availability standard that a court would have to construe, so a conservative
  stated figure is protective, not weak.
- **A translation-regression guard** (2 hours). Leaf counts are identical across `en` and
  `de` today; a recursive key-set equality assertion locks in your strongest asset. Note the
  failure mode is worse than assumed: `AgentsLocaleProvider` renders the **raw key string**
  on a miss, not English.

## Demo hardening — what is left

This list is spent. Majority resolution, inline evidence projection, the up-front paid-lane
notice, the reviewer-profile empty state and the `/rate` landing all shipped. One thing left,
and it is configuration rather than code:

**Set the demo workspace's panel size to 3.** See 2.2 — at the default of 2 the majority
threshold is also 2, so the slow-reviewer stall you were trying to remove is still there.

**Rehearse from `e2e/hosted/core-journey.spec.ts`.** It is a complete, green, three-account
two-reviewer private journey: connect, verify, invite, configure panel 2, request review,
both reviewers respond, fetch result. That file is your demo script — but raise its panel
size when you rehearse, for the reason above.

Two things not to do: do not open the pricing page until Tier 0.5 is done, and do not invite
chain questions.

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
6. **Verify two German sales levers before using them.** A BAFA consulting subsidy is
   reported to cover 50–80% on a basis of up to €3,500, which would place a €2,500 pilot
   fully inside a subsidised band — a strong Mittelstand lever if true, and unverified.
   Separately, no reliable source exists for the department-head approval threshold that the
   €2,500 price is often justified by; justify it from your own discovery instead.

The pricing hypothesis is no longer open — see 0.5. The Preisempfehlung was right and the
commercial research document has been removed, so `docs/sales/` and the business plan are
now the single owners of price.

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

## Tier 5 — what the second review round found

Five agents re-audited the product after the first round of fixes landed. These are new,
and several outrank items already on this list.

### 5.1 The works council is the deal blocker, not the paperwork

A product that records **which named human reviewed which AI output and when** is
objectively suitable for performance monitoring, and settled BAG doctrine reads
§ 87 Abs. 1 Nr. 6 BetrVG on objective suitability alone — intent is irrelevant.
Co-determination is enforceable; introduction without agreement can be enjoined.

Two things make this heavier than the earlier note suggested:

- **§ 80 Abs. 3 Satz 2 BetrVG**: where a works council must assess the introduction of AI,
  an external expert is **statutorily presumed necessary**. The employer cannot argue it
  away and pays for it. That inserts a third party who must be briefed and who will read
  your documentation.
- **§ 90 Abs. 1** requires the employer to inform the works council *rechtzeitig unter
  Vorlage der erforderlichen Unterlagen*, and it now names AI explicitly. **The buyer
  cannot satisfy this without documentation from you, and cannot do it after signing.**
  This is why deals stall between letter of intent and signature.

Realistically one to two quarters for a first-of-its-kind agreement; faster only if it can
roll under an existing framework agreement for IT systems. Do not put a number in
collateral — there is no defensible published figure, and a works council will read a
confident estimate as naive.

**What to build, because a contractual promise will not close a works council:**
aggregation thresholds, a switch that disables per-user reporting and leaderboards, and
pseudonymisation options. **What to write:** a field-level data catalogue, a roles and
permissions matrix, exactly what the audit trail records and who can query it, subprocessors
with jurisdictions including any LLM, and a change-notification commitment.

### 5.2 EU Data Act Chapter VI already applies, and Germany already enforces it

Regulation (EU) 2023/2854 has applied since 12 September 2025, and the German
implementing act (DADG) has been in force since 30 May 2026 with the Bundesnetzagentur as
competent authority. Assume you are in scope: the test is whether a customer can
self-provision, not company size.

Article 25 requires specific contract terms — **2 months maximum notice to switch, 30 days
maximum transition, 30 days minimum data retrieval afterwards, certified erasure, an
exhaustive exportable-data inventory**. Article 26 requires publishing the switching
procedure and formats. Article 28 requires disclosing infrastructure jurisdiction and
anti-unlawful-access measures. From **12 January 2027 switching charges are prohibited
outright**, egress included.

This folds into Tier 4 rather than replacing it: the same order form and terms work covers
it, and the Article 28 disclosure is the subprocessor table from 4.4.

### 5.3 "Hosted in Frankfurt" is no longer an answer

Bitkom's 2026 cloud report: 85% of German companies say they are too dependent on US cloud
providers, 64% are actively rethinking, and 37% would accept fewer features or higher cost
for exclusively-German processing. The controlling point buyers now make is that the CLOUD
Act attaches to the **provider's jurisdiction, not the data centre's location**.

The vocabulary has also changed. BSI published **C3A** (Criteria enabling Cloud Computing
Autonomy) on 27 April 2026, adopting the EU Cloud Sovereignty Framework's structure, and
**C5:2026** in March with 168 criteria. C5 is a prerequisite for a C3A assessment. Note
that **EUCS does not exist** — never adopted, sovereignty requirements stripped in 2024 —
so "we cannot obtain EUCS certification because there is none" is a correct and defensible
answer.

For an AI-oversight product the sharpest follow-up is: *which LLM provider processes
customer content, in which jurisdiction.* Have that answer written down.

### 5.4 Corrections to this document

- **NIS2**: the German implementing act has been in force since 6 December 2025 with **no
  transition period**. Every regulated customer must document you as a supplier.
- **The Cyber Resilience Act does not apply** to standalone SaaS (Recitals 11–12 and the
  Commission's guidance of 27 July 2026). It bites only if you ship an installed agent,
  SDK or extension.
- **BFSG does not apply either** — B2B has no consumer, and you are additionally a
  Kleinstunternehmen. But **§ 121 Abs. 2 GWB forces public-sector buyers to ask anyway**,
  and BITV 2.0 explicitly covers intranets and staff-facing tools, so a public-sector
  customer's internal use is in scope even though your sale is not. Prepare an accessibility
  statement and an EN 301 549 conformance report; note that public tenders treat
  accessibility work as **not separately billable**.
- **LkSG reporting is dead but the duties are not.** BAFA stopped reviewing reports in
  October 2025 and the portal is closed, but §§ 3–10 remain and large customers cascade
  them contractually. A one-page supplier self-disclosure covers most of it, and BAFA's own
  FAQ — stating that obligations cannot simply be passed down — is the lever for resisting
  over-broad flow-down.
- **The translation-regression guard already exists** (`i18n/messages.test.ts`), asserting
  full key-set and placeholder parity. It was listed here as unbuilt. What is missing is a
  *terminology and register* guard — see 5.5.

### 5.5 The German UI is complete but not consistent

Key parity is exact at 3,988 leaves and there is **no numeric, date or legal-citation
divergence** between the languages. Three problems sit on top of that:

- **The register splits exactly along the pitch boundary.** German marketing and legal copy
  is ~200 formal *Sie*; the signed-in product is largely informal *du* — 76 in agents, 44 in
  review, 35 in account. The buyer is addressed as *Sie* on the website and as *du* the
  moment they sign in. For Mittelstand and enterprise this is the fastest credibility signal
  in the product and it is mechanical to fix.
- **The same object has two German names.** The setup wizard says *Arbeitsbereich* 53 times;
  every other catalogue says *Workspace* 153 times. The evaluator creates one thing and is
  then shown another.
- **The core deliverable has four German nouns** — *Belegpaket*, *Nachweispaket*,
  *Entscheidungspaket*, *Prüfnachweisarchiv* — and two English ones on a single screen.

A catalogue test in the shape of the existing parity test would pin both register and
terminology permanently.

### 5.6 The German DPA drops qualifiers the English carries

Three instances, same key paths, so the German AVV is materially a different contract:

- **Audit rights.** English limits on-site access to once a year *unless a confirmed breach
  or supervisory authority requires more*. German says *grundsätzlich jährlich begrenzt* and
  drops the exception entirely. That is the Art. 28(3)(h) right, and the German reads as
  capping something a Landesdatenschutzbehörde can compel regardless.
- **Documented instructions.** English says processing required by *Union or Member State
  law*; German says merely *gesetzlich vorgeschrieben*. That restriction is the substantive
  point of Art. 28(3)(a) — it is what stops a processor deviating because a third-country
  authority demanded it. As written the German appears to authorise the Schrems II scenario,
  and you disclose US subprocessors.
- **Retention** carries the same drop in the deletion carve-out.

This is the finding most likely to be discovered *after* a deal is won. Counsel work, but
flag it now.

### 5.7 Contract-level inconsistencies a technical reviewer finds in an afternoon

The `no_decision` schema mismatch, the six-layer panel-size disagreement, the missing SIEM
events for a tie and a cancellation, and the `$29` billing page are all closed. What the fix
left open:

- **Customers cannot yet subscribe to the two new terminal event types.** `review.tied` and
  `review.cancelled` are emitted and delivered, but `SiemEvidenceDelivery` keeps its own
  event-type list for the subscription UI, so an existing endpoint has no way to ask for
  them. Half a day, and it is the half that makes the fix visible to a buyer.
- **A second panel-size family still disagrees.** `requestedPanelSize` is bounded 3–500
  across six files including a published request schema, against the profile bound of 2–100
  now enforced everywhere else. Narrowing it is a product call — 3 is a deliberate quality
  floor for requested panels — but the published schema should not contradict the server.
- **Five vocabularies for one outcome**: `positive/negative`, `agree/disagree`,
  `endorsed/rejected`, and two different German label pairs on two panels fed by the same
  source. No mapping table exists anywhere.

### 5.8 Engineering health

Only the items that change what to do next:

- **The status table in `implementation-plan.md` overstates three lanes.** Rows 2.3, 2.4 and
  2.5 are marked implemented, but `supervisionOverridePatterns`, `employmentDataGovernance`,
  `reviewerEngagement` and `dsaReferenceNetworkProvenance` — 2,746 lines — have **zero
  production callers**. Planning six months off that table will mis-estimate. Correcting
  three rows costs minutes.
- **`knip` cannot see any of this.** It registers test files as entry points, so a module
  imported only by its own test counts as used, and it reports zero unused files. The
  dead-code tool is blind to the dominant dead-code pattern (~8,200 product lines staged
  behind gates, ~14,900 including tests and SQL).
- **Do not remove the off lanes.** The seam is clean — under 1% of live lines are
  lane-branches, and the unpaid adapter imports no paid module. Removal is ~1,800 lines of
  surgery on working revenue code for no functional gain. Two narrow fixes are worth it: 75
  lines of network-only logic and five dead joins inside the live task fetch.
- **The highest-leverage refactor is snapshotting the pg-mem schema.** 331 harness
  initialisations each replay all 191 migrations — roughly 7.8 million lines of SQL per CI
  run, and pg-mem tests measure 8× slower than others. pg-mem ships `backup()`/`restore()`
  for exactly this. **One file, 40–60 lines, zero test rewrites**, and it stops every future
  migration making every existing test slower.
- **`deployedContracts.ts` is generated but not byte-verified.** The ponder and keeper
  copies are; this one is only regex-checked, so a hand-edit of its four addresses passes the
  whole suite. One `assert.equal` closes it.
- **No test reads a `.sol` file.** Thirteen Solidity constants — the 5-minute reveal floor,
  6-hour beacon grace, 24-hour scoring margin, fee cap, base pay — are independently retyped
  in TypeScript. Values match today; nothing enforces it, and divergence surfaces as an
  on-chain revert with funds committed.
- **The Wilson interval is implemented twice** — TypeScript and a hand-transcribed SQL
  expression — with no test asserting they agree. It drives adaptive review rates and
  published confidence intervals.

### 5.9 Deployment drift is now detected, not prevented

Closed by `scripts/check-deployed-commit.mjs` and the `Deployed commit` workflow, which
compare the tokenless alias's `/api/release` SHA against the branch head on every push and
every weekday morning. **It reports; it does not deploy.** `deploymentEnabled.tokenless` stays
`false` on purpose, so a red run still means somebody must run `yarn vercel --prod`.

### 5.10 Revised order

1. **The German register and terminology split** (5.5) — half a day, and it is the fastest
   credibility signal a Mittelstand buyer reads.
2. **The works-council pack** (5.1) — start now; it gates the calendar, not the pitch.
3. **Data Act Article 25 terms** (5.2) folded into the Tier 4 order form and AGB work.
4. **The German DPA qualifiers** (5.6) — counsel, but brief them this week.
5. **pg-mem snapshotting and the `deployedContracts` byte check** (5.8) — engineering
   hygiene that compounds.
6. **Auth rate limiting** (6.4) — the limiter already exists; it is the one remaining
   security item a questionnaire reliably asks about.

### 5.11 What B8 needs decided before it is built

The browser review path was scoped in detail and is **6–9 days, not 4–8**. Two of its
obstacles are product decisions, not implementation:

- **A human-authored request has no model execution**, but the pipeline requires at least
  one generation span with a provider and a requested model. Declaring `provider: "human"`
  validates today and puts browser requests in their own evaluation scope — arguably right,
  since it stops them contaminating the agent's adaptive calibration — but that string
  reaches the evidence record a buyer reads.
- **"Request a review" may legitimately answer "no review required."** In `manual` policy
  mode the decision is always `recommended`, so a manual-mode workspace could never use the
  page. Forcing it means either restricting the page by policy mode or adding a
  `human_requested` reason code, which changes what the evidence record means.

A third: the design requires rehydrating an agent's credential from database state with no
credential presented, so an owner session gains the agent's `panel:publish` authority.
Defensible — the owner granted that scope — but it should be deliberate and audited.

One correction: the `caller_credential_kind` migration flagged earlier is the **wrong**
answer. That column records which credential the integration is bound to, not how the
request arrived, and it feeds evidence hashes and the idempotency namespace. Recording
browser provenance in the audit trail is cheaper and more honest.

## Tier 6 — the security and positioning round

A final audit went after the security posture a German questionnaire actually probes, and
the regulatory footing of the pitch itself. Three of its findings change decisions.

### 6.1 The pitch is aimed at a deadline that moved — and there is a better one, live today

This document's urgency rests on AI Act Article 26 deployer obligations. **Article 26 sits
in Chapter III Section 3, which Regulation (EU) 2026/1744 deferred to 2 December 2027** for
Annex III systems. Article 26(2) oversight, 26(6) retention and 26(7) worker information do
not bite for another sixteen months. The product's own compliance map already records the
deferral; this document did not.

**Article 50(4) is live now and was written for this product.** The AI-generated-text
disclosure duty falls away where the content *"has undergone a process of human review or
editorial control and where a natural or legal person holds editorial responsibility."*
That is enforceable today, at up to €15m or 3%, and RateLoop is precisely the evidence that
the exemption was earned.

**Re-point the deck.** It is a slide reorder, and every hour spent on Tier 4 paper before
this is an hour spent selling a 2027 problem.

Also note Article 4 was softened to *taking measures to support the development of* AI
literacy — selling literacy evidence is weaker than it was in 2025.

*One dissenting source places Article 26 outside the deferral, but reaches that by putting
it in Section 4, which is notifying authorities. The premise is wrong. Still worth counsel
sign-off before a deck is built on it.*

### 6.2 The dependency audit now scans. What is left is a reading of the result.

The audit was replaced (osv-scanner, digest-pinned, weekly schedule): **0 → 1,917 packages
scanned**, sixteen accepted exceptions each with an expiry date, and the hono ReDoS
(GHSA-8j4g-w8fx-2239) is fixed at 4.12.34 rather than pinned below it. Two things a
questionnaire will still surface:

- **`next` sits at exactly the minimum fixed version, with zero headroom.** The next Next.js
  advisory is an immediate upgrade, not a scheduled one.
- **The 56 Dependabot alerts are misleading in your favour, and you cannot cite them.** They
  are computed against the default branch while `.github/dependabot.yml` targets `tokenless`,
  so `main` never receives the fixes. Tokenless is materially cleaner than the count implies;
  a buyer reading the GitHub badge sees the opposite.

### 6.3 The AVV makes five security claims the deployment cannot evidence

This inverts an earlier conclusion in this document, which said the DPA's substance was good
and only its form failed. Annex 1 of the DPA claims **tested recovery procedures**
(no backup policy, no restore drill, no RTO/RPO exists anywhere), **segregated production
roles** (a one-person UG), **monitored operational failures** (failures are detected and
recorded; nobody is notified — there is no alerting of any kind), **access logging**
(operator access via migration scripts or direct psql is not logged), and **prompt
deprovisioning** (undefined interval).

The irony is exact: the claim gate's file collection **is** recursive over the public app
directory, so the DPA page is scanned — but the eighteen rules are all about evidence
capabilities, and there is **no rule class for security or TOM assertions**. The gate that
protects the marketing does not protect the contract.

A German DPO asks for the last restore-test record before anything else. Marketing
over-claim costs a slide; an unevidenced TOM annex is a term of a signed AVV.

### 6.4 Security items a questionnaire or pentest would raise

The admin/impersonation plugin, the raw error objects on the API error path, and the retired
web3 origins in the CSP are closed. Three remain:

- **No rate limiting on authentication.** The DB-backed limiter is well built and consumed by
  six route files; `betterAuth()` configures no `rateLimit` and no `secondaryStorage`, so the
  default is in-memory — per-lambda on Vercel, which is not a limit. Nothing throttles
  *requesting* email codes. Email-bombing an arbitrary address is a standard finding, and the
  limiter already exists. **This is now the highest-value security item on the list.**
- **The CSP has no `report-to`.** The dead origins are gone, but violations — the cheapest
  intrusion signal available — still go nowhere.
- **No error tracking, APM, alerting or log drain anywhere.** The single hit is an OTLP
  *ingest* endpoint: RateLoop receives its customers' traces and emits none of its own. Note
  this is also what makes the AVV's "monitored operational failures" claim (6.3) unevidenced,
  so the two are one fix.

### 6.5 The one capability worth building — and it is already written

**Surface `employmentDataGovernance` as a workspace mode defaulting to `aggregate_only`.**

`lib/tokenless/employmentDataGovernance.ts` is a complete model — `processingMode`,
`worksCouncilStatus` including `agreement_recorded`, `dpiaStatus`, lawful basis, worker
notice — with a **twelve-gate block** that refuses to activate per-reviewer analytics until
every gate is recorded. It has one caller, no API route and no UI.

This is the answer to 5.1. Not a document promising no performance monitoring, but **a mode
that cannot produce per-reviewer evaluative output while it is on**, with those twelve gates
as the only way to turn it off, plus an exportable pack for the works council.

Why this over the alternatives: a penetration test is a document you buy that goes stale; a
trust page is packaging; qualified timestamping is a differentiator, not an unblocker; B8
changes the demo, not the procurement file. **Every other item on this list is an absence.
This one is a present hazard** — the product records which named person reviewed what, when,
with their rationale, and renders it per reviewer. A works council that reaches the obvious
conclusion does not merely block the deal; it tells the buyer your product pulled *them*
into high-risk obligations.

You are also the only vendor who can ship it in days rather than months, because the model,
the gates and the vocabulary already exist behind no route.

### 6.6 More that is under-sold, and two corrections

Not previously counted: **CycloneDX SBOM and signed build provenance** for both container
services; **CodeQL `security-extended` weekly**, Trivy with a hard gate, Slither, all actions
SHA-pinned; **exemplary OAuth 2.1** with exact redirect matching, mandatory S256 PKCE and
resource indicators; **a real Löschkonzept in code** — 30-day deletion, 365-day audit,
3,650-day billing retention matching § 147 AO and § 257 HGB; **a working Art. 15/17/20 DSAR
pipeline**; **audit metadata key rejection** for authorization, cookie, email, JWT, OTP,
password, private key, refresh token, secret and signature, which is a control that belongs
in a TOM annex verbatim; and **no XSS surface for agent-submitted content** — the only two
`dangerouslySetInnerHTML` uses are a static theme bootstrap and escaped JSON, and no markdown
renderer is installed. For a product whose job is showing untrusted model output to humans in
a browser, that is a good answer nobody is giving.

Two corrections: **the Löschkonzept largely exists** — it is a document generated from three
constants, not a project. And **"Frankfurt-pinned" is over-precise**: Vercel is `fra1` but
the indexer runs in `europe-west4-drams3a` (Netherlands). Both EEA, no transfer issue, and
the DPA already says EEA — so say EEA.

**Do not spend on ISO/IEC 42001 in 2026.** No harmonised standard is published in the OJ, so
it confers no Article 40 presumption, and the audit found no verifiable German buyer demand —
every source claiming otherwise was vendor SEO. Cheaper credible signals exist: a **CSA STAR
Level 1** public registry entry, and the **EU Cloud Code of Conduct** at SME pricing, which
attacks the actual legal gate since Article 28(5) makes adherence to an approved code an
explicit way to demonstrate Article 28(1) sufficient guarantees.

One tiering insight worth more than any certificate: German industrial buyers grade the ask
to the data class. *Intern* gets a management-signed self-assessment; only *vertraulich* and
above demand TISAX or ISO 27001. **Argue the data classification down to *intern* wherever
it is true and you are in the self-assessment tier, not the certificate tier.**
