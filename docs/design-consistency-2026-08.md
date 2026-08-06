# Design consistency — findings and plan

Written 6 August 2026 against `90b7b2d91`, from a source-level audit of every component
call site, a rendered-page audit of the deployed site, and an accessibility pass with
axe-core over ~25 surfaces in both languages.

It starts from one observation: the sign-in button looks different on the humans page and
the agents page. That turned out to have a single cause, and the same cause explains most
of what follows.

## The short version

There is a `Button` component. **109 of 173 branded buttons — 63% — do not use it**, and
instead re-apply its variant classes by hand. So there is no single place that decides what
a button looks like, and six different primary heights and six secondary heights have grown
in the gap. `Card` has the same shape of problem: used 183 times, but it carries no
geometry, so call sites invented three radii and seven paddings.

That is the systemic finding. Along the way the audit found four things that are not drift
but **bugs**, and they are listed first because they are visible today.

## 1. Bugs, not drift

### 1.1 Five buttons on the human surface render with no background at all

The rule is `.btn.rateloop-secondary-action` (`styles/globals.css:372,381,390`) — it
requires **both** classes. These five sites emit only the second, so they get no background,
no hover state and no disabled state:

- [`ForecastIntegrityClient.tsx:193`](../packages/nextjs/components/tokenless/human/ForecastIntegrityClient.tsx) and `:219`
- [`ReviewerEarningsClient.tsx:67`](../packages/nextjs/components/tokenless/human/ReviewerEarningsClient.tsx)
- [`RaterSettlementRecoveryClient.tsx:275`](../packages/nextjs/components/tokenless/human/RaterSettlementRecoveryClient.tsx)
- [`FeedbackBonusClaimsClient.tsx:284`](../packages/nextjs/components/tokenless/human/FeedbackBonusClaimsClient.tsx)

**All five are on the human surface. Zero on agents.** This is itself a humans-versus-agents
divergence, and it is the kind a prospect notices without being able to say why.

*Fix:* `<Button variant="secondary" size="sm">`, or minimally add `btn`. Small.

### 1.2 German falls back to mixed German-English word salad

[`recursiveCatalogLocalization.tsx:65-80`](../packages/nextjs/components/localization/recursiveCatalogLocalization.tsx)
translates by exact phrase match and, on a miss, falls through to **longest-first substring
replacement** across the whole catalogue. There is no concept of a missing key. Reproduced
by re-executing the algorithm against the shipped German catalogue:

| Source | Renders as |
| ------ | ---------- |
| "No billing account exists for this workspace." | **"Nein billing account exists for this workspace."** |
| "Update the payment method below before upgrading." | **"Aktualisieren the payment method below before upgrading."** |
| "Revoke this workspace invitation?" | **"Widerrufen this workspace invitation?"** |

Roughly 57 server messages render mixed. **A mixed string reads worse to a German than
plain English** — it reads as broken machine translation, which is exactly the impression
the complete German UI exists to defeat. Sharpest instance: in the `billing_unavailable`
state both languages appear in one card, because one sentence is an exact catalogue hit and
its neighbour adds four words and defeats the match.

*Fix:* make a miss return the source string unchanged, and add a test asserting no rendered
string mixes languages. The substring pass is the bug, not the missing keys.

### 1.3 The landing orb is theme-locked

[`TokenlessOrb.tsx:6`](../packages/nextjs/components/home/TokenlessOrb.tsx) hardcodes
`["#359EEE", "#FFC43D", "#EF476F", "#03CEA4"]`. Those are not an old palette — they are the
**current dark-theme token values**, hardcoded. Light theme uses `#12669e`, `#00785d`,
`#8a5b00`, `#c02b52` (`globals.css:74-77` vs `:138-141`). So the orb does not adapt, and the
first thing on the landing page is off-brand in one of the two themes. Same at
`HumanAssuranceLoop.tsx:58-59`.

*Fix:* read `--rateloop-spectrum-gradient`, which already assembles them (`globals.css:179-186`).

### 1.4 The human sign-in heading has no gap beneath it

[`SignInSurface.tsx:46-48`](../packages/nextjs/components/auth/SignInSurface.tsx) puts the
`mb-6` that separates heading from action row on the **description paragraph**.
`AgentsSignInPrompt` passes a description; `HumanAccountSignInPrompt` does not. So on
`/human/inbox|profile|settings` the h1 sits flush against the button.

*Fix:* move the spacing to the children wrapper in `SignedOutGate.tsx`, independent of
whether a description exists.

## 2. The sign-in button, specifically

This is the reported symptom, and it has one cause.

[`ThirdwebSessionButton.tsx:18-19`](../packages/nextjs/components/thirdweb/ThirdwebSessionButton.tsx)
defines the sign-in control as a hand-rolled `<Link>` carrying
`rateloop-gradient-action rateloop-sign-in-action px-[0.9rem] text-base font-bold` — **with
no `btn` class**. `.rateloop-sign-in-action` forces `min-height: 2.5rem` (`globals.css:345-347`)
against `.rateloop-gradient-action`'s `3rem` (`:320-323`), and without `btn` it inherits
`1rem` text where DaisyUI would give `0.875rem`.

So the primary sign-in control is **0.5rem shorter and one type step larger than every
other primary button in the product**.

[`AgentsSignInPrompt.tsx:23`](../packages/nextjs/components/tokenless/agents/AgentsSignInPrompt.tsx)
then copies those exact overrides onto a `size="sm"` `Button` — `h-10 min-h-10 px-[0.9rem]
text-base font-bold leading-none` — so its secondary action matches the odd one out. The
humans page does not, because it has no secondary action at all.

**Neither page is wrong. The control they are both matching is.**

*Fix, in order:*
1. Make `RateLoopSignInAction` render `<Button as={Link} size="sm">`.
2. Delete `.rateloop-sign-in-action`.
3. Delete the override at `AgentsSignInPrompt.tsx:23`.

That is the whole repair, and it is small.

## 3. The systemic finding

### 3.1 Button adoption

| Route to a branded button | Sites |
| ------------------------- | ----- |
| The `Button` component | 64 |
| Hand-rolled `rateloop-gradient-action` | 46 |
| Hand-rolled `rateloop-secondary-action` | 63 |
| **Bypass rate** | **109 / 173 = 63%** |

Raw DaisyUI modifiers appear **145 times across 48 files**. The resulting geometry:

- **Primary height:** none/inherit (14), `min-h-11` (14), `btn-sm` (8), `min-h-12` (5), `min-h-10` (4), `rateloop-sign-in-action` (1) — **six values**
- **Primary padding:** `px-5` (18), `px-4` (16), `px-6` (3), `px-[0.9rem]` (1) — **four values**
- **Secondary height:** `btn-sm` (33), `min-h-11` (8), `min-h-10` (7), plus `min-h-12`, `min-h-9`, `btn-xs` — **six values**

And 19 of the 64 `Button` call sites pass a `className` that overrides the variant's own
sizing, padding, typography or colour. `AgentSetupFlow.tsx:1341` even re-declares
`rateloop-secondary-action` on a `variant="secondary"` Button. The string
`min-h-11 w-full sm:w-auto` is repeated verbatim at nine sites — an unnamed "form submit"
size that should be a prop.

*Fix:* give `Button` real `sm/md/lg` steps with explicit heights and paddings, add a `block`
prop, then codemod the 109 bypass sites and add a lint rule banning the variant classes
outside `ui/Button.tsx`.

### 3.2 Card has no geometry

183 uses. `.surface-card` sets `border-radius: 0.5rem`, and **8 of 145 sites honour it**:

- **Radius:** `rounded-2xl` (110), `rounded-xl` (27), `rounded-lg` (8)
- **Padding:** `p-6` (71), `p-5` (66), `p-4` (35), `p-7` (16), `p-9` (7), `p-8` (4), `p-3` (1)

*Fix:* `panel` / `compact` / `inline` density props; set the token to `1rem` to match reality.

### 3.3 Secondary text has drifted into fifteen opacities

820 occurrences of `text-base-content/NN` across **15 distinct values**:

`/55` 408 · `/60` 172 · `/65` 116 · `/70` 56 · `/75` 22 · `/80` 17 · `/45` 9 · `/50` 6 ·
`/85` 3 · `/35` 3 · `/72` 2 · `/62` 2 · `/25` 2 · `/76` 1 · `/68` 1

Five values (`/55 /60 /65 /70 /75`) carry 774 of them for what is one or two semantic roles.
`/62`, `/68`, `/72` and `/76` are almost certainly typos — **deleting those four is a
five-minute win**. Surfaces are worse: `bg-base-content/*` has 20 distinct opacities,
including `[0.05]` and `/5` — the same value written two ways.

Two tokens for exactly this already exist (`--rateloop-text-secondary`,
`--rateloop-text-tertiary`) and are used **once** in the entire tree.

### 3.4 Type scale

**Six distinct sizes below `text-xs`** — `text-[10px]`, `[11px]`, `[0.65rem]`, `[0.68rem]`,
`[0.7rem]`, `[0.72rem]` — spanning 1.5px. **Seven** between `text-base` and `text-2xl`,
where `text-lg` and `text-xl` already exist. **Five** tracking values for the same uppercase
eyebrow. Eight bespoke display sizes.

*Fix:* two `@theme` steps (`--text-2xs`, `--text-md`) plus one `--tracking-eyebrow` retires
about 30 of the 44 arbitrary values.

## 4. The two shells diverge structurally

- **No `<h1>` on the human account tabs.** Agents renders an sr-only h1
  (`AgentWorkspacePanels.tsx:128`); human discover/history does too
  (`AnswerPageClient.tsx:152`); human inbox/profile/settings renders none, so the first
  heading is an `<h2>`. Accessibility regression and a structural inconsistency.
- **Navigation overflows oppositely.** `AgentTabs` scrolls horizontally; `HumanTabs` wraps.
  Same pill tokens, opposite narrow-viewport behaviour.
- **Tab ownership differs.** Human renders tabs at page level; agents renders them inside
  the panel component, so the "no workspace selected" branch produces a bare card with a
  visible `text-3xl` h1 and no navigation — a screen shape with no human counterpart.
- **21 distinct `<h2 className>` strings and 18 distinct `<h3>`** repo-wide. Sibling panels
  on one human page use `text-2xl` and `text-lg` for the same level.

## 5. Four competing "selected item" treatments

`.pill-active`/`.pill-inactive` (globals.css), `SegmentedChoice.tsx:28-32`,
`AnswerPageClient.tsx:193-197`, and `Chip.tsx:26` all style the same concept differently.
`Chip` has exactly one use in the whole codebase.

## 6. Accessibility

**Say this in the pitch — it is genuinely good.** `eslint-plugin-jsx-a11y` recommended with
no rules disabled; axe-core over rendered DOM; contrast tokens enforced by test; skip link;
`lang` follows locale; `prefers-reduced-motion` asserted. `forms/Field.tsx` is exemplary —
`label htmlFor`, `aria-describedby` wiring hint and error, `aria-invalid`, `role="alert"`.
`InfoPopover` and all three modal patterns trap focus and restore it correctly.

Confirmed gaps, in order:

1. **Form field boundaries fail 3:1 non-text contrast.** DaisyUI's `.input` border measures
   **1.53:1 light / 1.71:1 dark** against the field fill, and the fill is within 1.07:1 of
   the page canvas. The border is the only boundary and it is about half the required ratio.
   Affects every form. **WCAG 1.4.11.**
2. **Search placeholder is 4.28:1 in light theme**, dropping to 4.19:1 focused — and its
   `<label>` is `sr-only`, so the placeholder *is* the visible label. **WCAG 1.4.3.**
3. **Radio descriptions are not associated with their radios.** `SetupChoiceGroup.tsx:29-31`
   puts `aria-label` on the `<label>`, overriding its content, and the description has no
   `aria-describedby`. Worst case: the wizard appends *the reason a lane is disabled* to
   that description, so a screen-reader user meets a disabled radio with no announced reason.
4. **`page-has-heading-one`, `landmark-one-main` and `color-contrast` land in axe's
   `incomplete`, and the test asserts only on `violations`** — so none of them is actually
   checked, on any of the five surfaces covered. The wizard, the dashboard and the settings
   surface have no axe coverage at all.
5. **Label in Name on the language toggle** — visible text `DE`, accessible name
   "Sprache: Deutsch". Speech-input users cannot activate it by saying what they see.
   **WCAG 2.5.3, Level A.**

## 7. Ranked plan

| # | Fix | Size | Why now |
| - | --- | ---- | ------- |
| 1 | Make the sign-in action a `Button`; delete `.rateloop-sign-in-action` and the `AgentsSignInPrompt` override | S | Resolves the reported symptom at its cause |
| 2 | Add `btn` at the five unstyled human buttons | S | Five invisible controls, all on one surface |
| 3 | Move the heading→action spacing off the optional description | S | Fixes the human sign-in layout |
| 4 | Make a catalogue miss return the source string; test that no rendered string mixes languages | S | Kills "Nein billing account exists" |
| 5 | Point the orb at the brand tokens | S | Landing page stops being off-brand in light theme |
| 6 | Delete the four typo opacities (`/62 /68 /72 /76`) | S | Five minutes |
| 7 | Give `Button` real size steps and a `block` prop; remove the 19 overrides | M | Six heights → three |
| 8 | Give `Card` density variants; strip per-site radius and padding | M | Three radii + seven paddings → three |
| 9 | Fix input border contrast; add the search placeholder to the contrast test | M | The only two confirmed WCAG AA colour failures |
| 10 | `aria-describedby` on radio descriptions; assert axe `incomplete` as well as `violations`; extend coverage to the wizard and dashboard | M | The a11y suite currently cannot fail on four of its own checks |
| 11 | Three text-opacity and three surface tokens; codemod the 15 and 20 ad-hoc values | M | 980 call sites onto a scale |
| 12 | Codemod the 109 bypass sites onto `Button`; lint-ban the variant classes outside it | L | Removes the whole class of divergence |
| 13 | `SectionHeading` primitive; sr-only h1 on the human hub; hoist `AgentTabs` | M | The shells converge structurally |

Items 1–6 are a morning's work between them and fix everything a prospect can see.
