# RateLoop Cleanup Opportunities - 2026-06-26

Read-only audit of cleanup opportunities outside smart contracts. This report excludes
`packages/foundry`, `packages/contracts`, Solidity code, deployment artifacts, and the
legacy-contributor/legacy-user claim surface unless explicitly noted as a dependency of
some unrelated cleanup.

## Method

- Ran repo-wide searches for legacy, deprecated, TODO, stale, generated, and temporary
  artifacts outside smart-contract packages.
- Ran the existing Knip scan with `yarn dead-code:scan`.
- Ran `yarn dedupe --check` and `yarn why @scaffold-ui/hooks`.
- Used three read-only explorer agents focused on `packages/nextjs`, non-frontend
  packages, and repo-level docs/config.
- Verified higher-signal findings with targeted `rg`, `git ls-files`, and `git
  check-ignore` checks.

Current local status before the report was created already included unrelated changes:

- `M packages/nextjs/config/nextConfigCsp.test.ts`
- `?? tmp/rateloop-rating-system-handoff/`

Those are not part of this report.

## Highest-Confidence Removals

### 1. Remove or quarantine tracked throwaway `tmp/` handoff artifacts

Priority: Medium

Evidence:

- Root `.gitignore` does not ignore `/tmp/`, while `.dockerignore` does.
- `git ls-files tmp` shows tracked files:
  - `tmp/ai-assistant-preference-handoff/ask.json`
  - `tmp/ai-assistant-preference-handoff/claude-or-codex.png`
- Current working tree also has untracked one-off handoff payloads under
  `tmp/rateloop-rating-system-handoff/`.
- `rg` found no repo references to the tracked `ai-assistant-preference-handoff`
  files.

Suggested cleanup:

1. If the tracked artifacts are not intentional fixtures, delete
   `tmp/ai-assistant-preference-handoff/*`.
2. Add `/tmp/` to root `.gitignore`.
3. Move any intentional handoff examples into `packages/agents/examples/` or
   `docs/assets/` with a README explaining their purpose.

Risk:

- Low if owner confirms these are not canonical examples.
- Medium only because `tmp/ai-assistant-preference-handoff/ask.json` is tracked and
  could have been used as an ad hoc reference.

### 2. Delete duplicate SDK-local ESM extension fixer

Priority: Low

Evidence:

- `packages/sdk/scripts/fix-esm-extensions.mjs` duplicates the root helper.
- Package build scripts use `../../scripts/fix-esm-extensions.mjs`, not the SDK-local
  copy:
  - `packages/sdk/package.json`
  - `packages/agents/package.json`
  - `packages/node-utils/package.json`
- `rg fix-esm-extensions` found only the root helper in active scripts.

Suggested cleanup:

- Remove `packages/sdk/scripts/fix-esm-extensions.mjs`.
- Run `yarn workspace @rateloop/sdk build` or at least `yarn sdk:check-types`.

Risk:

- Low. This looks like a stranded copy after the helper was centralized.

### 3. Retain `@scaffold-ui/hooks` as a peer dependency

Priority: Closed after double-check

Evidence:

- `packages/nextjs/package.json` lists `@scaffold-ui/hooks`.
- `rg @scaffold-ui/hooks packages/nextjs package.json yarn.lock` only found the
  package entry and lockfile references.
- `yarn why @scaffold-ui/hooks` showed it is only pulled by
  `@rateloop/nextjs@workspace:packages/nextjs`.
- A follow-up `yarn explain peer-requirements pf412f` check showed
  `@scaffold-ui/components@0.1.9` requires `@scaffold-ui/hooks@0.1.7` as a peer
  dependency, and the installed package README documents installing both packages
  together.

Resolution:

- Do not remove `@scaffold-ui/hooks` while `@scaffold-ui/components` is still used.
- Revisit only if the component package is removed or replaces that peer dependency.

Risk:

- Removing it introduces a Yarn peer-dependency warning and could break components
  that resolve the peer at runtime.

### 4. Confirm and remove unreferenced social profile assets

Priority: Low to Medium

Evidence:

- `packages/nextjs/public/social/x-profile-banner.svg`
- `packages/nextjs/public/social/x-profile-banner.png`
- `packages/nextjs/public/social/x-profile-avatar.svg`
- `packages/nextjs/public/social/x-profile-avatar.png`
- `rg` found no local app, doc, or test references to `x-profile-banner`,
  `x-profile-avatar`, or `/social/`.

Suggested cleanup:

- First confirm these public URLs are not configured externally in X/Twitter profile
  settings, social tools, or brand kits.
- If not externally used, remove the four `public/social/x-profile-*` assets.

Risk:

- Medium if these are manually referenced from an external profile page.
- Low if external usage is confirmed absent.

### 5. Remove or wire the orphaned agent mockup HTML

Priority: Low

Evidence:

- `packages/agents/examples/mockups/ai-website-feedback-curyo-round.html` is tracked.
- `packages/agents/examples/README.md` does not list the mockup.
- The matching question example uses an external placeholder URL rather than this
  local mockup.

Suggested cleanup:

- Either delete the HTML mockup or document it and point an example flow at it.

Risk:

- Low.

## Consolidation Opportunities

### 6. Extract readiness helpers from the legacy-named World Chain script

Priority: Low to Medium

Evidence:

- Active Base readiness scripts import generic helpers from
  `scripts/check-worldchain-sepolia-readiness.mjs`:
  - `scripts/check-base-mainnet-readiness.mjs`
  - `scripts/check-base-sepolia-readiness.mjs`
- The root scripts expose Base checks next to the legacy `worldchain-sepolia:check`
  command.

Suggested cleanup:

- Move shared readiness primitives into `scripts/readiness-core.mjs`.
- Keep thin Base and World Chain wrappers only where those network checks are still
  intentional.
- This is a rename/consolidation, not a contract or deployment-stack change.

Risk:

- Medium because readiness scripts are gates. Do this in a focused PR with
  `node scripts/check-worldchain-sepolia-readiness.test.mjs`,
  `node scripts/check-worldchain-mainnet-readiness.test.mjs`, and the Base readiness
  tests.

### 7. Retire the full World Chain mainnet readiness checker, if the historical checker is no longer useful

Priority: Low to Medium

Evidence:

- `.github/workflows/worldchain-mainnet-readiness.yaml` is manual-only and only prints a
  retired notice.
- `scripts/check-worldchain-mainnet-readiness.mjs` still contains full offline and live
  validation logic, plus a dedicated test suite.

Suggested cleanup:

- If operators no longer need this historical checker, delete
  `scripts/check-worldchain-mainnet-readiness.mjs` and the matching tests, leaving the
  workflow notice or a short docs note that production readiness is Base-first.

Risk:

- Medium if anyone still uses the script for comparison or post-migration archaeology.
- Low if Base readiness has fully replaced it operationally.

### 8. Decouple Ponder runtime from the full agents package

Priority: Medium

Evidence:

- `packages/ponder/package.json` builds and depends on `@rateloop/agents`.
- The runtime dependency is mainly `packages/ponder/src/api/voteUi.ts`, which imports
  `resolveVoteUiConfig` from `@rateloop/agents/voteUi`.
- Ponder tests also import agent question/template helpers.

Suggested cleanup:

- Move vote-UI/head-to-head parsing primitives into `@rateloop/node-utils`.
- Re-export from `@rateloop/agents/voteUi` for compatibility.
- Update Ponder runtime imports to `@rateloop/node-utils`.
- Keep test-only agent imports if useful, or replace them with fixtures.
- Then remove `@rateloop/agents` from Ponder runtime deps/build deps if no longer
  needed.

Risk:

- Medium. This touches package ownership and public exports, but reduces build coupling.

### 9. Remove the one-line Ponder identity-key wrapper

Priority: Low

Evidence:

- `packages/ponder/src/identity-keys.ts` only re-exports
  `addressIdentityKey` from `@rateloop/node-utils/identityKeys`.
- Consumers can import `@rateloop/node-utils/identityKeys` directly.

Suggested cleanup:

- Update Ponder imports and delete the wrapper.

Risk:

- Low.

### 10. Centralize duplicated Next.js address normalization helpers

Priority: Low to Medium

Evidence:

Similar lowercase/null address helpers exist in:

- `packages/nextjs/hooks/useVotingStakes.ts`
- `packages/nextjs/hooks/useVoterStreak.ts`
- `packages/nextjs/lib/thirdweb/raterDelegation.ts`
- `packages/nextjs/hooks/useLegacyClaim.ts`
- `packages/nextjs/lib/vote/linkedWalletAddresses.ts`

Suggested cleanup:

- Add one shared helper with explicit variants for:
  - nullable lowercase comparison address
  - zero-address-as-null
  - validated `Address`
- Migrate query-key/comparison helpers first.

Risk:

- Low to Medium. The behavior is simple, but address normalization bugs can be subtle.

### 11. Centralize duplicated LREP formatting

Priority: Low to Medium

Evidence:

- `packages/nextjs/lib/ui/tokenAmountDisplay.ts` already has shared token formatting.
- Separate `formatLrepAmount` implementations remain in:
  - `packages/nextjs/lib/vote/voteIncentives.ts`
  - `packages/nextjs/components/claim/LegacyClaimPage.tsx`
  - `packages/nextjs/components/governance/GovernanceActionComposer.tsx`
  - `packages/nextjs/components/settings/WorldIdVerificationCard.tsx`

Suggested cleanup:

- Extend the shared formatter with the needed display-label options.
- Replace local formatters while preserving current rounding and loading text.

Risk:

- Low to Medium because user-visible balances and governance thresholds must keep their
  exact intended formatting.

### 12. Move Next.js DB test memory helper out of the production-shaped DB tree

Priority: Low

Evidence:

- `packages/nextjs/lib/db/testMemory.ts` is imported by tests only.
- It lives beside runtime DB code and imports `pg-mem`, migration loading, and schema
  setup.

Suggested cleanup:

- Move it to `packages/nextjs/test-utils/db/` or `packages/nextjs/lib/db/testing/`.
- Update test imports.
- Do not remove it; it is heavily used by tests.

Risk:

- Low, but broad import churn.

### 13. Move Ponder moderation regex helpers into node-utils

Priority: Low

Evidence:

- Core moderation policy lives in `packages/node-utils/src/contentModeration.ts`.
- Generic regex helpers live in `packages/ponder/src/api/moderationPatterns.ts` and are
  used by Ponder moderation code/tests.

Suggested cleanup:

- Move pure moderation pattern helpers into `@rateloop/node-utils`.
- Update Ponder imports/tests.

Risk:

- Low.

## Documentation Cleanup

### 14. Add a docs index and archive structure

Priority: Low to Medium

Evidence:

- Top-level `docs/` mixes current operator docs with historical research and audit
  snapshots.
- `docs/private-context-plan-2026-06.md` and
  `docs/protocol-design-review-2026-06.md` self-label as historical.
- `docs/protocol-design-review-2026-06.md` references missing historical
  `repo-audit-2026-06-15.md` / `repo-audit-2026-06-16.md` files.

Suggested cleanup:

- Add `docs/README.md` grouping current operator docs, audits, research, and archive.
- Move long historical snapshots under something like `docs/archive/2026-06/`.
- Fix or remove references to missing historical files.

Risk:

- Low to Medium. Mostly navigation, but existing links should be preserved or redirected
  in docs.

### 15. Mark the original 2026-06-25 repo review as superseded

Priority: Medium

Evidence:

- `docs/repo-review-findings-2026-06-25.md` still reads like current findings and
  mentions stale details such as `yarn vercel:yolo`.
- `docs/repo-review-findings-2026-06-25-followup.md` says previously reported issues
  remain addressed, including the build-error bypass.

Suggested cleanup:

- Add a banner to the original report pointing to the follow-up.
- Or consolidate both into a single audit file with `current`, `open`, and `closed`
  status.

Risk:

- Low. This reduces operator confusion.

### 16. Convert duplicate agent instruction files to one source of truth

Priority: Low

Evidence:

- `CLAUDE.md` duplicates only a subset of `AGENTS.md`.
- `.gitignore` ignores both even though both are tracked.

Suggested cleanup:

- Make `CLAUDE.md` a thin pointer to `AGENTS.md` plus Claude-only notes, or generate
  both from one source.
- Document why tracked ignored agent files are intentional.

Risk:

- Low.

## Product/Media Cleanup

### 17. Update stale promo video copy that still says World Chain

Status: Resolved

Evidence:

- As of the 2026-06-30 repository audit, `packages/promo-video/src/scenes/Settle.tsx`
  renders `Base mainnet` in the settle scene.

Resolution:

- No further copy change is needed for this item. Regenerate the promo poster/video only
  when intentionally refreshing the rendered media.

Risk:

- Low.

### 18. Remove legacy promo music fallback if no longer intentional

Status: Resolved

Evidence:

- `packages/promo-video/src/RateLoopPromo.tsx` uses `audio/music.mp3`.
- As of the 2026-06-30 repository audit, `packages/promo-video/public/audio/README.md`
  documents `music.mp3`, and the legacy `music.m4a` / `generate-music.mjs` files are no
  longer present.

Resolution:

- No further cleanup is needed for this item.

Risk:

- Low if the MP3 is the only intended render input.

## Static-Analysis Backlog

### 19. Triage unused exports reported by Knip

Status: Resolved

Evidence:

- As of the 2026-06-30 follow-up pass, the remaining unused exports from
  `yarn dead-code` were converted to module-local declarations or removed.
- The follow-up `yarn dead-code` run completed with no reported unused exports or types.

Resolution:

- No remaining action for this item.

Risk:

- Low.
  seams, so delete only after checking intended external/package boundaries.

### 20. Dedupe dependency lockfile in a dedicated PR

Priority: Low

Evidence:

- `yarn dedupe --check` exited nonzero and reported 55 packages that can be deduped.
- Root `package.json` has a large `resolutions` block for transitive security pins.

Suggested cleanup:

- Run `yarn dedupe` in a dedicated dependency-hygiene PR.
- Review `resolutions` entries with `yarn why` and remove pins that upstream ranges no
  longer require.

Risk:

- Medium. Lockfile-only churn can still affect build and test behavior.

## Things That Look Legacy But Should Not Be Removed Casually

These surfaced during the audit, but I would not remove them as routine cleanup:

- Legacy contributor claim flow and manifest. This is explicitly out of scope and tied
  to active product/tokenomics behavior.
- World ID `legacy` proof mode. It is still documented and tested as a supported proof
  path.
- `paymentMode: "x402_authorization"` and related x402 naming. It is a documented
  compatibility alias for existing integrations even though newer copy points at
  `eip3009_usdc_authorization`.
- World Chain Sepolia support in Ponder/Keeper/Next tests. Some of it appears retained
  for historical validation or compatibility. Remove only after an explicit network
  support decision.
- `packages/nextjs/lib/db/testMemory.ts`. It belongs in a test-support location, but it
  should not be deleted.

## Suggested Order

1. Remove tracked `tmp/` artifacts and ignore `/tmp/`.
2. Remove `packages/sdk/scripts/fix-esm-extensions.mjs`.
3. Keep `@scaffold-ui/hooks` while `@scaffold-ui/components` requires it as a peer.
4. Add a docs index plus superseded banner for the 2026-06-25 review.
5. Extract readiness core helpers away from the World Chain Sepolia module name.
6. Keep Knip clean after the 2026-06-30 unused-export follow-up.
7. Do dependency dedupe as a separate lockfile-focused PR.
