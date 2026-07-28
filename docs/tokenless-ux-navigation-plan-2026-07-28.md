# Navigation, context and return paths — plan, 28 July 2026

The reported symptom: clicking **Compare plans** in workspace settings lands you on
the public pricing page with no way back.

The audit found the symptom is real but the diagnosis was wrong, and the
underlying defect is worse. This plan fixes the class, not the instance.

---

## 1. What is actually broken

**Not the chrome.** `app/(app)/layout.tsx` and `app/(public)/layout.tsx` are
byte-identical — both render `<TokenlessShell>`. The sidebar, search and footer
survive the jump, and browser back works. The visual continuity is real.

**The defect is that workspace identity is dropped, silently, at every boundary.**

`Compare plans` ([`WorkspaceSettingsClient.tsx:963`](../packages/nextjs/components/tokenless/WorkspaceSettingsClient.tsx:963))
goes to `/pricing`, whose CTAs
([`WorkspacePlanCards.tsx:17,39`](../packages/nextjs/components/pricing/WorkspacePlanCards.tsx:17))
return to `/agents?tab=overview` **with no `workspace=`**.
`selectRequestedWorkspace`
([`agentWorkspaceState.ts:15`](../packages/nextjs/components/tokenless/agents/agentWorkspaceState.ts:15))
then falls back to `workspaces[0]`.

So a user on their second workspace clicks Compare plans, clicks Choose Early
Access, and lands on a **different workspace's** overview with an upgrade banner
and a focused upgrade button pointed at the wrong workspace.

### The same defect, with money attached

All three Stripe URLs hardcode the same destination
([`stripe.ts:317,333,352`](../packages/nextjs/lib/billing/stripe.ts:317)):

```
cancel_url:  ${appUrl}/agents?tab=overview&billing=cancelled
success_url: ${appUrl}/agents?tab=overview&billing=success
return_url:  ${getBillingAppUrl()}/agents?tab=overview
```

An owner of workspaces A and B upgrades B, pays, and returns to **A's** overview
showing "Checkout received". The payment is correct — the workspace id travels in
Checkout metadata — so only the confirmation is wrong. That is the worst possible
combination: the user believes the wrong workspace was upgraded, sees it still on
Free, and re-enters checkout.

`billing=` is also never stripped from the URL
([`WorkspaceSettingsClient.tsx:397`](../packages/nextjs/components/tokenless/WorkspaceSettingsClient.tsx:397)),
so a reload or a back replays "Checkout received" indefinitely. The correct
pattern already exists three files away — `PaidEligibilityClient.tsx:165` uses
`history.replaceState`.

### Everything else in the class

| # | Defect | Impact |
| --- | --- | --- |
| 1 | Stripe returns to the wrong workspace | **critical** |
| 2 | `billing=` never cleared, replays on reload | high |
| 3 | Sidebar sign-in has no `returnTo`, so an expired session lands you on the marketing home page | high |
| 4 | Nothing below tab level is addressable — no link to a run, packet, agent or filtered view | high, structural |
| 5 | Setup completion drops `tab` and uses `window.location.assign`, discarding client state | medium |
| 6 | Invitation redemption wipes the entire query string | medium |
| 7 | Search from inside the app discards workspace and tab | medium |
| 8 | `#panel-funding` targets a node rendered after two fetches, so the hash scroll always misses | medium |
| 9 | OAuth consent returns without `workspace=` | medium |
| 10 | Two notification links point at `/human?tab=earnings`, which is not a valid tab | medium |
| 11 | Notification hrefs omit `workspace=` | medium |
| 12 | `?move=<id>` is emitted into deep links and read by nothing | low |

Item 3 is notable because the mechanism is already right: `agentSignInReturnTo` and
`normalizeSignInReturnPath` exist and are used correctly by both `SignedOutGate`
paths. Only the sidebar button was never wired to them.

---

## 2. The principle

Two findings settle the design.

**Plan comparison for an authenticated user belongs in the app.** Every comparable
does this — GitHub, Notion and Linear all route billing and plan comparison through
authenticated settings, and Linear treats the public pricing page as reference
material only. Stripe, whose business is billing UX, ships an embeddable pricing
table that accepts a customer session precisely so the signed-in identity travels
with it.

**Not a modal.** Both Polaris and NN/g rule out modals for content requiring
research or comparison — a plan matrix is exactly that.

**Where a signed-in user must reach a public page, the remedy is
universal navigation** — NN/g's named pattern for a "subsite" users get stranded
in: a persistent, low-emphasis return link near the logo, "like an exit sign in a
building — always present but used only when needed". This is also Nielsen's third
heuristic, the clearly marked emergency exit.

**Not a new tab.** GOV.UK advises against it as disorienting; NN/g has held that
line since 1999.

---

## 3. The plan

### Phase A — stop losing the workspace (small, no design change)

1. **Thread `workspace` through every return path.** Stripe's three URLs, the
   pricing CTAs, OAuth consent, notification hrefs, setup completion. Where a
   destination cannot know the workspace, it must ask rather than guess — the
   `workspaces[0]` fallback should not apply to a *returning* navigation.
2. **Clear `billing=` after reading it**, matching `PaidEligibilityClient`.
3. **Wire the sidebar sign-in button to `returnTo`.** The mechanism exists; pass
   the current path to it.
4. **Fix the two invalid notification tabs** and stop emitting the unread `move`
   param.
5. **Preserve the query string on invitation redemption** — strip only the
   fragment.

Phase A is a set of one-line changes and closes the reported bug plus the money
bug behind it.

### Phase B — bring plan comparison in-app

Route `Compare plans` to an authenticated billing page inside the app shell,
reusing the marketing plan-card markup verbatim. Same visual design, different
shell, workspace context intact. Public `/pricing` is unchanged for anonymous
visitors.

Where any in-app link must still reach a public page, carry `?from=workspace` and
render a persistent, quiet **← Back to {workspace}** near the logo.

### Phase C — make the product addressable

The structural item. Today exactly one `useSearchParams()` exists in the whole app,
and URL state stops at `tab`, `workspace` and `step`. Selected agent, selected
evidence packet, all four Evidence filters, and the focused assignment live in React
state only — so a reload resets them and **no view can be linked to**.

For a product whose output is auditable evidence, this is not cosmetic: **a record
that cannot be linked to cannot be cited.** An auditor asking "show me the decision
you are describing" currently has no answer but a screenshot.

- Promote selection and filter state to query params on Reviews, Evidence and the
  reviewer queue.
- Give every run and every evidence packet a linkable URL.
- Restore filters and scroll on return from a detail view — Baymard's
  filter-preserving "back to results", in GOV.UK's single-back-link form rather
  than a breadcrumb trail.

**Deliberately not breadcrumbs.** NN/g: unnecessary for hierarchies one or two
levels deep. The evidence for breadcrumbs is also weaker than their reputation —
classic studies put them at roughly 6% of navigation clicks with no measured
task-time gain. GOV.UK additionally forbids combining a back link with breadcrumbs,
so picking one is required. One back link per detail view is the whole pattern.

### Phase D — tabs as routes

The six tabs are **navigation tabs**, not a tabs widget: they lead to unrelated
content domains. NN/g warns that mixing the two disorients users, and Bootstrap
states plainly that a nav styled as tabs must **not** carry `role="tablist"` —
those roles are only for dynamic tabbed interfaces.

Current markup uses the full tabs ARIA pattern, implemented well: real `<Link>`s,
roving `tabindex`, arrow keys, `aria-selected`. The implementation quality is not
in question — the pattern choice is.

Moving to `/agents/approvals`, `/agents/evidence` and so on would give real history
entries, correct `aria-current="page"`, and linkable sections. This is the largest
item here and should follow Phase C, which delivers most of the benefit at a
fraction of the cost.

---

## 4. What to preserve

The audit was explicit that several things are done well and should survive:

- **The identical shell across both route groups** — it is why the reported bug is
  annoying rather than catastrophic.
- **`AgentTabs` / `HumanTabs`** — the best interaction code in the product: real
  links, tab in the URL, correct roving `tabindex` and arrow-key handling. Phase D
  changes what these are, not how well they are built.
- **`agentSignInReturnTo` and `normalizeSignInReturnPath`** — correct and
  security-conscious; simply unwired in one place.
- **`WorkspaceRequestScope`** — the per-workspace request staleness discipline in
  `WorkspaceSettingsClient` genuinely prevents cross-workspace data bleed.
- **The handoff "sign in in a new tab" flow** — this looks like a defect and is
  not. The review link is a fragment held in the tab and must never reach the
  server. Do not "fix" it.
- **The legal cluster** — index plus consistent back links, the one fully coherent
  navigation neighbourhood in the product.

---

## 5. Sequencing

| Phase | Content | Size | Blocks |
| --- | --- | --- | --- |
| A | thread workspace, clear `billing=`, wire sign-in returnTo, fix invalid tabs | S | nothing |
| B | in-app plan comparison, universal navigation on public pages | S/M | A |
| C | URL-addressable selection and filters, linkable runs and packets | M | nothing |
| D | tabs as routes | L | C |

Phase A should ship on its own. It is small, it fixes a money-adjacent bug, and it
requires no design review.
