# Non-Contract Audit Findings - 2026-06-19

## Scope

This pass reviewed RateLoop surfaces outside Solidity/smart-contract source. Contract deployment artifacts and generated address consumers were checked only as off-chain wiring inputs. The deployed smart contracts are treated as fixed unless a later protocol-breaking issue proves otherwise.

Reviewed areas:

- Next.js app, API routes, hooks, database schema, notifications, wallet and Thirdweb verifier paths.
- Ponder API routes, indexing summaries, reward candidate routes, and Base deployment wiring.
- Keeper, agents, SDK/docs, readiness scripts, and operator-facing configuration docs.

## Verification

- `node scripts/check-base-mainnet-readiness.mjs --json` passed.
- `node scripts/check-base-sepolia-readiness.mjs --json` passed.
- `yarn test:ts` ran through the broad repo gate until `@rateloop/keeper` hit `listen EPERM: operation not permitted 127.0.0.1` in the sandbox.
- `yarn workspace @rateloop/keeper test` passed with localhost binding allowed: 18 files, 228 tests passed, 1 skipped.
- `yarn workspace @rateloop/agents test` passed: 7 files, 81 tests passed.
- `yarn workspace @rateloop/ponder test` passed: 34 files, 349 tests passed, 1 skipped.
- `yarn next:lint` passed.

Live RPC readiness, browser E2E, and deployed-service smoke checks were not run in this pass.

## Findings

### P1: Moderated Ponder content can leak through secondary routes

Central indexed-read moderation exists in `packages/ponder/src/api/moderation.ts:32` and is applied to primary content routes such as `packages/ponder/src/api/routes/content-routes.ts:1154` and `packages/ponder/src/api/routes/content-routes.ts:1397`.

Several other content-bearing routes return `content.title`, `content.description`, `content.url`, or formatted content previews without the same `buildAllowedContentCondition`:

- `/rounds` selects content fields at `packages/ponder/src/api/routes/content-routes.ts:1445` and `packages/ponder/src/api/routes/content-routes.ts:1514`.
- `/profile/:address` recent submissions select content fields at `packages/ponder/src/api/routes/content-routes.ts:1697` and `packages/ponder/src/api/routes/content-routes.ts:1808`.
- `/question-bundles/:id` selects bundled question content at `packages/ponder/src/api/routes/data-routes.ts:403` and `packages/ponder/src/api/routes/data-routes.ts:425`.

Impact: content hidden from primary feeds or direct lookups can still be exposed through rounds, profile submissions, or bundle detail APIs.

Suggested repair direction: apply the same allowed-content condition everywhere an API route exposes content-bearing fields, and add route tests that create moderated content and assert all secondary routes redact or exclude it consistently.

### P1: Watchlist state is deployment-blind

`watched_content` stores only `wallet_address` and `content_id`, with a unique index on that pair in `packages/nextjs/lib/db/schema.ts:72` and `packages/nextjs/lib/db/schema.ts:81`. The watchlist storage and API also read/write by wallet and raw content id only:

- `packages/nextjs/lib/watchlist/contentWatch.ts:48`
- `packages/nextjs/lib/watchlist/contentWatch.ts:61`
- `packages/nextjs/app/api/watchlist/content/route.ts:190`
- `packages/nextjs/app/api/watchlist/content/route.ts:200`

Client state also omits chain/deployment from cache and signal inputs:

- `packages/nextjs/hooks/useWatchedContent.ts:37`
- `packages/nextjs/hooks/useDiscoverSignals.ts:37`
- `packages/nextjs/components/vote/VotePageClient.tsx:359`

Impact: if app database rows carry forward from World Chain to Base, a watched World `contentId=1` can make Base `contentId=1` appear watched. Unwatching on one deployment can mutate the other deployment's state.

Suggested repair direction: add a deployment scope column or equivalent deployment key to watched content, migrate existing rows deliberately, include scope in unique indexes, API payload validation, React Query keys, Discover Signals, and notification queries.

### P2: Notification email dedupe keys are deployment-blind

`notification_email_deliveries` has a globally unique `event_key` and raw `content_id`, without chain or deployment columns, in `packages/nextjs/lib/db/schema.ts:185` and `packages/nextjs/lib/db/schema.ts:192`.

Event keys are built from wallet/content/round tuples only:

- `round-resolved:${wallet}:${contentId}:${roundId}` at `packages/nextjs/lib/notifications/emailDelivery.ts:249`
- `settling-${kind}:${wallet}:${itemIds}` at `packages/nextjs/lib/notifications/emailDelivery.ts:285`
- additional followed submission/resolution keys at `packages/nextjs/lib/notifications/emailDelivery.ts:303` and `packages/nextjs/lib/notifications/emailDelivery.ts:320`

Delivery state is keyed only by `eventKey` at `packages/nextjs/lib/notifications/emailDelivery.ts:339` and checked before send at `packages/nextjs/lib/notifications/emailDelivery.ts:499`.

Impact: a sent World Chain notification can suppress the matching Base notification for the same wallet/content/round tuple when persistence is shared or migrated.

Suggested repair direction: scope notification events by deployment, either by adding deployment columns and a scoped unique index or by versioning event keys with the deployment key. Coordinate this with the watchlist migration.

### P2: Feedback bonus summaries report award deadline as feedback close

The indexer stores `feedbackClosesAt` and `awardDeadline` separately in `packages/ponder/src/FeedbackBonusEscrow.ts:25` and `packages/ponder/src/FeedbackBonusEscrow.ts:46`. The deadline helper documents that `awardDeadline` can extend beyond feedback close in `packages/ponder/src/feedback-bonus-deadlines.ts:15`.

The content summary query selects both fields from `feedbackBonusPool.awardDeadline`:

- `nextFeedbackAwardDeadline` at `packages/ponder/src/api/shared.ts:274`
- `nextFeedbackClosesAt` at `packages/ponder/src/api/shared.ts:275`

The formatter fallback repeats that coupling at `packages/ponder/src/api/shared.ts:599` and `packages/ponder/src/api/shared.ts:603`, while Next.js exposes both fields as distinct client data in `packages/nextjs/services/ponder/client.ts:638` and `packages/nextjs/services/ponder/client.ts:659`.

Impact: clients cannot distinguish "feedback can still be submitted" from "awarder can still decide." UI or agents may show a feedback bonus as open after actual feedback close.

Suggested repair direction: compute `nextFeedbackClosesAt` from `feedbackBonusPool.feedbackClosesAt`, keep `nextFeedbackAwardDeadline` based on `awardDeadline`, and add a Ponder API test where the two values differ.

### P2: Bundle reward claim candidates do not exclude already-claimed identities

Bundle claims are stored in `questionBundleClaim`, imported by the API at `packages/ponder/src/api/routes/data-routes.ts:20`, and used in aggregate payout summaries at `packages/ponder/src/api/routes/data-routes.ts:1896`.

The single-question claim candidate route excludes prior claims with a `questionRewardPoolClaim` left join/null check around `packages/ponder/src/api/routes/data-routes.ts:1716`. The bundle candidate route starts at `packages/ponder/src/api/routes/data-routes.ts:463`, filters capacity at `packages/ponder/src/api/routes/data-routes.ts:549`, and returns `claimableItems` after proof filtering, but never joins `questionBundleClaim` for the voter identity.

Impact: `/question-bundle-claim-candidates` can keep advertising a bundle round set to an identity that has already claimed, causing duplicate claim attempts or avoidable downstream contract reads.

Suggested repair direction: mirror the single-question exclusion by joining `questionBundleClaim` on bundle id, round set index, and identity key, then requiring the joined claim id to be null. Add a regression test for already-claimed bundle candidates.

### P2: Operator docs still point Base production workflows at staging

Runtime production config now targets Base mainnet in `packages/nextjs/.env.production:1` through `packages/nextjs/.env.production:3`.

Several operator and public docs still describe Base Sepolia as the next live target and Base mainnet as a future promotion:

- `README.md:10`
- `packages/keeper/README.md:32`
- `packages/ponder/README.md:60`
- `packages/agents/README.md:169`
- `docs/base-signing-ux.md:3`
- `packages/sdk/README.md:23`
- `packages/nextjs/public/docs/ai.md:9`
- `packages/nextjs/public/docs/sdk.md:5`
- `packages/nextjs/public/llms.txt:9`

This is also locked into a package test at `packages/nextjs/app/(public)/docs/sdk/page.test.tsx:11`.

Impact: operators or agent integrators following current docs can run Keeper, Ponder, SDK examples, or local signer flows against staging `84532`, or defer production `8453`, even though Base mainnet is now the production smart-contract boundary.

Suggested repair direction: update docs and doc tests so production defaults are Base mainnet `8453`, while Base Sepolia `84532` remains the staging/validation environment.

### P3: USDC env overrides are not honored by the Thirdweb sponsored-call verifier

The app accepts chain-scoped USDC overrides in `packages/nextjs/lib/env/server.ts:230`. Question planning and x402 question config consult configured USDC values before shared/static defaults in `packages/nextjs/lib/questionRewardPools.ts:152` and `packages/nextjs/lib/x402/questionSubmission.ts:1079`.

The Thirdweb free transaction verifier recognizes only deployed contracts or static `USDC_BY_CHAIN_ID` through `getKnownUsdcContractForCall` in `packages/nextjs/lib/thirdweb/freeTransactions.ts:431`, then rejects unknown targets as `target_not_allowlisted` at `packages/nextjs/lib/thirdweb/freeTransactions.ts:1343`.

Impact: if an environment sets an env-only USDC override that is not the shared deployment artifact `MockERC20` and not static Circle USDC, the UI/x402 path can build approval calls that sponsored-call verification rejects.

Suggested repair direction: either disallow unsupported USDC overrides for sponsored flows at config validation time, or teach the verifier to accept the same chain-scoped configured USDC address used by planning.

### P3: Feedback challenge routes can mix selected client chain with primary server chain

`useTargetNetwork` follows the connected wallet among configured networks at `packages/nextjs/hooks/scaffold-eth/useTargetNetwork.ts:21`. `useContentFeedback` uses `targetNetwork.id` for reads/writes at `packages/nextjs/hooks/useContentFeedback.ts:96`, but its query key and API request shape omit chain at `packages/nextjs/hooks/useContentFeedback.ts:101` and `packages/nextjs/hooks/useContentFeedback.ts:251`.

The server challenge route resolves against the primary server target instead of a requested chain at `packages/nextjs/app/api/feedback/challenge/route.ts:58`, and the deployment helper defaults to the primary target when no chain is supplied in `packages/nextjs/lib/feedback/contentFeedback.ts:316`.

Impact: in a multi-target environment such as `NEXT_PUBLIC_TARGET_NETWORKS=84532,8453`, connecting to the non-primary chain can produce a primary-chain feedback challenge while the client attempts publication on the selected chain.

Suggested repair direction: include `chainId` in the feedback challenge request, server validation, query key, and deployment resolution. Reject requests for chains outside the configured server target set.

### P3: Leaderboard can mix a primary Ponder holder set with another requested chain

Ponder availability defaults to the first configured target network at `packages/nextjs/services/ponder/client.ts:273`. The leaderboard API accepts a requested `chainId` at `packages/nextjs/app/api/leaderboard/route.ts:52`, requests a snapshot for that chain at `packages/nextjs/app/api/leaderboard/route.ts:80`, and reads balances/profiles on that requested chain.

The snapshot itself uses Ponder's unscoped token-holder list at `packages/nextjs/lib/governance/voterLeaderboardSnapshot.ts:54` before reading balances for the requested chain.

Impact: when staging and production chains are enabled together, a non-primary leaderboard request can rank the primary chain's indexed holder candidates against another chain's balances, producing sparse or misleading results.

Suggested repair direction: make token-holder discovery chain-scoped, or require one Ponder deployment per leaderboard chain and select the matching Ponder base URL before building candidate addresses.

## Non-findings and notes

- Base mainnet and Base Sepolia readiness checks passed offline, including deployment artifact/address parity for `8453` and `84532`.
- Ponder and Keeper live-address resolution is generally aligned with shared `@rateloop/contracts` deployment artifacts for non-local chains.
- Agent handoff image handling is consistent with the handoff notes: JPG, PNG, and WEBP are accepted up to 10 MB per image, and the file-backed CLI path avoids printing base64 into the terminal.
- The initial keeper test failure was caused by sandbox denial of `127.0.0.1` binding; the keeper suite passed when rerun with localhost binding allowed.
