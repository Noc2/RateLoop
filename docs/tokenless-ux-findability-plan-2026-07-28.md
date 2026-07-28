# Findability and dead ends — plan, 28 July 2026

Six questions a user will ask, and what it currently takes to answer them.

---

## 1. The six questions

### "How much am I spending?" — **the number does not exist**

Overview shows *review decisions* consumed against the plan limit, not money. The
only currency in the product is USDC panel balances, and that whole section is
conditional — invisible on a workspace with no funding history. Nothing in the
primary navigation or footer says **Billing**, **Plan**, **Usage** or **Balance**.

There is also **no control anywhere named "Settings"** in the Agents surface. The
account chip goes to the reviewer profile. Workspace settings is reachable only by
knowing that Agents → Overview *is* settings.

### "Why did this review fail?" — two collapsed layers deep, and absent when it matters

The reviewer rationale sits behind two nested disclosures, neither of whose labels
contains the word "reason" or "why". Worse, the case detail renders **only when the
run completed** — a run whose status is `failed` has no case detail at all. And
Results has no failed-runs filter, while Evidence has an outcome filter one tab
away.

### "Who reviewed this?" — correctly pseudonymous, never explained

Per-response rows show a truncated pseudonym; real identities exist only on the
reviewer roster, on a different tab, with no join. This is the right design for
blind review, but the UI never says so at the point of confusion — so it reads as a
missing feature rather than a deliberate protection.

### "How do I add a reviewer?" — behind a label that omits the word, and gated

Two clicks, via the tab labelled **Review setup**. But that tab only renders once an
agent is connected, so **before connecting an agent there is no way to invite a
reviewer at all**. Meanwhile Overview has a visually similar "Invite member" form
that grants workspace access — a different thing — and the reviewer panel has to
disclaim the confusion in prose.

### "How do I export evidence for an auditor?" — the label hides the capability

Per-packet export is findable. Everything else is behind a button labelled
**Evidence settings**, which is doing enormous work: compliance exports, retention
policy, trusted keys, and WORM/SIEM/GRC delivery all live behind it. The
auditor-facing "Verify an export" is a separate collapsed disclosure elsewhere on
the page. A non-manager sees no workspace-level export at all.

### "How do I change my plan?" — reachable, with one misleading state

A free workspace whose subscription is `past_due` or `incomplete` renders a
disabled button reading **"Billing is not enabled yet"**, which is false — billing
is enabled, the subscription is blocking — sitting beside a working "Manage
billing" button.

---

## 2. Search covers no user data

The global search index is a **55-entry hand-written constant**. Its only dynamic
input is one entry per supported connection host.

Not searchable: runs, agents, workspaces, projects, reviewers, invitations, evidence
packets, packet or run identifiers, audit entries, invoices, top-ups, assignments,
rationales. Not even indexed as pages: the entire legal section, `/welcome`,
`/settings/*`, and the **Approvals** tab. Two entries point at the same URL and both
appear in results.

For a product whose value is finding a specific decision later, a search that
cannot find a decision is close to the whole problem.

---

## 3. Dead ends

- **The 404 and error pages render outside the shell**, so an error loses the
  sidebar, search and footer entirely. Their only action is "go home". The error
  page also lacks the main-content landmark its sibling received.
- **`/settings/wallets`** has no link back to the profile that is the only place
  sending you there. Its inbound links are conditional and **disappear once a wallet
  is bound** — so changing or removing a wallet requires typing the URL.
- **Docs sub-pages** (`/docs/ai/errors`, `/docs/connect/[host]`) have no back link,
  and the docs sub-nav uses exact path matching so the parent is not highlighted.
- **Desktop cannot reach half the legal pages.** `/legal` is linked only from the
  mobile drawer; the desktop footer links three leaf documents directly, so
  `/legal`, `/legal/cookies`, `/legal/dpa` and `/legal/subprocessors` have no
  desktop route and are absent from search.
- **Reviewer notifications have no home.** Six notification types are produced;
  the only in-product list lives inside the Agents Approvals tab, gated on being a
  workspace manager. A reviewer therefore has **no in-product surface** for
  deadline-bearing money notifications — reveal required, claim expiring. They exist
  only in email. That is almost certainly why the two invalid `?tab=earnings` links
  went unnoticed.
- **Zero breadcrumbs product-wide** — noted as a fact, not a complaint; see the
  navigation plan for why breadcrumbs are the wrong fix.

---

## 4. The plan

### Phase A — name the things that exist

1. **Add "Billing" to the navigation** and give the money question an answer. Even
   before cost-per-decision lands, the plan, the usage and the balance should sit
   under one honestly-named destination.
2. **Rename "Evidence settings"** to name what is behind it, and lift compliance
   exports out from under it — an auditor export is a primary task, not a setting.
3. **Fix the false "Billing is not enabled yet"** state to say what is actually
   blocking.
4. **Make the reviewer-invite path reachable before an agent is connected**, and
   distinguish it in label from "Invite member".

### Phase B — say the quiet parts

- Add one line at the point of confusion explaining that reviewer identities are
  pseudonymous **by design**, rather than leaving it to read as missing.
- Give the "why did this fail" path a label containing the word, and render case
  detail for failed runs — the state where the question is actually asked.
- Add the failed-runs filter Results lacks and Evidence already has.

### Phase C — search that finds decisions

Index the user's own data: runs, agents, evidence packets, reviewers, projects, and
identifiers. Accept a run or packet id pasted directly. This depends on the
addressable-URL work in the navigation plan — there is no point returning a search
result that cannot be linked to.

Index the pages currently missing, and de-duplicate the two entries pointing at one
URL.

### Phase D — close the dead ends

Render the 404 and error pages inside the shell; add the missing landmark. Give
`/settings/wallets`, the docs sub-pages and the legal cluster a way back. Give
`/legal` a desktop route. Give reviewers an in-product notification surface — this
one is not cosmetic, because the notifications it hides carry deadlines and money.

---

## 5. Before renaming any tab, test the labels

The Results-versus-Evidence problem is an **information-scent** failure: two labels
that could plausibly hold the same thing split the user's prediction of where to
look. NN/g's tabs guidance independently requires tab labels to be mutually
exclusive.

The cheap diagnostic is a **tree test** — no design, no code, no content. It reports
success, time, directness, and the useful part: *which category users chose
instead*. Roughly 15 participants and 8–10 tasks phrased in buyers' language: *find
proof you can hand to an auditor*, *check how yesterday's batch scored*, *see which
reviewer disagreed*.

Prefer this to a first-click test: click tests diverge from live behaviour by up to
40% on dynamic menus, and the widely-quoted first-click success statistic could not
be verified at source.

A hypothesis worth testing rather than assuming: Results and Evidence may be **one
object at two altitudes** — aggregate statistics and individual signed records. If
the tree test confirms that, the fix is one destination with a summary/records
toggle, not two tabs with better names.

Note also that GOV.UK's own tabs guidance warns against tabs when users must
**compare information across sections** — which is exactly what an auditor does
when checking a score in one tab against its record in another.
