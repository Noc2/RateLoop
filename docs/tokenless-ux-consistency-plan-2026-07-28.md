# One pattern per job — plan, 28 July 2026

The product has a well-designed shared primitive set in
`components/tokenless/ui/`, and it is largely unused. That is the headline finding
of the consistency audit, and it means the fix is adoption rather than design.

Nothing here changes the visual language.

---

## 1. The inventory

Counts verified by reading the tree.

| Job | Distinct mechanics in use | Canonical one |
| --- | --- | --- |
| Destructive confirmation | **5** | none established |
| Primary action | 2 | `rateloop-gradient-action` |
| Page heading | 3 systems, 4 size scales | `ui/PageHeading` — used **once** product-wide |
| Card surface | 3 classes, 123 raw uses vs 11 component uses | `ui/Card` |
| Error surfacing | 4 channels | inline `role="alert"` + `useFormErrors` |
| Loading | 4 treatments | `ui/AsyncSection` |
| Empty state | present on some lists, absent on structurally identical ones | `ui/AsyncSection` `empty` |
| Disclosure | 5 mechanics, 25 `<details>` | — |

### The worst of it

**Destructive confirmation has five mechanics**, two of which sit in the same
Danger Zone and disagree: account deletion asks you to type `DELETE`, workspace
deletion asks you to type the workspace name. Sixteen further sites use native
`window.confirm`, an unstyled OS dialog that breaks the design system wherever it
appears. Releasing a workspace stop has no confirmation at all.

**`ui/PageHeading` — the canonical h1 — is used in exactly one file.** Three pages
have an `sr-only` h1 and no visible page identity, and two of them are the primary
navigation destinations: `/agents` and `/human`.

**Primary-button styling carries selection state** in two places, where
`btn-primary`/`btn-outline` are used as a segmented toggle. That overloads "this is
the important action" to mean "this one is selected".

**One component fires both an inline banner and a toast for the same event**, so
the user reads the same message twice — while every other action in the same file
is inline-only. The toast provider is mounted globally and consumed by two
components out of the whole app.

**Nav label, page title and h1 disagree** on several routes: sidebar "Humans" →
title "To review" → no visible heading. A recent accessibility commit series added
sentence-case titles alongside untouched Title Case ones, so title and h1 now
disagree in case on three docs pages, and the home page ended up with no metadata
at all.

---

## 2. Why this matters, stated honestly

The mechanism is well evidenced: the **power law of learning** means a novel
pattern starts at the steep part of its own curve while the familiar one has
already saturated. Every extra mechanic for the same job costs the user a fresh
learning curve.

But "be consistent" as a blanket rule is a heuristic, not a finding — NN/g itself
describes its heuristics as "broad rules of thumb and not specific usability
guidelines", and Grudin's *The Case Against User Interface Consistency* argues
there is no precise definition and no rule for when other concerns should win.

So the rule adopted here is **one pattern per job**, not uniformity for its own
sake. Where a surface has a real reason to differ, it may — the reason goes in a
comment.

Two of NN/g's top ten IA mistakes apply directly: inconsistent navigation, and
*"too many navigation techniques"*, where combining methods produces a mess rather
than cumulative benefit.

---

## 3. The plan

### Phase A — the terminology table (highest value, no code)

Before any component work, agree **one approved term per concept** and list the
banned synonyms. The audit found drift across *result / outcome / score / record /
evidence / attestation / audit trail*.

In a compliance product, drifting vocabulary does more damage than drifting button
styles, because it undermines the auditability claim the product sells. This is
also where the Results-versus-Evidence problem really lives: it is a vocabulary
conflict before it is a navigation one.

### Phase B — the six-row rule sheet

One page, enforceable in review:

| Situation | Use | Not |
| --- | --- | --- |
| Caveat the user must read | inline sentence | tooltip |
| Detail a minority need | one `<details>` with a specific label | "Learn more" |
| Methodology, long tail | docs link with descriptive text | duplicated in-app prose |
| Blocking problem | inline field error via `useFormErrors` | toast |
| Transient success | toast | banner |
| Persistent state | banner | toast |

"Learn more" is called out specifically: it gives no information scent and produces
a list of indistinguishable links for screen-reader users.

Tooltips are restricted to icon-only controls and unit hints. The W3C tooltip
pattern still carries an explicit *no task force consensus* banner — it is the
most-recommended and least-settled pattern in the whole area, and a compliance
caveat must never live in one.

### Phase C — converge the mechanics

In descending order of user impact:

1. **Destructive confirmation → one mechanic.** Replace all sixteen
   `window.confirm` calls with the existing in-app confirmation, and pick one
   typed-confirmation rule for the Danger Zone rather than two. Add the missing
   confirmation on releasing a workspace stop.
2. **Adopt `ui/PageHeading`** and give `/agents` and `/human` visible page
   identity. Reconcile nav label, page title and h1 — and settle the casing split
   the recent commits introduced.
3. **Stop using primary styling for selection state.** A segmented control is a
   different component from a primary button.
4. **One error channel per event.** Remove the duplicate toast-plus-banner, and
   decide whether the toast provider is used product-wide or removed — two
   consumers out of the whole app is the worst of both.
5. **`AsyncSection` everywhere a list loads**, which brings loading, error and
   empty states with it and closes the missing-empty-state gaps for free.
6. **`ui/Card` adoption**, and pick one of `surface-card` versus
   `rateloop-surface-card` for app content — the marketing variant currently
   appears inside app-shaped surfaces.

### Phase D — the interface inventory, kept current

Brad Frost's method: screenshot every *distinct treatment* of the same job, lay the
variants side by side, decide. Half a day for a product this size, six categories:
page headers, empty states, errors, disclosure, action labels, and status
terminology.

Repeat it when it starts to drift rather than on a schedule.

---

## 4. What to preserve

- **`useFormErrors` + `forms/Field`** — the highest-adoption primitives, with real
  field-level error binding. Extend these, do not replace them.
- **`AgentTabs` / `HumanTabs`** — correct roving `tabindex`, arrow keys,
  `aria-selected`. (Their ARIA *role* choice is addressed separately in the
  navigation plan; the implementation quality is not in question.)
- **`InfoPopover`** — properly viewport-clamped, restores focus, uses `useId`.
- **`AsyncSection`** — loading, error and empty in one contract, with `role="status"`
  and reduced-motion respected. Underused, not wrong.
- **The legal cluster** — the one fully coherent navigation neighbourhood.
- **Documented deliberate silences** — several empty catch blocks carry comments
  explaining that the read fails closed because the server enforces the rule. Those
  are correct and should not be "fixed".
