# Agent connection and installation improvement plan — July 2026

**Status:** Proposed engineering plan for the `tokenless` branch. Goal: make the agent connection/installation flow
work across as many agents and AI tools as possible while keeping the owner's experience as close as possible to
"share one message." Builds on the decisions already frozen in the
[MCP cross-client compatibility review](tokenless-mcp-cross-client-compatibility-review-2026-07.md) (support tiers,
Codex-primary path, progressive disclosure, no unverified install links) and preserves every existing security
invariant of the connection flow (single-use intent, hash-only claim nonce, owner-bound OAuth claim, safe scopes,
no credential in the transcript).

## Design principles

1. **One mechanism, many presentations.** Every path — pasted message, plugin install, native config snippet, deep
   link, device flow — converges on the same intent claim + OAuth grant. Presentation adapts per host; the security
   flow never forks. The message is therefore never _wrong_ on any host, only sometimes not optimal alone.
2. **The agent adapts at paste time; the owner never has to know what a "lane" is.** Host detection belongs in the
   skill/agent, not in a form the owner must fill correctly. A host picker exists only as optional progressive
   disclosure that tunes the copy and sets expectations — skipping it must always work.
3. **A single host-capability registry drives everything.** Message variants, the picker, install affordances, docs
   pages, support-tier badges, and agent-card lane claims all render from one source of truth, so the claims-match-code
   rule holds by construction instead of by copy discipline.
4. **Tier honesty is enforced, not asserted.** A host displays as Verified only when the registry entry carries a
   green automated smoke-test run at a pinned version (the compatibility review's own acceptance criteria). Everything
   else renders as Supported/Experimental with what that means.

## Phase 0 — Host capability registry (single source of truth)

Create `packages/nextjs/lib/tokenless/hostCapabilities.ts` (typed, exported constant plus JSON projection for docs
generation). One record per host:

- `id`, `displayName`, `category` (`plugin-host` | `mcp-ide` | `mcp-cli` | `chat-connector` | `headless-sdk`);
- `supportTier`: `verified` | `supported` | `experimental` | `unsupported`, plus `verifiedAt` and an evidence
  reference (CI run) that is **required** when tier is `verified`;
- `lanes` available in priority order: `plugin-with-hooks`, `mcp-oauth`, `mcp-config`, `device-flow`, `cli`;
- `installAffordances`: plugin marketplace ref, CLI command string, deep link template, config snippet template,
  settings-UI instructions ref — only the ones that exist and have been checked against the named client version;
- `humanActions`: the ordered 2–3 host-presented actions the owner should expect (install prompt, trust prompt, OAuth
  consent), used by the picker and docs;
- `resumeSemantics` and known quirks (schema sanitization, `httpUrl` vs `url`, new-task-on-install), imported from the
  compatibility review's findings;
- `messageVariant`: which template blocks the connection message includes for this host.

Initial population, mapped from the compatibility review's current matrix: Codex desktop (plugin, primary), Claude
Code (plugin), Claude Desktop (chat connector — settings UI path), VS Code / Copilot Chat (remote HTTP MCP + OAuth),
Cursor (remote HTTP MCP), Gemini CLI (remote HTTP MCP, `httpUrl` shape), ChatGPT / OpenAI connector surface
(experimental), generic Streamable-HTTP MCP client (the universal fallback), headless SDK/CI (device flow + CLI).
No entry starts above its current honest tier; today that means nothing is Verified.

Tests: registry entries must carry evidence refs for `verified`; every host referenced anywhere in components or docs
must exist in the registry; the registry's tier table must match the compatibility review's published tiers (pin with
a doc-sync test, same pattern as the existing claims tests).

Effort: ~1 day. No user-visible change.

## Phase 1 — Templated connection message (variants from one template)

Refactor `buildAgentConnectionMessage` (`packages/nextjs/components/tokenless/agents/agentConnectionMessage.ts`) from
one monolithic string into composable blocks:

- **Core block (every variant, unchanged semantics):** the skill invocation, the privacy line, "report success only
  after RateLoop verifies the connection," and the single-use URL. The security-relevant sentences stay identical
  across variants so they can be pinned by one test.
- **Plugin block** (plugin hosts only): the `plugin://rateloop-workspace@rateloop` reference and install-resume
  choreography.
- **Recovery block** (tiered): the full uninstall/resume script only for hosts whose install flow needs it; generic
  MCP hosts get the shorter OAuth-retry guidance; verified hosts eventually get the minimal variant their smoke tests
  justify.
- **Tone pass:** remove imperative autonomy phrasing of the "act immediately without asking" kind (flagged in the
  2026-07-18 review) in favor of "only interrupt me for host-presented install, trust, or OAuth actions" — which the
  current message already does well; keep that framing everywhere.

The `universal` variant — the default when no host is chosen — keeps today's behavior. Variant selection is a pure
function of the registry record.

Tests: snapshot per variant; a single test asserting the core block is byte-identical across all variants; the
existing no-credential-in-message assertions extended over all variants.

Effort: ~1–2 days. Prerequisite: Phase 0.

## Phase 2 — Share-time picker as progressive disclosure

In `AgentConnectionPanel`, keep the current default exactly as-is: universal message + copy button, zero added
friction. Below it, one disclosure: **"Connecting to a specific tool?"** with host chips rendered from the registry.

Selecting a chip:

- swaps the copied message to that host's variant;
- shows the host's `humanActions` as a compact numbered strip ("1. Approve the plugin install · 2. Approve the OAuth
  screen") so the owner knows what interruptions are legitimate — this doubles as phishing resistance, because the
  owner now has an expectation to compare against;
- shows the native fast path when one exists (command string with copy button, deep link, or "open Settings →
  Connectors" instructions for chat hosts);
- shows the support-tier badge with a one-line meaning ("Experimental: protocol-compatible, not yet release-tested").

Selection is remembered per workspace. No chip is ever required. This matches the product's progressive-disclosure
standard and the compatibility review's existing "Other MCP client" disclosure decision — this phase mostly moves that
disclosure from the docs into the share surface and wires it to the registry.

Add connection-funnel telemetry (the `onboardingObservability` pattern already exists): chosen host (or none),
message-copied, connection-verified, elapsed time, and which lane actually connected. This data decides Phase 5
verification order.

Effort: ~3–4 days including tests (render tests per chip from registry fixtures; e2e for picker → copy → variant).

## Phase 3 — Native install affordances per host

Populate `installAffordances` where they genuinely exist, one host at a time, verifying each against the named client
version before it renders (the compatibility review's "do not generate unverified install links" rule becomes a
registry-level gate: an affordance renders only with its own `checkedAt` + client version):

- **Claude Code:** plugin marketplace path (exists today) plus the `claude mcp add --transport http` command string;
  additionally publish the org **managed-settings snippet** that pins the plugin + hooks as policy — this is the
  bridge from "advisory" to org-enforced and belongs in the Enterprise conversation, not just install docs.
- **Codex:** current plugin path stays primary; add the config command equivalent for headless Codex use.
- **VS Code / Copilot Chat:** config snippet in its `servers` shape with `oauth.clientId` guidance; an install deep
  link only after verifying redirect behavior (the review's restraint here is correct — keep it until verified).
- **Cursor:** config snippet; deep-link install only after verification at a pinned version.
- **Gemini CLI:** `httpUrl` JSON snippet (their shape, per the review) + CLI command.
- **Claude Desktop (chat):** settings-UI connector instructions — docs-only affordance; no pasted message can drive
  it, so the picker's job here is purely expectation-setting.
- **ChatGPT connector surface:** experimental instructions behind the tier badge.
- **Headless / CI / backend SDK:** `npx @rateloop/agents` + device-authorization flow (exists) + workspace API key
  path for B2B; this chip is also where the CI/PR-check enforcement product (separate roadmap) will attach.

Effort: incremental, ~0.5–1 day per host including verification of the affordance itself.

## Phase 4 — Generated per-host docs

Add `/docs/connect/[host]` public pages rendered from the registry (same data, second projection): what to expect
(the `humanActions`), the message for that host, the native path if any, host-specific troubleshooting (fold the
relevant `AgentConnectionTroubleshooting` content in per host), and the tier badge with `verifiedAt` date. A short
index page replaces scattered client snippets.

Guardrails: a build-time test that no docs page renders a tier the registry does not grant (extends the existing
public-claims test pattern); `siteSearch` keywords generated from the registry; docs pages carry no capability claims
of their own — prose is template, facts are registry.

Rationale for docs existing at all: trust before pasting an instruction blob into an agent, support/debug reference
("what should have happened on host X"), and procurement expectations. Generation from the registry is what keeps
them from rotting into the four-hand-written-guides failure mode.

Effort: ~2–3 days.

## Phase 5 — Verification harness as the tier gate

Execute the compatibility review's own acceptance criteria and make them the only way a host's tier improves:

1. the authenticated OAuth lifecycle harness (discovery → DCR → PKCE → exchange → claim → refresh rotation →
   revocation recovery) in CI;
2. per-host release smoke tests at pinned client versions: install → auth → lifecycle → `rateloop_get_agent_context`
   → `rateloop_verify_connection` → resume-after-new-task, run for Codex and Claude Code first (bundled paths),
   then VS Code and Gemini CLI, ordered thereafter by Phase 2 telemetry;
3. schema-adapter compilation of every tool through the OpenAI and Gemini converters in CI, failing on dropped
   constraints — plus `outputSchema` declarations for the tool set (both already recommended in the review);
4. a green run writes `supportTier: verified`, `verifiedAt`, and the evidence ref into the registry via a recorded
   change — the picker, docs, and message variants update automatically and honestly.

Effort: the harness is the largest single item (~1–2 weeks incremental); it is also already committed to in the
review's remaining-items list, so this plan adds sequencing, not scope.

## Phase 6 — Lane honesty end-to-end

Close the loop by reporting which lane a connection actually landed on:

- during claim, record the connecting lane (plugin-with-hooks vs bare MCP OAuth vs device flow) — the plugin can
  attest its presence via the existing skill/hook contract;
- surface it on the agent card and in `rateloop_get_agent_context` next to the existing `enforcementBoundary`
  ("Connected via RateLoop plugin with stop-gate hooks" vs "Advisory MCP connection — host hooks not installed");
- let the owner see, per agent, the gap between best-available lane for that host and the lane in use, with a one-tap
  "upgrade this connection" that reuses the picker's affordances.

This turns the installation quality into a visible, improvable property instead of a silent one, and it gives the
enforcement ladder (advisory → hooks → managed hooks → CI gate) a UI anchor.

Effort: ~3–4 days.

## Rollout order and success metrics

Sequence: 0 → 1 → 2 ship together as one release (registry, variants, picker — the visible improvement); 3 and 4
land host-by-host behind it; 5 runs continuously and is what moves badges; 6 follows once lanes are recorded.

Measure: connection completion rate (message copied → connection verified) overall and per host; time-to-connected;
share of connections on hosts at Supported-or-better; support contacts per hundred connections; and — after Phase 6 —
share of connections on the best available lane for their host.

## Risks and mitigations

- **Variant sprawl / message drift** → variants are template blocks over one registry; the security core is pinned
  byte-identical by test; the universal variant preserves today's battle-tested behavior as the floor.
- **Docs/claims drift** → docs and badges are projections of the registry; build-time tests forbid unregistered
  claims; tier changes require harness evidence.
- **Over-promising host support** → nothing renders above Experimental without a verified affordance check; nothing
  renders Verified without a green pinned-version smoke run — the same restraint the compatibility review already
  practices, made structural.
- **Picker complexity creep** → the picker is optional disclosure with chips and three data-driven elements (message,
  actions, fast path); anything more belongs in the generated docs page.

## Explicit non-goals

Building UI inside customers' applications; per-host forks of the OAuth/claim mechanism; auto-detecting the host at
share time (the agent detects at paste time; the picker is only expectation-setting); marking any host Verified ahead
of its harness run; and replacing the universal message — it remains the primary, zero-friction path.
