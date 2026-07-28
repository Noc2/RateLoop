# UI/UX programme — index and sequence, 28 July 2026

Six documents, one order of work. Written after auditing the product against
established practice and against three adjacent evaluation tools, with the human-in-
the-loop focus kept central throughout.

## The documents

| Plan | Question it answers |
| --- | --- |
| [Agents dashboard](tokenless-agents-dashboard-plan-2026-07-28.md) | What goes on the overview, and how do Results and Evidence differ? |
| [Open questions](tokenless-agents-dashboard-open-questions-2026-07-28.md) | Scope cardinality, metric naming, default period, reviewer privacy |
| [Navigation](tokenless-ux-navigation-plan-2026-07-28.md) | Why did "Compare plans" strand me, and what else does that? |
| [Consistency](tokenless-ux-consistency-plan-2026-07-28.md) | Why does the same job work differently in different places? |
| [Findability](tokenless-ux-findability-plan-2026-07-28.md) | Where is the thing I am looking for? |
| [Content](tokenless-ux-content-plan-2026-07-28.md) | Why is there so much text? |

## The three things worth knowing first

**Most of this is surfacing, not building.** A per-agent performance rollup —
endorsement rate with a Wilson lower bound, review rate, latency, tokens, per agent
version and workflow — is already computed, already served over the wire, and
rendered by nothing. Per-run agent attribution is disabled by four literal type
annotations while the join it needs exists with a unique index. The three charts
that exist are hidden inside a collapsed element labelled "Operations and policy
details".

**Two defects found are worse than the symptoms reported.** The reported "Compare
plans" jump is real but the cause is not the chrome — both route groups render the
same shell. What is dropped is the workspace, and the same defect sits on all three
Stripe return URLs, so an owner upgrading their second workspace pays and lands on
the first one's overview showing "Checkout received". And the metric this plan
originally proposed putting on the headline row turned out to be the exact
complement of the one beside it.

**The research pointed somewhere counterintuitive twice.** Numeric ranges barely
dent trust while verbal hedging measurably does — so reducing text and improving
trust are the same edit. And no shipped product appears to display a Wilson lower
bound as a number: the canonical pattern is compute it, rank on it, show the plain
proportion and the count.

## Sequence

Ordered by value per unit of effort and by what unblocks what.

**Step 1 — small, no design review, ship independently**

- Thread `workspace` through every return path; clear `billing=` after reading it;
  wire the sidebar sign-in to the `returnTo` mechanism that already exists.
- Guard the 44 unconditional disclaimers. Pure subtraction; several guard variables
  already exist.
- Fix the two notification links pointing at a tab that does not exist.

**Step 2 — the overview becomes an overview**

- Render the existing per-agent rollup as the agent table, bounded and paginated.
- Four headline numbers, each answering a different question, with the sample
  travelling beside the rate.
- Lift the three charts out of the collapsed element.
- Link runs to their evidence packets in both directions.

**Step 3 — reduce and reconcile**

- Adopt `PageHeading`; remove the eyebrow tier across 27 files.
- Share the duplicated setup and review-setup copy; reconcile the twelve diverged
  labels.
- Converge destructive confirmation on one mechanic; retire the sixteen native
  browser dialogs.
- Agree the terminology table — one approved term per concept.

**Step 4 — addressable and findable**

- Promote selection and filter state to the URL. A record that cannot be linked to
  cannot be cited, which is the job of an evidence product.
- Index user data in search.
- Give the money question a destination named after it.

**Step 5 — test before renaming**

Run the tree test on the six tab labels. Do not rename Results or Evidence on
instinct; the hypothesis worth testing is that they are one object at two
altitudes.

**Step 6 — the differentiator**

Rubric-level disagreement analysis: agreement distribution, disagreement by
workflow and risk tier, time-to-decision. No reviewer axis in either lane. This is
where the product does something no evaluation framework studied can do — and the
open-questions plan sets out why the reviewer axis specifically must wait.

## Standing constraints

- **Keep the current visual design.** Every recommendation here is routing, copy,
  guards, or adopting components that already exist.
- **No global agent score.** Forbidden by the immutability plan, and statistically
  wrong. Parent rows show a composition and an observed worst case, never a mean.
- **Do not add a widget builder.** A fixed, opinionated overview is worth more than
  a customisable one.
- **Reviewer pseudonymity is a boundary, not a preference.** Proving human
  oversight does not require reviewer statistics; the evidence packet already does
  that job.
