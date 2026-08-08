# Before pitching German companies — readiness list

Written 6 August 2026, last revised against `dcc2ddfcf` (8 August 2026). Sources: four
audits of the
product and its collateral, then a second round covering internal consistency, German
enterprise procurement, the first-run journey, architecture health, and 2026 regulatory
change, then a **sourcing round on 7 August 2026** that re-verified the sales collateral
against the code and graded every regulatory claim against a primary source, then a
**fourth round on 8 August 2026**: a line-by-line re-verification of every open item
against the code, a fresh gap audit, a market and competitor research pass, and a
skeptical-buyer weakness review. The fourth round's new findings are Tier 8; its status
changes and corrections are folded in place below.

**Read [docs/sales/quellen-und-belege.md](sales/quellen-und-belege.md) before quoting any
number or legal proposition from this document.** It grades each claim as primary source,
retrieved, secondary or unverified, and lists what is still unverified — including several
propositions in Tier 5 that this document states with more confidence than the evidence
behind them supports.

**Two findings in that round changed decisions rather than adding items.** Article 50(4) is
far narrower than § 6.1 claimed, so the re-point is a segmentation and not a slide reorder;
and the BAFA subsidy in the research list does not apply to the pilot at all. Both are
corrected in place below.

**Completed items have been removed rather than ticked.** Eleven readiness items and four
build items landed between `2853daf74` and `90b7b2d91` — the pitch URL, the ODR notice, the
pricing page, the AI-literacy wording, the README caveats, the reviewer-profile empty state,
reasons in the agent envelope, majority panel resolution, and the FINRA/ISO/NIST citations.
A further round through `9a0bbdec1` closed the dependency audit, four security gaps, the
`no_decision` and panel-size contract mismatches, the missing SIEM terminal events,
deployment-drift detection, inline evidence projection and the up-front paid-lane notice.
A third round closed the World ID content-security-policy gap, CSP violation reporting, the
tie and cancellation subscriptions, the `requestedPanelSize` contradiction inside the SDK,
the blinding claim in the tagline, and the twenty-six untranslated German errors in the
setup wizard. Each is a separate commit with tests. A fourth round through `49a99ee86`
closed the reviewer deadline reminder (7.1.1.A), the reviewer leaver process for both
manual removal and SCIM deprovisioning, the weekend-hostile response-window ceiling, an
unkeyed reviewer-digest confirmation oracle in the training and coverage exports,
plaintext-capable database connections, the `X-Powered-By` header, integrity secrets
reachable from the browser bundle, and unbounded statement time on the request pool.
While this revision was being written, two more 6.4 items landed: the per-address
email-code cap with its test (`2f607647e`) and the anonymous audit-chain write on
`/api/auth/exchange` (`dcc2ddfcf`). What remains is below.

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

`TOKENLESS_DEMO_BOOKING_URL` is empty (`.env.example:293`), so "Book demo" falls back to
`mailto:` ([`demoBooking.ts:12-26`](../packages/nextjs/lib/marketing/demoBooking.ts)) —
and the fallback address is the same personal ProtonMail compose window, hardcoded at
[`WorkspacePlanCards.tsx:33`](../packages/nextjs/components/pricing/WorkspacePlanCards.tsx).
Fixing 0.1 must include that constant, or the money page's primary button still opens a
personal mailbox.

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

### 1.4 The claim gate is phrase-shaped, so weaker wordings pass

The site-wide meta description used to read *"Get blind human feedback before you ship AI
work."* — and, once the German localisation landed, *"verblindetes menschliches Feedback"*,
the clinical-trial term. It now says *independent*, which is true and is what the sales
collateral already said: reviewers submit without seeing each other's answers.

**The general lesson is the one to keep.** The gate's rule forbids the exact phrase
*"independent blinded panels"*. A weaker wording of the same claim passed it silently for as
long as the tagline existed, on the single most-served string in the product. Rules matched
on phrases catch the sentence you thought of, not the claim.

Still unreviewed, and counsel's rather than a cleanup's: `public.json` and the Terms,
Privacy and DPA pages describe blinded panels and a commit–reveal round. Those describe the
paid network lane, which is frozen off — the same Tier 1 problem as the rest of this
section, but inside signed documents.

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
   ([`check-tokenless-production-readiness.mjs:693`](../packages/nextjs/scripts/check-tokenless-production-readiness.mjs)) —
   and the same script *requires* `sk_live_` once subscriptions or top-ups are enabled in
   real production, so live money is impossible on tokenless and mandatory-live on a
   promote. Taking real money means promoting to `main`, which trips all six frozen
   release capabilities.

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
  stage have machine-translated marketing and English legal pages. Lead with this — but
  note the caveat found in the fourth round: the *key-based* layer is complete, while the
  *exact-string phrase catalogue* used by several signed-in panels has misses that render
  half-German (8.5). Fix those before a live walkthrough of members, settings or billing.
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
- **A complete reviewer leaver process** *(new, 8 August)*: both manual member removal
  (`e8ff52414`) and SCIM deprovisioning (`c8d7aa0ce`) now revoke the reviewer seat, access
  grant, group membership and in-flight assignments — the joiner/mover/leaver question
  every German security questionnaire asks, previously the finding most likely to fail one
  outright.
- **Weekend-survivable review deadlines** *(new, 8 August)*: response windows now run up
  to 30 days with a 3-day default (`5018d147c`), so a Friday-afternoon request no longer
  dies over a German weekend. Deliberately not Feiertag-aware — say "3-day default", not
  "business-day aware".
- **Uniformly keyed reviewer pseudonyms** *(new, 8 August)*: the training and coverage
  exports' reviewer digest was an unkeyed SHA-256 — a confirmation oracle for whether a
  named person is a reviewer — and is now a keyed, rotatable, workspace-scoped HMAC
  (`55c265dbd`, `ca9048b41`). This also resolves the research-list item "Confirm
  'Pseudonyme pro Run' or drop it": pseudonyms are keyed HMACs; describe them that way.
- **Certificate-verified TLS to the database** (`e5fa4d0dd`) — TOM-annex substance.
- **Transactional-email plumbing done properly**: One-Click `List-Unsubscribe` with a real
  POST handler, plain-text parts on all four senders, per-recipient tokens, idempotency
  keys, a verified-and-opted-in gate before any send. The domain-authentication layer
  (SPF/DKIM/DMARC) is the gap — see 8.4.
- **A public surface with no third-party scripts at all**: fonts self-hosted via
  `next/font`, zero external CDNs, analytics or trackers, no non-essential cookies, no
  consent banner needed and none falsely claimed, HMAC-hashed rate-limit identities, and a
  35-day IP purge on a five-minute cron. For a German DPO this is an audit answer most
  vendors cannot give — but two functional cookies and the stored IP are missing from the
  privacy notices; see 8.5.

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
5. ~~Confirm "Pseudonyme pro Run" or drop it (1.2).~~ **Resolved 8 August**: reviewer
   pseudonyms are now uniformly keyed, rotatable, workspace-scoped HMACs (`55c265dbd`);
   describe them as keyed pseudonyms, not anonymity.
6. **The BAFA lever is checked, and it does not apply. Stop planning around it.** The
   programme is real — basis €3,570 capped at **€3,500**, **50%** in the western Länder and
   **up to 80%** in the eastern Länder and Berlin, max five engagements and no more than two
   a year, **and the directive expires 31 December 2026**. But it funds **consulting by a
   BAFA-registered advisor**, not a software licence or a SaaS pilot. A €2,500 Founding Pilot
   as currently structured is **not eligible**. Do not offer or imply it: a prospect who
   builds a budget request on it and loses the subsidy loses trust at the worst moment. If the
   lever is wanted, it needs a partnership with a registered consultancy that delivers the
   policy mapping as fundable advice — a separate decision.
   *Retrieved 7 August 2026:*
   [BAFA — Unternehmensberatung](https://www.bafa.de/DE/Wirtschaft/Beratung_Finanzierung/Unternehmensberatung/unternehmensberatung_node.html) ·
   [Handelskammer Hamburg](https://www.handelskammer-hamburg.de/gruendung-sicherung-nachfolge/finanzierung-foerderung/foerderung-unternehmerisches-know-how-6720506).

   Separately, no reliable source exists for the department-head approval threshold that the
   €2,500 price is often justified by; justify it from your own discovery instead.

The pricing hypothesis is no longer open — see 0.5. The Preisempfehlung was right and the
commercial research document has been removed, so `docs/sales/` and the business plan are
now the single owners of price.

## Ordering

**Superseded by § 8.6**, which re-ranks the whole document after the fourth round; kept
because its logic still holds.

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

[Regulation (EU) 2023/2854](https://eur-lex.europa.eu/eli/reg/2023/2854/oj) has applied
since 12 September 2025. Assume you are in scope: the test is whether a customer can
self-provision, not company size.

> **Correction, 7 August 2026.** This section previously asserted that a German
> implementing act (DADG) "has been in force since 30 May 2026 with the Bundesnetzagentur as
> competent authority." A German practitioner source read in this round says the **opposite** —
> that no national implementing act is required, because the Data Act is a directly
> applicable Regulation. Both cannot be true and neither is confirmed here. **Until it is
> resolved, cite only the Regulation to customers.** It applies regardless, and the Article 25
> contract duties do not depend on national law. Do not name the DADG or a competent
> authority in collateral.

Article 25 requires specific contract terms — **2 months maximum notice to switch, a 30-day
transition, a data-retrieval period afterwards, certified erasure, an exhaustive
exportable-data inventory**. Article 26 requires publishing the switching procedure and
formats. Article 28 requires disclosing infrastructure jurisdiction and
anti-unlawful-access measures. From **12 January 2027 switching charges are prohibited
outright**, egress included; until then only cost-covering charges are permitted.

**One detail worth having before the AGB work, because it is the negotiating room:** the
30-day transition period may be **extended to a maximum of 7 months** in an individual case.
Draft to that, not to a flat 30 days.
*Retrieved 7 August 2026:*
[Deloitte Legal on cloud switching](https://www.deloittelegal.de/dl/de/services/legal/perspectives/cloud-switching-eu-data-act.html) ·
[Helbing on the practical edge cases](https://www.thomashelbing.com/de/blog/cloud-switching-unter-data-act-einzelprobleme-praxissicht).

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

### 5.5 The German terminology still splits, though the register no longer does

Key parity is exact and there is **no numeric, date or legal-citation divergence** between
the languages. The register split is closed: 267 strings across the five signed-in
catalogues moved to formal address, so the buyer is no longer greeted with *Sie* on the
website and *du* the moment they sign in. A grammar-based guard test keeps it that way.

Two terminology problems remain, and neither is mechanical:

- **The same object has two German names.** The setup wizard says *Arbeitsbereich* 54 times;
  the other catalogues say *Workspace* 204 times — and nine of those *Workspace* uses are
  now inside `agents.json` itself, so the wizard mixes both nouns in one catalogue. The
  evaluator creates one thing and is then shown another. *(Re-counted 8 August 2026.)*
- **The core deliverable has four German nouns** — *Belegpaket* (7), *Nachweispaket* (5),
  *Entscheidungspaket* (6), *Prüfnachweisarchiv* (1) — and two English ones on a single
  screen.

A catalogue test in the shape of the register guard would pin terminology permanently.

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
events for a tie and a cancellation, the `$29` billing page, the unsubscribable terminal
events and the `requestedPanelSize` 3–500 family are all closed. What remains:

- **The quote floor of 3 rejects a legal private panel of 2 — now with an official
  rationale attached.** `2205baecf` narrowed the bound to 3–100 across all six layers and
  named the floor `MINIMUM_PUBLIC_REVIEW_PANEL_SIZE`, declaring that private panels never
  reach this validator. The code contradicts the declaration: the paid private path builds
  a `customer_invited` quote from `input.economics.panelSize`
  (`paidAssignmentOperations.ts:1085`) and routes it through
  `createInternalPrivateReviewQuote` into the audience-blind floor-3 validator. A
  two-reviewer private *paid* group still cannot quote. Still bites only when private paid
  reviews are switched on.
- **A stored quote from 101 to 500 can no longer be replayed — accepted as a decision.**
  `2205baecf` explicitly accepted that the narrowing "turns a silent dead end into an
  immediate 400". The 15-minute quote TTL bounds this to replays of expired quotes. No
  longer a defect; recorded so nobody re-finds it.
- **Seven stored-row readers still accept a panel of 1**, below the profile minimum of 2,
  and the guard in `reviewPanelPolicy.test.ts` covers six `lib/tokenless` modules and cannot
  match a bare `3`, so it caught none of them.
- **Ties and cancellations reach the SIEM but not the alert or incident paths.**
  `oversightAlerts.ts` routes only `gate.blocked`, `review.failed` and `review.expired`, and
  `INCIDENT_EVENT_TYPES` excludes both new types, so a tied panel raises no workspace alert
  and is absent from an incident export.
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
6. **Finish the email-code rate limit's residuals** (6.4) — the cap and its test landed
   (`2f607647e`); what remains is a translated 429 message and a pruning path for the
   rate-limit table.

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

## Tier 7 — the objections, and what removes them

Added 7 August 2026. Everything above is organised by what a *buyer's paperwork* needs. This
section is organised by what a *human in the room says out loud*, because those are different
lists and the second one is what loses deals.

The objection handling itself lives in
[docs/sales/vertriebsleitfaden-2026-08.md § 9](sales/vertriebsleitfaden-2026-08.md). What
follows is only the build side: which objections a product change can retire, and which are
answered with words.

### 7.1 „That is extra work for my team" — and the answer is already built and unsold

**This is the most common objection and the most under-sold capability in the product.**

RateLoop does not review every output. The review rate decays automatically as the system
calibrates ([`adaptiveReviewPolicy.ts`](../packages/nextjs/lib/tokenless/adaptiveReviewPolicy.ts)):
`calibrating` 100% → `high_coverage` 50% → `medium_coverage` 25% → `monitoring` **10%**
floor. Three safety nets sit on top: `maximumUnreviewedGap` forces a review after a
configured run of unreviewed outputs, a confidence drop below minimum escalates with reason
code `low_confidence`, and `productionFloorBps` lets the customer set a floor the decay
cannot go under. Policy modes are `manual | always | rules | adaptive | fixed`, and
`rationaleMode: "off"` reduces the reviewer's action to a single click.

**This is on the live lane** — `evaluateAdaptiveReviewRequirement` is called at
[`workspaceProtocol.ts:629`](../packages/nextjs/lib/mcp/workspaceProtocol.ts), before routing —
and it is configurable in the UI (`AgentHumanReviewEditor.tsx`, `AgentSetupFlow.tsx`).

**Nothing needs building. The gap is that no sales document mentions it**, so every
conversation implicitly promises review of every output, which is both wrong and
unaffordable. Fixed in the Vertriebsleitfaden at § 9.0. **Ranked first in this whole
document by return per hour, because the hours are zero.**

Two small builds would make it demonstrable rather than merely true:

- **Show the current stage and rate in the agent view** (½ day). A prospect who sees
  „monitoring — 10% of outputs sampled, next forced review in 14" stops asking the question.
- **A workload estimator in the setup wizard** (½ day). Outputs per month × rate × panel
  size → reviews per month. It turns the objection into a number the customer chose.

### 7.1.1 The sampling rate is the answer to *volume*. It is not the answer to *effort*.

**Added 7 August 2026 after tracing the reviewer's actual path through the code.** Sampling
answers „how many reviews". It says nothing about what one review costs a human, and that is
where the objection really lives. Ranked by effort saved per hour of work.

**A. ~~Nothing reminds a reviewer.~~ Closed, 8 August 2026, and then reinforced twice.**
`assignment.deadline_approaching` shipped in `280caaa2a`
([`reviewerInbox.ts:3`](../packages/nextjs/lib/notifications/reviewerInbox.ts) now carries
five source types), with the reminder query and dedupe in
[`delivery.ts`](../packages/nextjs/lib/notifications/delivery.ts) and its own test file.
Two adjacent commits matter for the same objection: `5018d147c` raised the response-window
ceiling from 24 hours to 30 days and the default from 1 hour to **3 days**, so a Friday
review request survives a German weekend — deliberately *not* business-hours or
Feiertag-aware, which would need a calendar — and `49a99ee86` stopped notification
*recording* being throttled behind the email budget, so every reviewer on a large panel is
recorded as notified in the first cycle rather than the last one waiting ~35 minutes.
The delivery cron runs every 60 seconds, not the five minutes an earlier draft claimed.

**B. An unanswered seat kills the review instead of moving.** On
`response_deadline_elapsed` without quorum the outcome is forced `inconclusive`
([`privateReviewResponses.ts:746-751`](../packages/nextjs/lib/tokenless/privateReviewResponses.ts)).
There is **no reassignment, substitution or backfill** — the seat expires and the work is
wasted, including the effort of the reviewer who *did* answer.

*Build: substitute a reviewer from the cohort on seat expiry* (2–3 days). The cohort
already carries capacity headroom, so the selection input exists. This is the highest
*absolute* return in this section: it converts the most common operational failure from
„the review failed and two people's time was wasted" into „the review took longer". It also
retires demo risk § 9.2 and it is what makes an SLA-shaped statement possible later.

**C. The reviewer's one-time cost is far larger than the per-review cost, and it is
front-loaded onto the least motivated moment.** Reconstructed from the routes: receive
invitation → create or sign in to a Better Auth account → redeem the invitation
(`/api/account/reviewer-invitations/redeem`) → hold an access grant covering the project and
data classification → wait up to five minutes for the cron → sign in again → **accept** the
assignment (`/assignments/[id]/accept`) → open the artifact → submit. **Eight steps before a
first verdict, and the drop-off is in the first four.**

*Builds, in order of return:*

- **Drop the accept step for private invited panels** (½ day). Accept-then-respond is
  meaningful for an open marketplace where a seat is claimed against competition. For a
  named internal reviewer invited by their own employer it is a click that carries no
  information. Treat opening the artifact as acceptance.
- **Land the invitation email directly on the artifact with the verdict controls** (1–2
  days). One click from email to a decidable screen. This is an authentication surface and
  must be scoped to a single assignment, single use and short expiry — cost it as such,
  and note that no rate limiting is configured on the auth paths yet (§ 6.4).
- **Digest instead of one email per assignment** (1 day). One message listing everything
  pending with its deadline. The interleave in `delivery.ts` already groups per principal;
  this is a grouping and template change, not new infrastructure.

**D. Reviewing one item at a time wastes the context load.** The expensive part of a review
is loading the policy, the question and the surrounding context — not the verdict. Reviewing
five items in one sitting costs far less than five times one item, and `ReviewerShell.tsx`
already has the progress affordance for it.

*Build: a batch review flow* (2–3 days). Independence is preserved — the reviewer still
cannot see other reviewers' answers, which is the property that matters; only their own
items are grouped.

**E. Admin effort is a separate objection wearing the same clothes.** § 2.3 documents a
setup chain of seven prerequisites before a first review, with no guided wizard past the
connect step. A prospect who hits that concludes „extra work" about *operations*, not about
reviewing. Completing the wizard is already on the list; it belongs to this objection too.

**Ordering for a pre-launch product**, where nothing is deployed and there is no customer to
disturb: A shipped, so **B, then C-1.** C-1 is half a day and removes a pointless click. B
is the one that changes what the product *is* — a panel that survives an unresponsive human
is a materially different proposition from one that does not, and it is the difference
between „we record reviews" and „we deliver decisions".

### 7.2 The works-council hazard — build the mode, do not write the promise

Unchanged from § 6.5 and still the right call: surface `employmentDataGovernance` as a
workspace mode defaulting to `aggregate_only`. § 5.1 explains why a contractual promise will
not close a works council;
[§ 80 Abs. 3 Satz 2 BetrVG](https://www.gesetze-im-internet.de/betrvg/__80.html) explains why
an external expert will read whatever you write.

**One addition from this round.** The presumption that the expert is necessary is described
in the practitioner literature as **irrebuttable** once the works council must assess the
introduction or application of AI, and it requires a *concrete and relevant* AI connection
rather than a remote one. So the audience for the works-council pack is a paid external
assessor, not the buyer's HR department. Write it for that reader: field-level data
catalogue, roles and permissions matrix, exactly what the audit trail records and who can
query it, and the aggregation switch demonstrated rather than described.

### 7.3 „What if you are gone?" — the cheapest credibility build in the document

The Data Act gives this a mechanical answer that costs almost nothing to make true, because
the substance already ships: an exportable packet plus a browser and CLI verifier. What is
missing is the **statement** — Article 26 requires the switching procedure and formats to be
**published**.

**Build: a switching-and-exit page** (½ day static, and it satisfies three things at once).
Article 26 publication, the Article 28 jurisdiction disclosure that is really the
subprocessor table from § 4.4, and the single best answer to the one-person-UG objection.
Ranked above a trust page because it is a legal obligation the buyer can check rather than
marketing.

### 7.4 What is answered with words, not code

Do not build for these. They are handled in the Vertriebsleitfaden and building for them
would be building for the wrong customer.

| Objection | Why no build |
| --------- | ------------ |
| „Does this make us compliant?" | The answer is „no" and that answer is the asset |
| „No ISO/SOC?" | A certificate is procurement, not product. CSA STAR Level 1 and the EU Cloud Code of Conduct are the cheap moves — § 6.6 |
| „Why not a spreadsheet?" | Already answered on the two things a spreadsheet structurally cannot do. If the answer does not land, § 11's stop rule applies |
| „A tie returned inconclusive" | Correct behaviour. Configure panel 3 for a decisive demo |

### 7.5 Revised ranking, counting only this section

1. **Say the sampling out loud** — zero hours, already true, retires the most common
   objection. Done in the collateral; nothing to build.
2. **Switching-and-exit page** — ½ day, satisfies Data Act Articles 26 and 28 and the
   continuity objection together.
3. **`employmentDataGovernance` as a workspace mode** — the only present hazard on the list,
   and § 6.5's argument for it is unchanged.
4. **Stage-and-rate display plus workload estimator** — 1 day combined, turns 7.1 from a
   claim into something visible in the demo.

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
That is enforceable today, and RateLoop is precisely the evidence that the exemption was
earned. The Commission's own FAQ requires the review to be a *"deliberate examination of the
substance of the content by one or more natural persons possessing relevant knowledge and
professional judgement"*, **substantive and not a cursory approval**, plus a person holding
ultimate legal responsibility. That is a description of this product's data model.

**But the scope is narrow, and this document previously overstated it.** Article 50(4)
covers AI-generated text **published to inform the public on matters of public interest** —
the Commission lists politics, public administration, justice, fundamental rights, public
security, health, environment, consumer safety, and economic, scientific and cultural
developments. **Internal documentation, proposals, customer-service replies and marketing
copy are not in scope.** Pitching Article 50(4) to a Mittelstand manufacturer as *their*
obligation will be corrected by their legal department in the meeting.

So the re-point is a **segmentation**, not a slide reorder:

| Segment | Anchor |
| ------- | ------ |
| Publishers, media, health and environmental communication, consumer information, public bodies and their suppliers, financial and scientific communication | **Article 50(4).** Live today, narrow, and unanswerable without an artifact like ours |
| Everyone else | **The customer's own ISO/IEC 42001 programme.** Has a date, an auditor and a budget line today |

Note also a grace period to **2 December 2026** for the marking and detection requirements.

Sources, retrieved 7 August 2026:
[Commission FAQ on Article 50 transparency obligations](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act) ·
[Article 50 full text](https://artificialintelligenceact.eu/article/50/) ·
[Code of Practice on Transparency of AI-generated Content](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content) ·
[Goodwin: transparency obligations now in force](https://www.goodwinlaw.com/en/insights/publications/2026/08/alerts-technology-dpc-eu-ai-act-transparency-obligations-now-in-force).
Full apparatus in [docs/sales/quellen-und-belege.md](sales/quellen-und-belege.md).

Also note Article 4 was softened to *taking measures to support the development of* AI
literacy — selling literacy evidence is weaker than it was in 2025.

*One dissenting source places Article 26 outside the deferral, but reaches that by putting
it in Section 4, which is notifying authorities. The premise is wrong. Still worth counsel
sign-off before a deck is built on it.*

**Re-verified 8 August 2026, and the deferral is now settled law, not a reading.** The
Digital Omnibus on AI received final Council approval on 29 June 2026 (Parliament 16 June,
423–57): standalone Annex-III high-risk obligations — including Article 26 deployer duties
and Article 27 FRIA — moved to **2 December 2027**, AI embedded in regulated products to
2 August 2028, and **Article 50 was not deferred and has applied since 2 August 2026**.
Corroborated across Gibson Dunn, DLA Piper, Cooley and Covington client alerts; the
dissenting source above is dead. Two German additions worth using in the room: the
**KI-MIG** (the German AI Act implementation act) passed the Bundestag in June 2026, making
the **Bundesnetzagentur** the central market-surveillance authority and complaints office
since 2 August 2026, with the KoKIVO coordination centre operating the KI-Service-Desk —
so the research-list item "get a documented classification from the BNetzA KI-Servicedesk"
now has a statutory footing, and "there is now a German authority with an address" is
itself a Mittelstand conversation opener. A competent buyer will know Article 26 slid;
pitching it as an August-2026 urgency lever mis-signals. The honest frame: Article 50(4)
for the public-interest-text segment today, and December 2027 as the runway argument —
stand up oversight evidence now, be audit-ready when Article 26 bites — for everyone else,
alongside the date-independent drivers (works council, ISO 42001 programmes, liability).

### 6.2 The dependency audit now scans. What is left is a reading of the result.

The audit was replaced (osv-scanner, digest-pinned, weekly schedule): **0 → 1,917 packages
scanned**, sixteen accepted exceptions each with an expiry date, and the hono ReDoS
(GHSA-8j4g-w8fx-2239) is fixed at 4.12.34 rather than pinned below it. Two things a
questionnaire will still surface:

- **`next` has fallen two patches behind** (15.5.21 installed; 15.5.22 and 15.5.23 are on
  npm as of 8 August). Check whether either patch is security-relevant and upgrade; the
  general point stands — the pin sits close enough to the minimum fixed version that any
  Next.js advisory is an immediate upgrade, not a scheduled one.
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

- **Email bombing: closed with two residuals** (`2f607647e`, with a test).
  `lib/auth/emailCodeRateLimit.ts` implements exactly what this item specified: 10 codes
  per hour keyed on an HMAC of the target address (never stored raw), intercepted at
  `/api/auth/better/[...all]` scoped to `/email-otp/send-verification-otp` — the only
  sending endpoint, since `betterAuth.ts` hard-rejects every OTP type but `sign-in` —
  returning 429 with `Retry-After`, failing open on DB error. Two residuals: the 429 body
  is hardcoded English (`route.ts:72`) with no client mapping for its
  `email_code_rate_limited` code — the same class of defect as 8.5's `useFormErrors`
  findings, fix them together — and nothing ever prunes `tokenless_mcp_rate_limits`: no
  DELETE exists anywhere, the schema's `updated_at` index presumes a sweeper that was
  never written, and address-keying adds a permanent row per email. The fixed UTC-hour
  window also allows ~20 codes in a burst straddling the boundary; acceptable, but worth
  knowing when answering a questionnaire.
- **~~`/api/auth/exchange` writes a hash-chained audit row per anonymous failure~~ —
  closed** (`dcc2ddfcf`): the two refusals that need no credentials (wrong Origin, no
  session) now return before the audited block, so anonymous callers can no longer reach
  the `FOR UPDATE` head-row lock or grow the table. The fix chose not-writing over rate
  limiting — an unauthenticated request is not a security event — which is the right
  answer and worth repeating in a questionnaire. `ce163e4a0`'s pool timeouts bound the
  remaining authenticated path.
- **CSP reporting exists now but has no rate limit.** `report-to` and `report-uri` both
  ship to a same-origin endpoint. It is unauthenticated by necessity and bounded only by a
  content-type check and a 16 KiB cap, so a determined caller can still fill the log. The
  right control is a platform firewall rule on the path, not application code — the repo's
  own limiter would turn a log flood into a database-write flood.
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

## Tier 8 — the fourth round: market shape, repackaging, and what the buyer's advisor sees

Added 8 August 2026 from four parallel audits: a line-by-line re-verification (folded in
place above), a market and competitor research pass, a skeptical-buyer weakness review,
and a fresh code gap audit. Sources for the market claims are cited inline; several are
vendor-authored and marked as such.

### 8.1 The market has a shape now, and RateLoop sits in an open seam

Gartner published its **first Magic Quadrant for AI Governance Platforms in July 2026**
(13 vendors; IBM, ServiceNow and Truyo as Leaders — placements sourced from vendor PR, not
the report itself). Those platforms sell AI inventory, regulation-mapped assessments and
policy workflow at $50k+ entry — **paperwork, not actual human review of outputs**.
RateLoop does not compete there; it *feeds* that layer evidence, so integrate rather than
fight (ServiceNow/Jira ticketing, below).

The functional neighbours are elsewhere, and the field moved in 2025–26:

- **Humanloop no longer exists** — acquired by Anthropic, sunset 8 September 2025. Remove
  it from any competitive note that still carries it.
- **LLM observability + annotation** (LangSmith annotation queues, Langfuse — German-founded,
  open-source, strong DACH developer mindshare): engineering tools, single-annotator,
  no compliance framing.
- **Human-in-the-loop approval infrastructure** — the closest neighbours:
  **gotoHuman** (Berlin, EU servers, ~€350–950/month) and **HumanLayer** (approvals via
  Slack/email). Single-approver clicks; no panels, no adaptive sampling, no
  regulator-mapped evidence.
- **The most direct rhetorical competitor is KLA (kla.digital)**: "runtime checkpoints,
  human approval routing, cryptographically sealed evidence an auditor can independently
  verify", auto-generated DORA/MiFID II/AI-Act reports, aimed at finance/insurance/health.
  Their language overlaps this product's almost word for word. Watch them; differentiate
  on panel verdicts, adaptive-sampling economics and named-expert accountability versus
  their per-action policy gating.
- **Platform risk is real and dated:** Microsoft Foundry added native human approval
  gates, manual review queues and Agent-365 governance at Build 2026. For an M365-centric
  Mittelstand that is the default answer. The counter: independence (the evidence is not
  held by the AI vendor being overseen), cross-stack MCP intake, and the regulator mapping.
- German governance-paperwork vendors you will meet in deals: **trail** (Munich),
  **caralegal** (Berlin), **Kertos**, **Modulos** (Zurich). **TÜV SÜD/NORD and DEKRA sell
  ISO 42001 audits — they are channel and validation partners, not competitors.** "The
  evidence pack your TÜV auditor can verify offline" is a strong line.

**Differentiators, ranked:** (1) named-expert *panel* verdicts — everyone else is a
single-approver click; (2) offline-verifiable hash-chained evidence — only KLA claims
similar; (3) adaptive sampling as a cost story — nobody else prices oversight *down* over
time; (4) MCP-native intake — genuinely early; (5) complete German surface + EEA hosting +
SSO/SCIM at a price the MQ vendors cannot touch.

**And the moat question answered honestly:** "evidence record" alone is one sprint from
commodity for any bundler. What no US bundler will build, because it makes no sense
outside Germany and Austria, is **a review system designed to pass a German works
council** — the twelve-gate `employmentDataGovernance` mode, aggregate-only reviewer
views, a shipped Betriebsvereinbarung template and a § 90 BetrVG pack. §§ 6.5/7.2 frame
this as risk mitigation; it is also the **positioning headline**. Ship the mode, then make
it slide 3 rather than an objection answer. The second moat is already in the business
plan and absent from every sales document: **the compounding signed archive under one key
lineage** — leaving RateLoop loses no data (Data Act export), but a new vendor's evidence
history starts at zero for the next surveillance audit. That is a switching cost a
German auditor-minded buyer respects, and it is pro-customer enough to say out loud.

### 8.2 Feature and integration opportunities, ranked for German outreach

| # | Build | Why | Size |
| - | ----- | --- | ---- |
| 1 | **Microsoft Teams notifications, then approve-from-Teams** | M365 dominates the Mittelstand; every neighbour leads with channel integrations | Webhook notify small; Adaptive Cards + bot medium |
| 2 | **n8n community node + template workflows** | n8n is German and huge in DACH automation; its own docs push per-tool-call human approval — RateLoop as the compliance-grade approval target | Small — thin wrapper over the existing API |
| 3 | **Article 50(4) evidence view** — mark reviewed outputs as disclosed/labelled, mapped to the Commission's transparency guidelines and Code of Practice | The only AI-Act obligation live *today*; makes the pitch date-relevant post-Omnibus | Small — reporting over existing records |
| 4 | **Works-council pack + `employmentDataGovernance` mode** | The gate every German deployment must pass; nobody in the neighbour set addresses it | Small-medium; §§ 6.5/7.2 |
| 5 | **Lightweight KI-Anwendungsregister** auto-populated from MCP intake | German SME guidance treats the AI use-case register as step 1 (~7.5 person-days quoted for manual builds); RateLoop already knows which agents submit reviews — a free by-product | Medium |
| 6 | **Slack parity** | Table stakes for the startup segment | Small |
| 7 | **Article 73-shaped incident log** — escalate a Stop verdict into a serious-incident record | Asked for in governance checklists; deferred with high-risk timing, so runway feature | Medium |
| 8 | **LangChain/LangGraph interrupt + OpenAI SDK middleware** | Reaches teams not on MCP; LangGraph interrupts are the standard HITL pattern | Medium |
| 9 | **Jira/ServiceNow ticket on Revise/Stop** | Enterprise ops expectation; integrates with the MQ layer instead of fighting it | Small-medium |

**Skip deliberately:** DATEV and Personio (no demand evidence in this category), Zapier/Make
(low compliance-buyer overlap), and **on-prem** — a real Mittelstand ask but ruinous for a
one-person company; offer EEA single-tenant instead. One trust-signal addition to § 6.6:
a full **BSI C5:2026 attestation is unrealistic at this size, but a C5-criteria
self-assessment that inherits the hosting providers' own C5 attestations** is the German
way to answer the question, alongside CSA STAR Level 1 and the EU Cloud CoC already listed.

### 8.3 The pilot is priced right and packaged wrong

Market check: €2,500 is far under the OneTrust-class entry (~$50k) and comparable to a few
months of gotoHuman; paid-pilot norms are 10–30% of target ACV, creditable on conversion,
45–90 days, one workflow, one owner, one metric. The number is fine. Three structural
problems around it:

- **The price is smaller than the buyer's cost of buying it.** Onboarding any new
  processor costs a German enterprise €10–30k of internal effort (AVV negotiation, DPO
  review, questionnaire, works-council process). €2,500 next to that reads as "this vendor
  does not know what you are about to spend on him". Repackage, don't reprice: make the
  pilot's named deliverables the buyer's own procurement artifacts — Betriebsrats-Pack,
  signed AVV + TOM annex, subprocessor dossier, evidence packet + verifier walkthrough for
  the interne Revision. Then the pilot buys *down* their internal cost. For >250-employee
  prospects (works council near-certain) make the larger scoped pilot the default.
- **"Price after the pilot unknown" is a budgeting veto, not an objection.** Einkauf
  cannot open a pilot leading to an unbounded commitment. Do not publish the list price;
  put a **binding price corridor in the signed order form** ("Anschluss-Jahresvertrag
  zwischen €X und €Y netto p.a., 50% des Piloten anrechenbar"). One clause, counsel
  review.
- **The 30-day conversion deadline on the 50% credit is mathematically unusable by the
  ICP** — the buyer's own AVV plus works-council cycle alone runs longer. It reads as a
  US-SaaS pressure tactic. Change to 90 days or "bis zum Ende des auf den Piloten
  folgenden Quartals".

### 8.4 Weaknesses the earlier rounds under-weighted, with their mitigations

- **The Bonitätsprüfung is the first gate, and it is silent.** Before any questionnaire,
  Einkauf runs a Creditreform check on "Hawig Ventures UG". A UG with minimal
  Stammkapital, no filed revenue and one Geschäftsführer scores into "Vorkasse only / no
  strategic dependency" flags automatically — a disqualification that never generates a
  question you could answer. Mitigations: UG→GmbH conversion with €25k capital is the
  strongest single Bonität signal (~€1–2k notary, weeks of latency); a one-page voluntary
  financial self-disclosure for the vendor file; and align the brand/entity mismatch —
  the product says RateLoop, the Impressum says Hawig Ventures UG; "handelnd als RateLoop"
  plus a registered Marke (~€900 EUIPO, and IP warranty questions appear in every German
  vendor contract) closes it.
- **Breach notification is contractually promised and operationally impossible.** The AVV
  commits to Art. 33-chain notification "without undue delay"; § 6.4 records that no
  alerting of any kind exists, so the operator would learn of an incident from the
  customer. One person asleep or on holiday makes the promise structurally false, and
  German DPOs ask "who is on call?" verbatim. Cheap, honest fix set: uptime + error
  monitoring with paging (1–2 days — also closes the § 6.3 "monitored operational
  failures" gap); a **cyber policy with incident-response services** (~€1–2k/yr — the
  insurer's 24/7 IR hotline is the honest answer to "what is your incident response
  team?"); a written Notfallhandbuch naming a deputy with contractual access.
- **The MIT license is the unused continuity asset.** The business plan treats open source
  purely as a moat problem. Inverted, it is the best answer to "what if you are gone":
  escrow stops being a source-code negotiation and becomes a **runbook + keys + database
  escrow**, because the code is already public. A published continuity plan — "MIT-licensed
  at [repo]; signing keys and an operations runbook in escrow with a German notary; on
  trigger events your data and archive are released; any IT service provider can operate
  it" — folds into the § 7.3 switching page and answers the one-person-UG objection with
  mechanics instead of reassurance. Runbook 2–3 days; escrow ~€500–1,500/yr.
- **Support hours are nowhere stated.** German buyers do not expect 24/7 from a small
  vendor; they expect a stated, honest commitment (Werktage 9–17 Uhr CET, Reaktion am
  nächsten Arbeitstag, Vertretungsregelung). Absence reads as "there is no support".
  Half a day.
- **There is no channel, and the plan's own kill-criteria assume one.** Cold email is
  UWG-banned and personal introductions are not a channel. Best fit, ranked:
  (1) **AI-Act/ISO-42001 consultancies and external-DSB providers** — hundreds of
  Mittelstand retainers, trusted by exactly the privacy/legal budget owner, UWG-clean
  referrals, and their policy deliverables need precisely this evidence to survive a
  surveillance audit. **This is also the only live route to the BAFA lever** the research
  list pronounced dead: a registered Berater delivering the policy mapping as fundable
  consulting with RateLoop underneath. One partnership, two problems. (2) The BMWK-funded
  **Mittelstand-Digital Zentren**, which actively hunt SME demo cases. (3) **Bitkom
  membership + AK KI** — cheap, a credibility logo the Impressum lacks, compliant contact
  surface. (4) Bechtle/adesso-class systems houses: **explicitly not yet** — no margin, no
  certificates, nothing referrable until three references and a pentest exist.
- **The reviewer cold-start is motivational, not just mechanical.** § 7.1.1 fixes friction;
  it does not answer why an unpaid expert responds to name-attributed judgment with
  recorded rationale — accountability without authority, and § 9.9 of the Leitfaden admits
  the personal-liability question has no prepared answer. Three non-code levers: make
  "the reviewed step **replaces an existing approval**, performed by the people who
  already do it" a hard pilot-qualification criterion (net-new review work is an unwinnable
  cold-start — the stop rule should fire); put **named reviewers and a time budget into
  the order form as a Mitwirkungspflicht** agreed at kickoff; and write the one-page
  German **reviewer notice** — what is recorded, what the export strips, that the owner
  and not the reviewer carries the decision. The same artifact the works-council pack
  needs, written for the reviewer.
- **Flip the demo so the prospect plays reviewer.** The buying meeting is Fachabteilung +
  DSB + Einkauf + eventually a works-council assessor; none of them can reproduce the
  MCP side, and alt-tabbing into an IDE recodes the product as Entwicklerwerkzeug. The
  reviewer path and evidence view are fully browser-based and German: invite two of the
  prospect's own people as reviewers live, fire the request from the presenter's machine
  off-screen, close on `/docs/evidence/verify`. Zero code. Add a 3–4 minute German
  screencast of the full loop for the DSB to re-watch internally, and prefer a chat
  surface (Claude Desktop / ChatGPT connector) over an IDE when the request side must be
  shown.

### 8.5 New defects found in this round's code audit

**Collateral and surface:**

- **The sales `.pptx`/`.docx` binaries are stale by their own README's admission** — they
  predate the correction rounds and still carry claims the markdown has since forbidden,
  and the claim gate cannot read OOXML (§ 1.1), so this recurs after every correction
  cycle forever. Delete the binaries and present from rendered markdown/PDF, or add a
  markdown→Office build step so the binaries are outputs, never artifacts. This is the
  exact "German buyers verify before they sign" failure mode, living inside `docs/sales/`.
- **The deck has no company, no team, no reference.** A German buyer finds the one-person
  UG in the Impressum within minutes; finding it *after* a polished anonymous deck
  converts "small vendor" into "vendor hiding something". One honest founder slide —
  background, the continuity mechanics from 8.4, the open-source fact — turns the
  weakness into the transparency posture the rest of the deck trades on.
- **The homepage leads with AI-assisted *hiring* as a flagship use case**
  (`page.tsx`, `docs/use-cases`) — the worst possible example for this market: Annex III
  high-risk, § 95 BetrVG Auswahlrichtlinien, AGG exposure, and it hands the works council
  its strongest framing on first visit while the deck carefully avoids high-risk anchors.
  Swap for a low-risk example that also feeds the Article 50(4) segment (marketing,
  customer replies, publishing). Hours.
- **The landing page's social-proof strip is wired to mock-money chain stats**
  ([`socialProof.ts`](../packages/nextjs/lib/home/socialProof.ts)): "USDC paid" and
  "verified humans" render from indexer totals that belong to the frozen paid lane, where
  "USDC" is a Base-Sepolia `MockERC20`. Zero-guards hide them today; any nonzero test
  activity puts fabricated-looking dollar figures on the most-visited page. Gate both
  items behind the capability flags like everything else. Hours, and it closes a latent
  Tier 1 violation.
- **English headings leak into the German docs pages** a technical evaluator will open:
  the phrase catalogue has no entries for the `/docs/smart-contracts` H1 "Inspect Fund
  Custody" and two H2s, the evidence page's "OSCAL 1.2.2 component definition" link text,
  and an SDK-page heading — so `/de` renders them in English amid German body copy.
  Five phrases, minutes. Systemically: nothing enforces phrase-catalogue coverage, so
  every future English literal ships silently on `/de`; a literal-extraction coverage
  test (~half a day) pins it shut.
- **The Impressum has no USt-IdNr. and one contact channel.** § 5 Abs. 1 Nr. 6 DDG
  requires the VAT ID *soweit vorhanden* — and a UG invoicing reverse-charge will have
  one. § 3.1 covers validating the *customer's* ID; nothing lists your own. Add it and a
  second fast contact channel. Minutes once the ID exists.
- **The root error boundary is hardcoded English** (`app/error.tsx`) while the localized
  one sits a level down — and the root one catches exactly the failures upstream of locale
  resolution, the database-outage class a demo would hit. No `global-error.tsx` exists.
- **The operational documentation a German admin needs is English-only** — the owner
  guide and everything in `docs/`. The works-council external assessor (§ 80 Abs. 3
  BetrVG — statutorily presumed, employer-paid, reads *your* documentation) would receive
  an English manual for a German labor-law assessment. 1–2 days — **after** the
  Arbeitsbereich/Workspace terminology fix (5.5), or the guide fossilises the split.

**The signed-in German UI — the phrase-catalogue layer has holes the key layer hides:**

The app translates through two layers: next-intl keys (verified complete — an AST scan of
every namespace against `messages/de` finds **zero** missing keys) and an exact-string
phrase catalogue used by several client panels, where `translateCatalogString` falls back
on a miss to **per-substring substitution and then raw English, without warning**. That
fallback produces the worst class of defect for a live demo — half-German sentences:

- The members panel's destructive confirm buttons render **„Entfernen member"** and
  **„Widerrufen invitation"** (`WorkspaceMembersPanel.tsx:429`), and the removal prompt
  renders „Entfernen Max Mustermann **from this workspace?**" (`:418`). The worst-looking
  finding of the round, on a panel every evaluator opens.
- The billing card mixes languages mid-sentence: „**Aktualisieren** the payment method
  below before upgrading.", „Online upgrades are temporarily **unverfügbar** for this
  workspace." (`WorkspaceSettingsClient.tsx:159-174`), plus untranslated "Free",
  "Creating invoice…", "Loading this workspace's billing status…".
- The SSO/SCIM section — the one an enterprise admin will open — is largely English:
  "Configure SSO and SCIM", "Copy this SCIM bearer token now", "domain verified /
  verification required", and a German dialog heading over an English deletion warning
  (`WorkspaceSettingsClient.tsx:1465-1825`).
- All four workspace-deletion summary sentences, one half-substituted („…its balance
  remain **aktiv**…") (`WorkspaceDeletionPanel.tsx:195-200`).
- **Raw server error text reaches German screens**: `useFormErrors.ts:68-76` prefers the
  raw `Error.message` over the caller's localized fallback, so API validation strings like
  "Workspace name must be 1-120 characters." and "Choose a workspace role." surface
  verbatim under German fields — including on the wizard's first step. A failed fetch
  prints "Failed to fetch" into a `role="alert"`. `WorkspaceReviewersPanel.tsx:255` shows
  the correct pattern (discard the cause); the inconsistency is accidental. Also
  `welcome/actions.ts:12` throws untranslated English that escapes to the error boundary.
- Fix shape: add the missing phrases to the catalogue, flip `useFormErrors` to prefer the
  localized fallback, and — same lesson as the public surface — add a coverage test, since
  the catalogue fails silent by design. Also: the role dropdown maps "Admin" →
  „Administration"; it should be „Administrator".
- Verified clean on the same pass, worth keeping: no raw next-intl keys anywhere, sign-in
  fully translated, no dead-end routes on the journey, empty states present, no console
  noise, no hardcoded literals in the 2,633-line setup flow.

**Infrastructure and privacy:**

- **No SPF/DKIM/DMARC story exists anywhere in the repo** — no DNS records, docs, or
  checks; the sender address is validated only for shape, and the readiness preflight
  checks only non-emptiness. Deliverability of the reviewer invitation — the product's
  most important email — currently rests on undocumented Resend dashboard state. Document
  the DNS records and add a preflight check for the expected sender domain.
- **No unauthenticated health endpoint** — nothing an uptime monitor can probe without
  credentials; combined with § 6.4's no-alerting finding, the 8.4 monitoring fix should
  add one.
- **The request pool has no `max` or idle timeout configured** — `pg` defaults to 10 per
  lambda instance, unbounded from Postgres's view under concurrency. One config object.
- **The privacy notice never names the IP address** although sessions store it in full
  (35-day purge is real and runs every five minutes — say so), and **two functional
  cookies (`rateloop_locale`, `rateloop-theme`, both 365-day) are missing from the cookie
  inventory**. Both consent-exempt; the gap is disclosure, not consent. Minutes each.
- **Text contrast has a systemic hole**: the token remap covers opacity variants up to
  `/55`, but `/60` (173 uses) and `/65` (116 uses) fall at or below 4.5:1 on white for
  body text — and the axe `color-contrast` rule is explicitly disabled in the
  accessibility test suite that covers the landing page. Extend the remap and re-enable
  the rule. Relevant to the § 5.4 EN 301 549 conformance report.
- **An 11 MB unreferenced promo video ships in `public/`** (plus its poster and captions),
  and the prepared `og-image.jpg`/`twitter-image.jpg` are unused while metadata points at
  the 158 KB favicon with a `summary` card — so a link shared into Teams or LinkedIn by a
  prospect renders with no real preview image. Delete the dead files, wire the OG images,
  and add per-page `openGraph` metadata: `getLocalizedPublicMetadata` currently gives ~14
  public pages one shared description. Also: no sitemap exists and `robots.txt` has no
  `Sitemap:` line; hreflang is HTTP-header-only. 1–2 hours together.
- **Deadline reminders share the `assignmentAvailable` preference toggle** — a reviewer
  cannot mute reminders while keeping availability notices. Design note, not a defect;
  record it so nobody re-finds it.
- **The CSP grants the four wallet origins unconditionally** while its own comment claims
  they are gated like World ID. The origins are load-bearing (see the connector rule in
  `AGENTS.md`) — do not remove them; either gate them with the connector flag or fix the
  comment so an auditor reading the file is not told something the grants contradict.

### 8.6 Revised ordering, whole document

1. **Tier 0 plus its new neighbours, one batch, 1–2 days**: domain mailbox everywhere
   (including `WorkspacePlanCards.tsx:33`), booking link, Impressum USt-IdNr. + second
   contact channel, support-hours page, swap the hiring use case, gate the social-proof
   chain stats — and the German-surface fixes from 8.5: the five public phrase-catalogue
   entries, the signed-in panels' missing phrases, and the `useFormErrors` flip so raw
   English API errors stop reaching German screens. These are the strings a live
   evaluation actually renders.
2. **Finish the email-code rate limit's residuals** (translated 429, table pruning), and
   land the monitoring fix-set from 8.4: uptime/error alerting with paging + an
   unauthenticated health endpoint — it simultaneously closes § 6.3's "monitored
   operational failures", the breach-notification gap, and a questionnaire line.
3. **The decision that governs everything else** (top of this document), then Tier 1
   claims, then the Tier 4 paper (order form with price corridor and Mitwirkungspflicht
   clause, AVV PDF, TOM annex) — now including the Data Act terms from 5.2 and the
   continuity/escrow statement from 8.4 folded into the § 7.3 switching page.
4. **The works-council pack and `employmentDataGovernance` mode** (6.5/7.2/8.1) — the
   moat, the calendar gate, and the positioning headline in one build.
5. **Demo repackaging** (8.4): reviewer-plays-the-buyer script, German screencast,
   panel of 3.
6. **Channel before volume outreach** (8.4): two consultancy/DSB partnerships and a
   Mittelstand-Digital Zentrum slot are worth more than any list of cold contacts, and
   the BAFA lever only exists through the first.
7. Then the standing build list: B8 browser path (unchanged scope, § 5.11), seat
   substitution (7.1.1.B), B4 verifier download, B7 email localisation — plus Teams
   notifications and the n8n node from 8.2 as the first post-pilot integrations.
