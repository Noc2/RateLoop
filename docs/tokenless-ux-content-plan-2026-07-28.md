# Less text, same meaning — plan, 28 July 2026

A quantified content audit, and what to cut. Nothing here changes the visual
design; most of it deletes or relocates words that are already there.

---

## 1. The measurement

23,369 words of user-visible copy across 2,983 strings — 11,424 in the signed-in
app, 11,924 on the public site. Counted from the TypeScript AST over JSX text,
labels, hints, placeholders and error messages; excluding tests, identifiers and
class strings.

**The concentration is the finding.** 30% of all copy sits in 4% of the strings.
119 strings of 31+ words carry 6,960 words. That is the lever: this is not a
thousand small trims, it is about a hundred specific paragraphs.

### The heaviest surfaces

| Surface | Words | Words per control |
| --- | --- | --- |
| `/agents` first-run setup wizard | **2,312** | 30.0 |
| `/legal/privacy` | 1,937 | (a document — leave it) |
| `/agents?tab=connect` | 1,641 | 26.0 |
| `/human?tab=discover` | 1,501 | 23.1 |
| `/handoff` | 862 | **33.2** |

Docs and legal pages having a high words-per-control ratio is normal — they are
documents. The number to act on is the app column, and two entries stand out.

**The setup wizard is the single heaviest thing in the product — 2,312 words, more
than the privacy policy — and it is the first thing a new customer sees.** Over
half of it lives in one 2,501-line file.

`/handoff` at 33 words per control is the other outlier: a task flow where every
control is wrapped in a paragraph.

For contrast, `/welcome` is 57 words across 3 controls and the app shell is 32
words across 19. The product can be terse; it just isn't, in the places that matter
most.

---

## 2. What must not be cut

Flag these so a later pass does not trim them by accident.

**Consent gates**, each of which is the legal basis for an action: the
non-sensitive-data confirmation on handoff, sanctions-screening consent, the exact
paid-review terms acceptance bound to a rendered hash, the recovery-backup
confirmation, and both confidentiality acceptances. One of those — *"…and will
follow the privacy rules above"* — is a **live cross-reference to the list rendered
directly above it**, so that list cannot be moved or shortened without breaking the
sentence.

**Age and identity attestation, tax and DAC7, sanctions.** **Reviewer
confidentiality**, including the terms hash. **Irreversibility disclosures** before
an on-chain publish. **Deletion and retention** clauses. **Spend consent** before
saving a policy that can cost money. **One-time secret warnings.** And the
decision-support disclaimer: *"This panel is decision support, not an automatic
release, safety, legal, or compliance approval."*

**All 4,705 words of `app/(public)/legal/*`.** These rank high in the table and are
documents, not UI.

Worth noting: there is **zero** "please note" or "keep in mind" filler anywhere. The
hedging in this product is substantive, not padding. The problem is placement and
repetition, not the sentences themselves.

---

## 3. The four cuts, in order of value

### Cut 1 — 44 disclaimers that render unconditionally (1,019 words)

Paragraphs of 12+ words with no conditional guard. They are not wrong; they are
shown to people they do not apply to, which is what trains users to skip text.

The one already known:

> "This run has no immutable agent-version reference, so it is excluded from
> per-agent comparisons."

renders on **every** run card. It is true today only because the type permits one
value — **it will silently start lying the moment attribution lands.**

Others, each verified:

- The 67-word tlock disclosure renders **before any review is selected**, with zero
  saved reviews, and for reviewers whose eligibility was *declined*.
- The paid-work reassurance block sits outside every branch of its own status
  conditional, so it renders for declined users — **directly contradicting the
  branch above it**.
- 95 words of Merkle/Rekor/TSA verification theory render when there is nothing to
  verify, beside text saying so. The whole "Verify an export" section renders on the
  zero-evidence empty state.
- "Safe access · No spending or private workspace content" renders for **all**
  integrations, including ones badged `legacy credential` with `advisory`
  enforcement.
- The workspace-stop release consequence renders when no stop is or ever was
  engaged — and `const engaged` already exists on line 115, unused.
- Join-code warnings render **before any code exists**.
- "Optional and separate from the guaranteed bounty" renders when compensation is
  unpaid, i.e. when there is no guaranteed bounty.
- Keyboard shortcuts render above an empty state where the keys do nothing.
- A "Payment effect: None" field is hardcoded — the type can only say one thing.

**Guarding these is pure subtraction with no rewriting.** In several cases the
guard variable already exists.

### Cut 2 — the label tier (50 eyebrows across 27 files)

Every panel renders `eyebrow → heading → subtitle`, so a user who clicked a tab
labelled "Evidence" then reads "EVIDENCE" and "Decision records and exports".

The worst is a **four-deck header above an empty state**: eyebrow, heading,
description, and keyboard shortcuts — all four rendering when the list is empty.

**The fix already exists and is unused.** `ui/PageHeading` uses a discriminated
union to make `eyebrow` and `subtitle` **mutually exclusive at the type level** —
exactly the right standard. It is imported in one file. Adopting it removes an
entire label tier product-wide, mechanically.

### Cut 3 — duplication between setup and review setup

**34 exact-match strings are duplicated** between the setup wizard and the review
policy editor. They configure the same policy — one during onboarding, one after —
and were copied rather than shared.

Worse, **twelve labels diverged**, so the same field has two names depending on
where you meet it:

| Concept | Setup wizard | Review setup |
| --- | --- | --- |
| rationale | Rationale | Reviewer explanation |
| bounty | USDC per reviewer | USDC per accepted reviewer |
| panel size | Reviewers per request | Panel size *(validation says "Reviewer count")* |
| deadline | Response window | Response deadline |
| network audience | Public network | RateLoop network |

A sibling component already proves the shared-copy pattern works by exporting its
descriptions. The rest simply was not shared.

The same disclaimer family repeats elsewhere: the "ordinary MCP is advisory" claim
appears in **seven** places totalling ~300 words.

### Cut 4 — relocate scaffolding to where it can be acted on

The largest bucket, and the rule is simple: **explanation belongs next to the
control it governs, or in docs — not next to a control the reader cannot change.**

The clearest case is a 97-word block listing exact thresholds — 15-case windows, 14
agreements, 70% confidence, 20 outputs, 100 cases — attached to a screen where none
of them is editable. Those numbers belong on the Review setup tab where they *are*
editable. What stays is one sentence and a popover.

Also relocate: 95 words of verification theory (docs already cover it), the
duplicated "these are separate checks" explanation, override-record mechanics, and
email-delivery configuration that belongs in Settings beside the switch.

**One inverse case.** The API-key scopes — `quote:read`, `panel:publish`,
`payment:submit`, `review:decide` and the rest — have **no explanation anywhere in
the product**. That is missing scaffolding where it is genuinely needed, and it
should be added while the rest is removed.

---

## 4. Naming

### "Results" has five names

Route param `evaluations` → tab **Results** → outer heading "Human review results"
→ eyebrow "Evaluations" → inner heading "Results" — plus a separate "Assurance
operations" heading on the same tab. The reported Results/Evidence confusion is
partly this: the panel does not agree with itself.

`/human` is the same shape: nav "Humans" → tab "To review" → hidden heading "Review
work" → tablist "Review sources" → route param `discover`. Five names on one path.

### Labels that mislead

- **Overview** contains billing, Stripe checkout, SSO/SCIM, API keys, panel
  funding, top-ups and the danger zone — 1,656 lines of workspace settings. The
  legacy `/settings/workspace` route redirects here, confirming what it is.
- **Review setup** routes to `registry`, while the component actually called
  `AgentRegistryPanel` lives under **Connections**.
- One panel renders the eyebrow **"Approvals"** above the heading "Alerts needing
  attention" — it contains alerts, and approvals are a different component on the
  same tab.

### Term collisions — one word, two meanings, both in the app

- **"advisory"** means *integration enforcement mode* and *unpaid reviewer status*.
- **"panel"** means *a reviewer group or funding round* and *a UI panel* — as in
  "This panel is decision support", which sits beside "Panel size" and "Panel
  funding".
- **"assurance"** carries five senses, including "age assurance".

### Jargon: keep or change

**Keep** — this is a compliance product and precision is the product: `attestation`
in the Article 26(2) sense, `DAC7`, sanctions screening, terms hash, controller and
processor, legal hold, audit chain. Keep `Ed25519`, `SPKI`, `Merkle`, `Rekor` and
`TSA` **inside the "Verify an export" disclosure**, which is aimed at someone
independently verifying a file — that block is right in content and wrong in
placement.

**Change** — internal vocabulary reaching people who cannot act on it: `bps`
rendered raw to reviewers alongside "Brier skill"; `atomic` rendered raw; raw enum
values used as labels (`all`/`public`/`private`, `install_required`); raw validator
paths surfacing as user-facing errors ("request.budget.bountyAtomic must be greater
than zero"); truncated principal addresses used as a person's name; and internal
release status leaking into a radio description ("implemented but unavailable until
identity, funding, deployment, and compliance activation are validated").

`hybrid` appears in five user-facing strings describing a state the audience
selector never lets anyone choose.

---

## 5. The standard, in four worked examples

**A — the label tier.** `EVIDENCE` / "Decision records and exports" becomes one
`PageHeading` with a heading and a subtitle. Applied across 27 files, this removes a
tier everywhere at once.

**B — the 97-word preset block → ~12 visible words.** "Safe adaptive preset
applied." plus a popover saying it starts at 100% coverage and never drops below
25%, editable after approval. The thresholds move to where they are editable. "MCP
is advisory" becomes a badge rendered only when enforcement actually is advisory —
today it is asserted for every host, including verified ones.

**C — 95 words of verification theory → ~18.** Gate the whole section on there
being something to verify. Keep one security instruction inline, because it is
genuinely necessary at that moment: *"Never verify a packet with the key inside it.
Download the pinned key from key history."* Everything else links to the docs page
that already covers it.

**D — three statements of one consequence → one, guarded.** The workspace-stop
release consequence appears in a banner, in the panel body, and inside the button
label. It becomes one sentence in the body, shown only when a stop is engaged, and
the button says "Release stop" — the parenthetical moves to where the user reads it
*before* deciding rather than inside the thing they click.

---

## 6. Sequence

| Step | Content | Effort | Risk |
| --- | --- | --- | --- |
| 1 | Guard the 44 unconditional disclaimers | S | very low — no rewriting |
| 2 | Adopt `PageHeading`, remove the eyebrow tier | S/M | low — mechanical |
| 3 | Share the setup ↔ review-setup copy, reconcile the 12 diverged labels | M | low |
| 4 | Relocate scaffolding; add the missing scope explanations | M | medium — needs judgement per block |
| 5 | Reconcile naming; run the tree test from the findability plan first | M | medium — do not rename before testing |
| 6 | Mechanical pass: sentences ≤25 words, paragraphs ≤5 sentences, verb-first headings, the GOV.UK avoid-list | S | low |

Steps 1 and 2 are the bulk of the reduction and neither requires a content
decision.

---

## 7. What this audit could not measure

- **`lib/` was excluded.** The same detector finds 83,454 words of prose-shaped
  strings there — mostly server-side errors that never reach a browser, but an
  unknown subset does, and two confirmed leaks are listed above. **23,369 is a
  floor, not a ceiling.**
- **Counts are per component tree, not per render**, so surfaces with many mutually
  exclusive branches are overstated. Comparisons between surfaces hold; absolute
  density does not.
- **Visual density was not measured** — font size, line height and whitespace — so
  a 400-word page may still feel heavier than a 900-word one.
- **Whether any block has a compliance origin invisible in source.** Several items
  classed as scaffolding may have come from legal review. Check before cutting.
