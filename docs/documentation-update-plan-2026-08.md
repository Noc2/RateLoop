# Documentation update plan — August 2026

Written 6 August 2026 against `ecf845a29`, from four independent agent reviews that
checked every document in `docs/` against the code rather than against each other.

Two documents were removed in `ecf845a29` because their work was finished. This plan
covers the rest. It is ordered by consequence: a document that contradicts the code can
cause someone to reintroduce a defect, so it is fixed before a document that is merely
out of date.

Every item below names the file and line to change, what it currently says, what the
code shows, and the proposed replacement. Nothing here is a rewrite for style.

## How to use this plan

Work top to bottom. Tier 1 items are contradictions that can mislead an implementer;
they should land together. Tier 2 items are factual drift. Tier 3 items are structural
and can wait for a quiet moment.

After any edit, run the documentation guards — several documents are read by tests:

```bash
yarn --cwd packages/nextjs test
```

Those tests are sentence-presence guards over specific disclosure claims, not over whole
documents, so passing them does not mean a document is accurate. It means the guarded
sentences are intact.

## Tier 1 — contradictions with the code

### 1.1 The design of record asserts a safety posture the code contradicts

`docs/tokenless-immutable-implementation-plan-2026-07.md:86-87`

Says adaptive review reports `safety_gates_unavailable`, remains at 100%, and resets any
reduced scope to calibration until drift and severe-disagreement gates are backed by
persisted scope evidence.

The code sets `ADAPTIVE_SAFETY_GATES_AVAILABLE = true`
([`adaptiveReviewService.ts:49`](../packages/nextjs/lib/tokenless/adaptiveReviewService.ts)),
the only producer of `safetyGatesAvailable` (`:523`), so the branch this sentence
describes is unreachable. `docs/rateloop-tokenless.md:395` already records this as
resolved drift — meaning the design of record and the descriptive document currently
disagree, and `AGENTS.md:32` gives precedence to the one that is wrong.

**This is the most consequential item in the plan.** A reader following the documented
precedence today would reintroduce the stale behaviour.

Replace with:

> The drift and severe-disagreement gates are derived from persisted, scope-specific
> observations; missing evidence fails the individual gate closed rather than disabling
> the ladder. A window that fails any gate resets the scope to 100% calibration.

### 1.2 The CLI exit-code claim is flatly false

`docs/implementation-plan.md:566` (price lever P6)

Says `wait --until-ready` returns exit code 1 on every error path, so a pipeline cannot
distinguish a failed review from a timeout from a network error.

[`packages/agents/src/exitCodes.ts:14-33`](../packages/agents/src/exitCodes.ts) defines
seven distinct codes — `0` ok, `1` unexpected, `2` usage, `3` notPublishable, `4`
timeout, `5` api, `6` noVerdict — mapped at `:57-66` and wired at
[`cli.ts:322,356,365`](../packages/agents/src/cli.ts). Shipped in `c339d8ca7` on
3 August 2026, the same day §6a records as its verification date.

Delete P6 and renumber, or replace with:

> **Shipped 3 August 2026.** `wait --until-ready` returns distinct codes for
> not-publishable (3), timeout (4), transport error (5) and compensated-no-verdict (6).
> What remains is binding the wait to an immutable assurance run rather than an
> operation key.

The same correction applies to `docs/evaluation-platform-gaps.md:27`, whose CI
integration row describes this as the optional remainder.

### 1.3 A migration head is copied into prose, which the design of record forbids

`docs/implementation-plan.md:840-842`, plus `:790`, `:812`, `:1020`, `:1120`

Says the journal runs through `0189` and the next number is `0190`. The actual head is
`0191_remove_quote_api_key_scope` — 191 entries in
[`_journal.json`](../packages/nextjs/drizzle/meta/_journal.json). `0190` and `0191`
landed on 4 August, before this document's most recent edit.

`docs/tokenless-immutable-implementation-plan-2026-07.md:34-36` explicitly says to read
the journal entry directly "rather than trusting a head number copied into prose here,
which drifts as migrations land". This document does the thing the design of record
forbids, and has now drifted twice.

Replace the head references with a pointer to the journal rather than a number.

### 1.4 The external quote endpoint is documented as authenticated

`docs/tokenless-immutable-implementation-plan-2026-07.md:161`

Says the authenticated API and SDK use `quote -> ask -> wait -> result`.
[`app/api/agent/v1/quote/route.ts:33-56`](../packages/nextjs/app/api/agent/v1/quote/route.ts)
resolves no principal; it rate-limits and accepts only `visibility: "public"`. Migration
`0191` stripped `quote:read` from every stored key scope.

Replace with a sentence that separates the unauthenticated quote step from the three
credentialed steps.

### 1.5 Two documents reference a deleted document

`docs/tokenless-immutable-implementation-plan-2026-07.md:5` and `:461`,
`docs/tokenless-legal-revenue-reference-2026-07.md:5`, `docs/implementation-plan.md:16`

All point at a "production-readiness register". `docs/tokenless-production-readiness-2026-07.md`
was deleted in `a6861fe57`. The surviving artefact is the executable check
[`check-tokenless-production-readiness.mjs`](../packages/nextjs/scripts/check-tokenless-production-readiness.mjs),
whose frozen `DEFAULT_HOSTED_RELEASE_CAPABILITIES` map at `:99-106` is the real gate.

Repoint all four references at the script.

## Tier 2 — factual drift

### 2.1 `docs/tokenless-legal-revenue-reference-2026-07.md`

| Line  | Says                                                      | Code shows                                                                                                                                          |
| ----- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:12` | Fee "5–10% of bounty (start ~7.5%)"                       | 10% — `HUMAN_REVIEW_PLATFORM_FEE_BPS = 1_000` ([`humanReviewRequestPreparation.ts:22`](../packages/nextjs/lib/tokenless/humanReviewRequestPreparation.ts)), test-pinned |
| `:12` | Receipts itemise "bounty / platform fee / VAT"            | No VAT line on any bounty receipt; economics carry base / fee / attempt reserve / maximum charge. VAT exists only on the Stripe subscription lane   |
| `:14` | Revenue stack leads with take rate, then SaaS, then x402  | Inverted. The only live lane is the Stripe subscription; the take rate is gated off; x402 is a funding mode, not per-call read pricing              |
| `:44` | B2B gate is "self-declaration + VAT-ID"                   | Operator-verified trader status with recorded method, reference hash, verifier and expiry ([`businessCustomerEligibility.ts:60-67`](../packages/nextjs/lib/billing/businessCustomerEligibility.ts)) |

None of these sit in a test-guarded region, which is why they drifted.

### 2.2 `docs/tokenless-agent-human-review-owner-guide.md`

Two configurations are presented as ordinary choices but cannot be selected at all:

- `:20-24` The audience table caveats only Hybrid. **RateLoop network** is equally
  unreachable — `GOVERNED_REVIEWER_EXPERIMENTS.publicNetwork = false`
  ([`reviewCapabilities.ts:67-73`](../packages/nextjs/lib/tokenless/reviewCapabilities.ts)),
  and every save path throws 409. Add the same caveat, and to the Invited "paid in USDC"
  cell, which needs a separately activated paid lane.
- `:59-64` "Let the agent ask each time" is described as "initially limited to
  RateLoop-network review". It is entirely unreachable: `agent_per_request` hard-requires
  `audience: "public_network"`, which is blocked. Say so.
- `:70` "The standard presets are 20 minutes, 1 hour, 4 hours, and 24 hours." There are
  no presets — it is a free amount+unit input clamped to 1200–86400 s, default 3600.
- `:112-117` The MCP tool list omits `rateloop_get_assurance_state`.

### 2.3 `docs/rateloop-tokenless.md`

- `:305-307` Says the root README "cites a deployment a full generation out of date".
  It now cites `tokenless-v4` at block `45115708` correctly. The rest of the sentence —
  that the README advertises USDC payment and proof-of-human admission with no
  availability caveat — still holds.
- `:291-293` "fourteen of seventeen capabilities … Five claims are permanently
  forbidden" → sixteen of nineteen, and eight forbidden
  ([`publicEvidenceClaims.ts:4-23,33-55`](../packages/nextjs/lib/tokenless/publicEvidenceClaims.ts)).
- `:284-286` A clause is duplicated verbatim within one sentence. Delete the second.
- `:44-47` Conflates two status vocabularies. The assurance-loop terminal states are
  `skipped | completed | inconclusive | failed_terminal | cancelled_before_commit`;
  `publishable` / `delisted` and the three settlement outcomes belong to the separate
  paid handoff verdict.
- `:375` "roughly 200 SQL statements order without limiting" has drifted to ~252. Per
  this directory's own rule, make it a lint rather than a number in prose.
- `:394` A row in the §9 drift table states a claim and a reality that agree. Either
  restate the prior claim it corrects or delete the row.

### 2.4 `docs/tokenless-environment-parity.md`

The strongest document of the set; two small fixes.

- `:83` `NEXT_PUBLIC_TARGET_NETWORKS=84532` — this variable exists nowhere in the
  repository. It is a Scaffold-ETH leftover; the chain is pinned by `TOKENLESS_CHAIN_ID`,
  already listed at `:87`. Delete the line.
- `:84-85` Refers to "the public browser RPC" without naming it. It is
  `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL`. Name it — exact variable names are this document's
  entire purpose.

### 2.5 `docs/business-plan.md`

- `:218-220` and `:462-463` Say the pricing page promises a decision allowance the code
  does not support. That copy was removed on 4 August and
  [`WorkspacePlanOverview.test.tsx:60`](../packages/nextjs/components/pricing/WorkspacePlanOverview.test.tsx)
  now forbids it. The meter is unenforced, not mis-advertised. Delete the follow-up
  instruction at `:462-463`.
- `:117` Cites `adaptiveReview.ts:175` for HMAC-keyed sampling. That line is a
  mid-argument property and the file contains no `createHmac`. The real site is
  [`reviewSampling.ts:21`](../packages/nextjs/lib/tokenless/reviewSampling.ts).
- `:121` Cites `directPrivateReviewEvidence.ts:296`; the assignment is at `:301` and
  carries a `source` field the quote omits.
- `:139-140` Says three panel-size bounds disagree. There are four: database 1–100,
  server 2–100, SDK 1–500, setup UI 2–500. A panel of 101–500 entered in the UI is
  accepted client-side and rejected by the server.

### 2.6 `docs/target-audience.md`

- `:258`, `:272-274`, `:336-338`, `:347-349` build the segmentation on a 250-decisions
  per month quota. The pricing table at `:40-44` is correct and `:46-48` correctly says
  the caps are not uniformly enforced — but the later sections then treat the quota as
  binding, and one segment is disqualified solely because of it. On the live invited
  lane there is no decision cap at all; the enforced limits are active agents and active
  private groups. Rework the volume test around the limits that actually bind.
- `:72-73` "Live landing statistics read zero verified humans and zero paid out." Zero
  values are filtered out, not rendered
  ([`socialProof.ts:48-52`](../packages/nextjs/lib/home/socialProof.ts)); the page shows
  no statistics row at all.

### 2.7 `docs/product-opportunities.md`

`:71-73` carries the same stale half as business-plan `:218-220` — the public allowance
copy is gone, so the remaining problem is an unenforced meter, not a false promise.
Everything else in this document verified true, including the sixteen-of-nineteen count
and the 82-site canonicalisation finding.

### 2.8 `docs/implementation-plan.md` (beyond Tier 1)

- `:543` "229 API routes and 42 pages" → 230 routes; 42 pages is exact. State the route
  count approximately, since it will drift again.
- `:438-439` Rows 2.3 and 2.4 are marked "Implemented", but
  `supervisionOverridePatterns.ts` and `reviewerEngagement.ts` have zero non-test callers
  — the same condition the document treats as disqualifying for row 2.1. Mark them
  "implemented and tested; no production caller".
- `:481-482` and `:846-848` Say the divergent canonical-JSON implementations should be
  replaced. The RFC 8785 producer exists and v4 packets use it, but twelve digest-bearing
  sites still sort with `localeCompare`, including the shipped SDK's `intentDigest` and
  the GRC evidence hash — so two machines can still derive different digests there.
  Narrow the claim to what remains.
- `:490` and `:448` carry "Verified 3 August 2026 against `8e9a01e4a`", now 152 commits
  stale. Re-baseline or drop the markers.

### 2.9 `docs/evaluation-platform-gaps.md`

Six of seven inventory rows survived 404 commits unchanged. Three edits: the CI row
(item 1.2 above), `:25` "Results bind observed values" → results bind a *hash* of the
observed value, and `:44-46` expansion step 3, half of which is built.

### 2.10 `docs/legal-position.md`

§1, the AI Act analysis, is the durable half and is now validated by shipped product
copy. §2, "The claims the product currently makes", is the stale half: seven of its eight
defects have been fixed, several with negative regression tests that assert the bad copy
is gone. Rewrite §2 as a record of what was found and fixed, keeping the two findings
that are still live — the two meanings of "verified", and the `/legal/` tree carrying no
AI Act claim.

A separate research pass settled four open questions. Its findings:

**Timeline.** The table is stale in one row and wrong in two sentences. 2 August 2026 has
passed: Article 50 transparency, Chapter IX market surveillance including the new
Articles 75a–75d, and Article 101 GPAI fines are all now in force. Two dated items are
still ahead and the document names only one — 2 December 2026 (Art. 50(2) marking for
pre-existing generative systems, plus the two new Art. 5(1)(ba)–(bb) prohibitions the
omnibus inserted) and 2 September 2027. Separately, `:29` says Articles 12, 14, 26 and 99
"appear unamended"; Article 99 *was* amended, gaining a capped fine tier for small
mid-caps and express Member State power to use warnings and non-monetary measures. And
`:84-85` says a Commission implementing act for the Art. 72 template was due 2 February
2026; the omnibus removed that requirement and replaced it with guidance due 2 September
2027 — which strengthens the document's own commercial argument, since that leaves
providers no template for most of the runway.

**The three frameworks.** They are not the same kind of instrument and should never be
listed as though they were. ISO/IEC 42001:2023 is certifiable and RateLoop holds no
certification; it was adopted as EN ISO/IEC 42001:2026 by CEN on 13 March 2026, which is
*not* a harmonised standard cited in the OJ and confers no Article 40 presumption. The
NIST AI RMF is voluntary and creates no obligation. FINRA is the only binding one.

**Two claim-integrity defects in code, not prose.** These matter more than the doc edits
around them:

- [`assuranceComplianceMap.mjs:208-218`](../packages/nextjs/config/assuranceComplianceMap.mjs)
  maps "records of human review, configured escalation, model metadata … for a member
  firm's supervision analysis" to FINRA **Regulatory Notice 24-09**. The notice supports
  none of that — it is a reminder that existing rules apply to Gen AI, and its only
  mention of a human is a parenthetical reference to compliance personnel receiving
  surveillance summaries. The language actually relied on is from FINRA's **2026 Annual
  Regulatory Oversight Report** (9 December 2025). Re-cite it.
- The same file references bare `A.6` (`:132`), `MEASURE` (`:170`) and `MANAGE` (`:180`)
  — whole life-cycle objectives and whole RMF functions. That claims far more coverage
  than the evidence supports, and is the same one-to-one checklist defect this document
  criticises in the Article 14(4) cards, at framework scale. Narrow to A.6.2.6/A.6.2.8
  and A.9.2; and to MEASURE 2.8, MEASURE 3.3, MANAGE 2.4 and MANAGE 4.1, all of which
  RateLoop genuinely evidences.

**Rule 3110 is the strongest citation available to this product, and §1 analyses none of
it.** Rule 3110.07 requires evidence of review to identify the reviewer, the item
reviewed, the date, and the action taken — a binding, named record schema matching what
the product already emits, with no new AI regulation required. Rule 3110.08 independently
reproduces the document's own Article 26 argument: review may be delegated to persons who
need not be registered, while the principal stays responsible. **The public paid network
fails 3110 for exactly the reason it fails Article 26(2) — nobody designated it.** Add a
FINRA column to the Invited/Public table at `:138-141`.

**The 17a-4 tension has already resolved itself.** The securities row was deleted and its
absence is asserted by regression tests. Adding a *supervision* rule where a
*recordkeeping* rule was removed is a correction, not a reversal: 17a-4 prescribes a
system a vendor cannot supply, 3110 prescribes evidence a vendor can. Rewrite "To avoid"
item 7 to draw that line explicitly rather than banning the word FINRA. One loose end:
`s3-object-lock-delivery-receipt` (`:59-65`) is now an orphaned evidence artifact,
referenced by no mapping since the 17a-4 row went. Attach it to the Rule 3110 mapping as
the retention leg or drop it from the map — the capability itself is real and shipped.

**eIDAS.** `:241` says RateLoop performs "self-attestation with no independent anchor".
That is now out of date: every completed attestation is published to the Sigstore public
Rekor log, which is a core subprocessor, and the inclusion proof is verified against a
pinned key. The accurate phrasing is "an independent anchor with no qualified status".
What remains open is genuinely narrower than the document implies, and should be stated in
two parts: no Article 42 qualified timestamp — the readiness checker already gates hosted
release on `qualifiedTimestamping`, and its wording demands issuance-time Trusted List
validation, which the current OpenSSL path check does not do — and, more importantly, the
Article 41(2) presumption reaches **time and integrity only**. It would remove the
argument that a bundle was backdated. It would not remove the argument that the review
did not happen as recorded, which is the burden that actually puts RateLoop in the witness
box. The current remedy paragraph reads as though procurement closes the whole gap; it
closes half.

**One thing to say plainly while rewriting §2:** the compliance map's disclaimer
discipline — a per-mapping `nonClaim` plus a file-level claim boundary — is better than
the AI Act pages this section criticises. Apply that pattern outward, not the reverse.

## Tier 3 — structural

### 3.1 The deployment key is duplicated across five places

The `tokenless-v4` key and block `45115708` appear in the implementation plan, the parity
document, `rateloop-tokenless.md` twice, and the root README. This is the highest-churn
fact in the repository — `6ee7655c5` had to touch all of them.

Keep the literal key in `tokenless-environment-parity.md` only and have the others point
at it. It is already asserted in code and enforced by the readiness script.

### 3.2 Three more facts are stated in three places each

The platform-secrets custody boundary, the Rekor/RFC 3161 anchoring rule, and the
isolation rules each appear in three documents. `tokenless-environment-parity.md` is the
natural home for all three; the others should defer to it.

### 3.3 The adaptive ladder is specified twice

Normatively in the design of record and descriptively, with more detail, in
`rateloop-tokenless.md`. They currently disagree (item 1.1). After that is fixed, the
descriptive document should cross-reference the thresholds rather than restate them.

### 3.4 The revenue-blocker triple is stated in four places

Stripe off, business verification unreachable, meter unwired — in `business-plan.md`,
`product-opportunities.md`, the commercial research document and the pre-outreach
operations record. Two of the four are stale on the same sub-claim, which is exactly the
failure mode this directory's rule warns about. Let `product-opportunities.md` own it and
have the others link.

### 3.5 The commercial research document is misnamed

`docs/tokenless-commercial-product-expansion-research-2026-08.md` has the H1 "RateLoop
tokenless: pre-customer product readiness plan", and its §1 exists to retract the
expansion framing. The filename misdirects. Rename to
`tokenless-pre-customer-readiness-plan-2026-08.md`, or change the H1 — but not neither.

Its §2 and §8 duplicate `business-plan.md`; its §7 do-not-build list is a better version
of `product-opportunities.md` §E and should absorb it. That is roughly 120 lines of
removable duplication, not the whole document.

### 3.6 The checked-in evidence file can drift silently

`docs/evidence/population-estimate-validation-2026-07.json` is generated by a tested
script, but the test asserts the generator's output and never that the checked-in file
matches a fresh run, and no CI job invokes the generator. Add a
`deepEqual` against the file to the existing test, and cite the file from
`business-plan.md:151`, which discusses the decision it records without pointing at it.

## Open questions this plan cannot settle

These need a decision from the operator, not an edit.

1. **Which pricing hypothesis is real.** The commercial research document (`:628-636`)
   says the public $29 Early Access anchor can remain. The German Preisempfehlung in
   `docs/sales/`, dated the same day, opens by recommending its deletion and proposes a
   €2,500 pilot then €249 / €799 / from €30,000 per year. Both are internal, current, and
   contradictory. One owner, one document.

2. **Whether `docs/sales/` belongs in this repository.** The binaries are current and
   substantive, and the app ships a real German locale, so they are not foreign. But they
   are unreviewable in diff, cannot be asserted by a test, and carry customer-facing
   claims outside every guard here — at least one of which the in-product claim gate
   actively blocks. Options: keep and reconcile; keep the binaries but add a markdown
   sibling carrying the decisions; or move them out and leave a pointer.

3. **Whether the nine-row Article-requirement table should survive.** Carried over as the
   one unresolved item from the removed remediation plan. It still renders at
   `docs/evidence/page.tsx:38-88`, reframed as a shared-responsibility matrix.

4. **One missing test assertion**, also carried over: no test walks OAuth generation
   N → N+1 → replay → recovery; `agentOAuth.test.ts:257-328` stops at family revocation.
   This belongs in code as a TODO or an issue, not in prose.
