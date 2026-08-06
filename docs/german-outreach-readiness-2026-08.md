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

A prospect who opens the pricing page during your pitch sees a different offer than the one
you just made. Worse: the card always renders `$29`, but its button swaps to **"Request
pilot"** whenever self-serve checkout is disabled — which the operating rules require. So
the page shows **a $29 price tag whose only available action is to ask for a €2,500 pilot.**

**Resolution: delete the public $29 anchor.** Research settled this against the earlier
position that it could stay as a founding offer:

- Its own condition was never met. It was to be kept "only if its displayed limits and
  checkout state are true", and neither is.
- **Every verified competitor publishes no price** — Vanta, Drata, Secureframe, OneTrust,
  Credo AI, Holistic AI, and the closest comparable, Munich-based trail, which sells a
  structured proof of concept instead.
- A published $29 is not an anchor you discount from; it is a net price a buyer can quote
  back at you, making €2,500 an 86× markup to justify.
- The seller is a German UG. Quoting USD to German buyers is an unforced credibility loss.
- There is a German legal wrinkle: the Preisangabenverordnung binds consumer-facing offers,
  and a court has held a publicly accessible shop must be assumed to address consumers
  unless the trader takes **suitable control measures** to ensure only business buyers can
  purchase (BGH I ZR 99/08 — technical gating satisfies the test but is not the test).
  Removing the public price removes the exposure.

The pricing page should show **Sandbox €0** and the **Founding Pilot at €2,500 netto,
6 weeks, 50% creditable**, with "Alle Preise netto zzgl. 19 % USt." **Publish no recurring
price until three pilots have closed**, then €1,200/month — see the business plan for the
derivation, and note it replaces the €249 tier, at which break-even needs 24–30 customers.

None of this needs billing code. The pilot is invoiced by hand in EUR with 19% USt.,
collected by SEPA transfer, entirely outside the product.

### 0.6 "sufficient AI literacy" is still shipped

The Vertriebsleitfaden `.docx` flagged this for correction before outreach; the rewritten
markdown source no longer carries the note, so it survives only here. It is live in
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

At the default, one slow reviewer produces "inconclusive" in front of the prospect — and so
does the more likely case, **two reviewers who both answer and disagree**, which is exactly
the situation most worth demonstrating.

Note that "set the panel to 1 for the demo" is not available: `MINIMUM_REVIEW_PANEL_SIZE = 2`
([`reviewRequestProfiles.ts:40`](../packages/nextjs/lib/tokenless/reviewRequestProfiles.ts))
is enforced server-side and mirrored in the editor. Changing it is a code change, not a
setting. See B5.

### 2.3 The agent envelope withholds the reasons — but the browser already shows them

`rationale: { summaryAllowed: false, aggregateSummary: null }` is **hardcoded**
([`privateReviewResponses.ts:742`](../packages/nextjs/lib/tokenless/privateReviewResponses.ts)),
so the customer's agent receives an outcome enum only.

**An earlier draft of this document concluded "either ship it or stop promising it". That
was wrong, and the correction makes this much cheaper.** Reasons are collected by default
(`rationaleMode` defaults to `required`), stored encrypted, decrypted for the invited lane
because the workspace owns them, served over a session route, and **rendered on screen per
reviewer with disagreement** at
[`EvaluationDashboardPanel.tsx:546`](../packages/nextjs/components/tokenless/agents/EvaluationDashboardPanel.tsx).

So the landing-page promise is honoured in the product UI and broken only in the API. The
projection layer already knows how to carry an aggregate summary. This is a one-file change,
not a feature build. See B2.

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
noch nicht verfügbar." — **at save time, after the prospect has watched you fill in the
whole form.**

**One correction to an earlier draft of this document.** It claimed Free and Early Access
are "functionally identical" because the decision meter never counts. That is wrong. Active
agent limits are enforced at three production call sites and private-group limits at one,
so 1-vs-3 agents and 1-vs-5 groups are real. **Only the decision allowance is unenforced** —
and the precise remaining problem is sharper than "no reason to upgrade": a paying workspace
would see **"0 of 250"** if it were displayed — but no component renders it and three tests
forbid rendering it, so this is dormant rather than a live defect. Wire the meter before
selling a plan that advertises a decision count, not before outreach.

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

### B1. Make `/rate` a product page — 1–2 hours

Branch in [`rate/page.tsx:19-20`](../packages/nextjs/app/[locale]/(app)/rate/page.tsx): if
`assignment`, `terms` or `invite` is present, keep the reviewer forward; otherwise redirect
to `/`. `canonicalReviewSearchParams` already tells you whether any reviewer parameter
survived, so the conditional is one line.

Safer than it looks: **nothing in the product links to `/rate` any more.** Reviewer
invitations build `/human/review` directly. It is a pure legacy alias.

*Unlocks:* the URL in every email and deck footer stops landing on an empty gig inbox.
*Test risk:* low — the hosted smoke test only asserts a `<main>` renders and status < 500.

### B2. Return the reasons in the agent envelope — 1 day

Widen the select in `terminalEnvelopeForDelivery` to include the rationale columns, reuse
`decryptWorkspaceOwnedRationale` (already proven in the evidence projection), and gate
`summaryAllowed` on the frozen profile's `rationaleMode !== "off"`.

**80% built.** `humanReviewResultProjection.ts` already trims and emits
`{ mode: "aggregate_summary", summary }` when `summaryAllowed` is true, and the
`summaryAllowed: true` path is already exercised in its tests.

Decide one thing first, in about thirty minutes: the envelope is deliberately an
**aggregate** surface that strips per-reviewer identity. Emit a synthesised aggregate, never
a per-reviewer list, and keep small-cell suppression consistent with the export.

*Unlocks:* you can show the landing-page claim and the API response in the same meeting.
*Test risk:* medium, bounded — the withholding test only asserts behaviour when
`summaryAllowed` is false; one integration test pins the literal null and needs updating.

### B3. Empty states that explain instead of showing nothing — ½–1 day

Four demo surfaces render nothing at all. The worst is
[`HumanProfileContent.tsx:20,38`](../packages/nextjs/components/tokenless/human/HumanProfileContent.tsx),
where five sections vanish with no text and their anchor links dead-end.

**The copy is already written and unused:** `HUMAN_REVIEW_LANE_UNAVAILABLE_MESSAGES` in
[`reviewCapabilities.ts:183-191`](../packages/nextjs/lib/tokenless/reviewCapabilities.ts) is
ready-made explanatory text for exactly these lanes. Render it in the `: null` branch.

While there: the server emits "in this **window**" while the UI says "in this **period**".
A German compliance reader will notice the disagreement.

*Test risk:* medium — several assertions match literal source text.

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

### B5. Make the demo incapable of returning "inconclusive" — 1–2 days

Resolve on a **decisive majority** rather than unanimous participation.
[`directPrivateReviewEvidence.ts:212`](../packages/nextjs/lib/tokenless/directPrivateReviewEvidence.ts)
already computes the right threshold — `Math.floor(panelSize / 2) + 1`. Reuse it, and pair it
with a frozen tie-break policy on the request profile defaulting to today's behaviour so
nothing existing changes.

Do **not** take the alternative route of lowering `MINIMUM_REVIEW_PANEL_SIZE` to 1: it
ripples into cohort bounds, quote minimums and the aggregation floor, and "one reviewer" is
not a panel — a German buyer will say so.

*Independent value:* waiting for a straggler after the majority has decided is a latency bug,
not a safety feature.
*Test risk:* **high** — this is the most test-dense area in the codebase, and changing
outcome derivation changes result-commitment inputs.

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

## Demo hardening — the smallest set

About three developer-days. Optimised strictly for "nothing embarrassing happens in the
meeting", which is a different and smaller list than the one above.

1. **B5, majority resolution only** (1 day). Without it, the most compelling thing you can
   demo — two named experts disagreeing — prints `inconclusive`.
2. **Project evidence immediately on completion** (2–4 hours). **This is the demo risk the
   first draft of this document missed entirely.** Evidence projection is only *enqueued* at
   completion; the projection itself runs on the `*/5 * * * *` cron. So the last reviewer
   answers, you click to the evidence tab, and for up to five minutes there is nothing there
   — including the rationales. Attempt it inline, keeping the queue as the retry path.
3. **Stop the paid-lane error firing at save time** (2 hours). The editor throws "Dieser
   Prüfpfad ist noch nicht verfügbar" **after** the prospect watched you fill in the whole
   form. The setup flow already does this correctly — the option is disabled with the reason
   shown inline. Port that behaviour.
4. **Give the reviewer profile something to say** (2 hours). B3's first item.
5. **Fix `/rate`** (1 hour). B1 — because the prospect's first *solo* visit after the meeting
   is the one that matters.

**Rehearse from `e2e/hosted/core-journey.spec.ts`.** It is a complete, green, three-account
two-reviewer private journey: connect, verify, invite, configure panel 2, request review,
both reviewers respond, fetch result. That file is your demo script.

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
