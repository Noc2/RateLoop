# Design consistency — findings and plan

Written 6 August 2026 against `90b7b2d91`, from a source-level audit of every component
call site, a rendered-page audit of the deployed site, and an accessibility pass with
axe-core over ~25 surfaces in both languages. **Revised against `9a0bbdec1`, with completed
items removed rather than ticked.**

It started from one observation: the sign-in button looked different on the humans page and
the agents page. That turned out to have a single cause, and the same cause explains most
of what follows.

## The short version

There is a `Button` component. **109 of 173 branded buttons — 63% — do not use it**, and
instead re-apply its variant classes by hand. So there is no single place that decides what
a button looks like, and six different primary heights and six secondary heights have grown
in the gap. `Card` has the same shape of problem: used 183 times, but it carries no
geometry, so call sites invented three radii and seven paddings.

That is the systemic finding, and it is what remains. The visible bugs the audit found
alongside it are fixed.

## 1. What landed

Five commits closed the reported symptom and everything a visitor could see without reading
source. Recorded here because each carries a decision worth not re-litigating.

- **The sign-in control is an ordinary primary `Button`** (`dd51e4642`).
  `.rateloop-sign-in-action` and the hand-copied `AgentsSignInPrompt` override are both gone,
  so the humans and agents pages now render the same control because they share it, not
  because two class strings happen to agree.
  *Deviation from the plan below, deliberate:* the plan said `size="sm"`. That was wrong —
  it would have kept the odd 40px and dragged the *other* gradient primaries down to meet it.
  `Button` gained an `lg` step at 48px instead, which is the height every other gradient
  primary already measured, so the fix moved one control rather than eleven.
- **Five classless human-surface controls have a background** (`d4b92eeaa`), via a new
  `.rateloop-secondary-surface` for clickable labels that are legitimately not `.btn`.
- **The orb follows the brand tokens** (`6edec46b7`), read from computed style so GSAP and
  the theme cannot disagree.
- **A catalogue miss returns the source string** and German metadata, register and docs
  labels are localised (`fe212a55a`) — *"Nein billing account exists"* and the English `<title>`
  on `/de` are both gone.
- **The heading→action gap** moved off the optional description (`dd51e4642`), and the four
  typo opacities are collapsed onto the scale (`0d05e26d9`).

## 2. The systemic finding

### 2.1 Button adoption

| Route to a branded button | Sites |
| ------------------------- | ----- |
| The `Button` component | 64 |
| Hand-rolled `rateloop-gradient-action` | 46 |
| Hand-rolled `rateloop-secondary-action` | 63 |
| **Bypass rate** | **109 / 173 = 63%** |

Raw DaisyUI modifiers appear **145 times across 48 files**. The resulting geometry:

- **Primary height:** none/inherit (14), `min-h-11` (14), `btn-sm` (8), `min-h-12` (5), `min-h-10` (4) — **five values**, down one now that `.rateloop-sign-in-action` is deleted
- **Primary padding:** `px-5` (18), `px-4` (16), `px-6` (3), `px-[0.9rem]` (1) — **four values**
- **Secondary height:** `btn-sm` (33), `min-h-11` (8), `min-h-10` (7), plus `min-h-12`, `min-h-9`, `btn-xs` — **six values**

And 19 of the 64 `Button` call sites pass a `className` that overrides the variant's own
sizing, padding, typography or colour. `AgentSetupFlow.tsx:1341` even re-declares
`rateloop-secondary-action` on a `variant="secondary"` Button. The string
`min-h-11 w-full sm:w-auto` is repeated verbatim at nine sites — an unnamed "form submit"
size that should be a prop.

*Fix:* `Button` now has real `sm/md/lg` steps with explicit heights and paddings — that part
is done, and `lg` is the 48px primary. What remains is the `block` prop, the codemod over the
109 bypass sites, and a lint rule banning the variant classes outside `ui/Button.tsx`. The
step ladder without the codemod fixes nothing on its own; it only makes the codemod possible.

### 2.2 Card has no geometry

183 uses. `.surface-card` sets `border-radius: 0.5rem`, and **8 of 145 sites honour it**:

- **Radius:** `rounded-2xl` (110), `rounded-xl` (27), `rounded-lg` (8)
- **Padding:** `p-6` (71), `p-5` (66), `p-4` (35), `p-7` (16), `p-9` (7), `p-8` (4), `p-3` (1)

*Fix:* `panel` / `compact` / `inline` density props; set the token to `1rem` to match reality.

### 2.3 Secondary text has drifted into eleven opacities

820 occurrences of `text-base-content/NN`, across **11 distinct values**:

`/55` 408 · `/60` 172 · `/65` 116 · `/70` 56 · `/75` 22 · `/80` 17 · `/45` 9 · `/50` 6 ·
`/85` 3 · `/35` 3 · `/25` 2 — **after the four typo values (`/62 /68 /72 /76`) were folded
onto the scale.**

Five values (`/55 /60 /65 /70 /75`) carry 774 of them for what is one or two semantic roles,
and that is the part still open. Surfaces are worse: `bg-base-content/*` has 20 distinct opacities,
including `[0.05]` and `/5` — the same value written two ways.

Two tokens for exactly this already exist (`--rateloop-text-secondary`,
`--rateloop-text-tertiary`) and are used **once** in the entire tree.

### 2.4 Type scale

**Six distinct sizes below `text-xs`** — `text-[10px]`, `[11px]`, `[0.65rem]`, `[0.68rem]`,
`[0.7rem]`, `[0.72rem]` — spanning 1.5px. **Seven** between `text-base` and `text-2xl`,
where `text-lg` and `text-xl` already exist. **Five** tracking values for the same uppercase
eyebrow. Eight bespoke display sizes.

*Fix:* two `@theme` steps (`--text-2xs`, `--text-md`) plus one `--tracking-eyebrow` retires
about 30 of the 44 arbitrary values.

## 3. The two shells diverge structurally

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

## 4. Four competing "selected item" treatments

`.pill-active`/`.pill-inactive` (globals.css), `SegmentedChoice.tsx:28-32`,
`AnswerPageClient.tsx:193-197`, and `Chip.tsx:26` all style the same concept differently.
`Chip` has exactly one use in the whole codebase.

## 5. Accessibility

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

## 6. Ranked plan

Rows 1–6 of the original plan are done and removed; the German metadata and register items
from 7.1–7.3 went with them. What is left is the systemic work, and none of it is visible to
a prospect in a single sitting — which is why it was ranked below the bugs, and why it should
now be scheduled rather than squeezed in.

| # | Fix | Size | Why now |
| - | --- | ---- | ------- |
| 1 | Add `Button`'s `block` prop; remove the 19 call-site overrides | M | The size ladder exists; the overrides still defeat it |
| 2 | Give `Card` density variants; strip per-site radius and padding | M | Three radii + seven paddings → three |
| 3 | Fix input border contrast; add the search placeholder to the contrast test | M | The only two confirmed WCAG AA colour failures |
| 4 | `aria-describedby` on radio descriptions; assert axe `incomplete` as well as `violations`; extend coverage to the wizard and dashboard | M | The a11y suite currently cannot fail on four of its own checks |
| 5 | Three text-opacity and three surface tokens; codemod the remaining ad-hoc values | M | ~980 call sites onto a scale |
| 6 | Codemod the 109 bypass sites onto `Button`; lint-ban the variant classes outside it | L | Removes the whole class of divergence |
| 7 | `SectionHeading` primitive; sr-only h1 on the human hub; hoist `AgentTabs` | M | The shells converge structurally |
| 8 | Equalise the two `/pricing` CTAs; unify the primary fill weight (7.1, 7.2) | S | Two adjacent buttons in one card still disagree |
| 9 | Give `/legal/imprint` the shell its siblings use (7.4) | S | The page a German buyer opens first |

Row 6 is the one that matters. Rows 1, 2, 5 and 7 are each a precondition for it or a
smaller instance of the same problem, and doing them without it leaves the divergence free to
regrow.

## 7. Rendered-site findings

Measured on the deployed site at 1280×720 and 375×812, both themes, both languages, before
the fixes in section 1. **Six of the twelve findings are closed** and have been removed; the
measurements below are retained where they still describe the site, and are the baseline to
re-measure against after the codemod.

### 7.1 Primary and secondary are inverted in visual weight

On `/agents/overview` in light theme the card is `rgb(247,247,245)` and the **primary** fill
is `#fff` — *lighter than the card it sits on*, about 1.03:1, carried only by a 1px gradient
border. The **secondary** fill is `rgba(23,23,23,0.1)`, visibly heavier. Dark theme inverts
the same way. **The secondary action out-weighs the primary on the sign-in screen.**

### 7.2 Eight distinct button treatments across ten pages

By `(height / font-size / weight)`: `48/16/700` · `44/16/600` · `44/14/600` · `48/14/600` ·
`40/16/700` secondary · `32/12/600` · `36/14/400`. Secondary style alone has **five**
renderings. (The eighth, the 40px sign-in primary, is gone; the `36/14/400` treatment was the
classless controls and should re-measure clean.)

Most visible: the two `/pricing` plan CTAs sit side by side in one card grid at the same
48px height, but **"Start free" is 14px/600 and "Request pilot" is 16px/700**.

### 7.3 Heading scale is incoherent, including within a single page

**H1**: `/` 90.4px/700 · `/docs/evidence` 64px/**400** · `/pricing` 52px/700 ·
`/docs/evidence/verify` **48px/700**. Two sibling docs pages differ by 16px *and* 300 weight
units. **H2**: `/` 86.4px/700 · docs and legal 24px · `/pricing` **16px/400**, styled as body
text. Within `/docs/evidence`, `At a glance` is 24px/600 while its siblings are 24px/400.

### 7.4 `/legal/imprint` uses a different shell from its siblings

Imprint: `max-width: none`, 1057px wide at a 1280px viewport, flush left, 32px top padding.
Terms and privacy: `max-w-4xl`, 896px, centered, 48px top padding. **The Impressum is the
page a German buyer opens first to check the legal entity**, and it is the one page whose
measure runs unconstrained — roughly 2,350px of line length on a 2560px monitor. Its
back-link is also worded differently ("← Back to Legal" against "← Legal").

### 7.5 Three behaviours that surprise a visitor

- **Signed-out human tabs show a data skeleton for 3–10 seconds** before the sign-in card
  appears. Nothing is loading that requires it. `/human/history` also shows the *review*
  tab's prompt copy.
- **Locale is sticky and overrides the URL.** After any `/de/*` page, requesting `/pricing`
  serves German and rewrites the location to `/de/pricing`. A colleague following a shared
  link gets the wrong language.
- **`prefers-color-scheme` is ignored.** A visitor whose OS is in light mode gets the dark
  site until they find the toggle.

### 7.6 What measured clean

- **The shell is identical on all ten pages** in both locales — same fixed 208px sidebar,
  same footer. The only divergence is 7.4.
- **No horizontal overflow anywhere**, at 375px or 1280px, in either language:
  `documentElement.scrollWidth === innerWidth` on every page. Wide docs tables and every
  `<pre>` scroll inside their own container. **German's longer strings caused no breakage** —
  worth saying, because it is the failure everyone expects.
- **Light-theme sidebar contrast is fine** — nav items 8.52:1 and 10.4:1, section labels
  6.63:1, active pill 17.93:1.
- **German body copy reads naturally.** The problems the audit found were metadata, register
  and a few missed keys — all now fixed — never translation quality. That distinction is
  worth keeping in mind: the German surface was never the weak part.
