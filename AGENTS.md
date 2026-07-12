# Agent Workflow Notes

- After a requested change is verified, commit it without waiting for a separate prompt unless the user explicitly asks not to commit.
- Commit independent fixes separately. Before pushing, review the changed files and group commits by concern instead of bundling unrelated fixes together.
- When the user asks to publish finished work, commit the intended fixes and push the current branch after verification passes.

## Tokenless branch implementation notes

- [`docs/tokenless-immutable-implementation-plan-2026-07.md`](docs/tokenless-immutable-implementation-plan-2026-07.md) is the design of record for `tokenless`. Strategy and legal references are supporting documents; if they conflict, fix them to match the implementation plan or explicitly reopen the decision there.
- Smart contracts on this branch remain redeployable until a real-money hardening review. The legacy Base deployment is not final. The active test stack is the versioned Base Sepolia artifact at `packages/foundry/deployments/tokenless-v1/84532.json`; fresh test redeploys are expected, and no storage-layout compatibility, proxy migration, governance rotation, old-selector compatibility, or old-address continuity work is required.
- Build the tokenless contracts as a greenfield core. Existing registries, escrows, oracle, governance, LREP, advisory recorder, and owned x402 submitter are deletion inputs, not architecture constraints. Do not preserve a legacy contract merely to keep generated types, indexers, hooks, tests, or docs compiling.
- The fund-holding core must have no operator/admin path to funds. The separate credential issuer may rotate admission signers by epoch, but it must never hold funds, redirect claims, alter accepted commits, or influence settlement.
- Paid-task eligibility must be complete before the first paid voucher. Do not implement a state where a rater earns money and only then discovers that tax, sanctions, identity, or wallet setup blocks the claim.
- Accepted rater work must reach a paid terminal path even when quorum, beacon, takedown, or platform infrastructure fails. Preserve the bounty/fee/attempt-reserve accounting and no-post-commit-cancellation invariants from the design doc.
- A normal claim links the vote key to its payout destination. Do not describe the system as cross-round unlinkable until a user-controlled per-round destination and recovery flow is implemented and tested; the operator must never possess a rater spend or universal decryption key.
- Delete legacy consumers in the same sequence as their contracts: Foundry scripts/tests, deployment JSON, generated ABIs, Ponder schema/handlers, keeper jobs, Next.js surfaces, SDK/agents/MCP payloads, E2E fixtures, env/readiness workflows, and public docs. Use `rg` to prove removed symbols are gone rather than leaving compatibility shims.
- Keep deletion, new contract core, service/indexer migration, and app/SDK migration in separate commits. Regenerate artifacts only from the new deployment schema, and fail closed on mixed legacy/tokenless address bundles.
- The active package graph is tokenless-only. `@rateloop/contracts` exports only the root and `./tokenless`; SDK and agent integrations use quote → ask → wait → result. Treat imports of legacy ABI, deployment, protocol, voting, governance, oracle, profile, reward, confidentiality, or local-signer surfaces as deletion bugs, never as requests for compatibility shims.
- Hosted work for this branch must remain isolated: Vercel project `rateloop-tokenless` on a Vercel-provided domain and Railway project `rateloop-tokenless` with separate Postgres/Ponder/keeper services. Never deploy this branch over the existing production projects, attach `rateloop.ai`, or send a review ask through `rateloop.ai`.
- Base Sepolia service configuration must match the complete live deployment key. Ponder starts from the tokenless deployment block in a deployment-scoped schema; the keeper uses a dedicated gas-only key; the credential signer is a distinct server-only secret and must never have a `NEXT_PUBLIC_` variant.

## Agent image handoff notes

- RateLoop handoff images support JPG, PNG, and WEBP files up to 10 MB per image. Prefer 16:9 for newly generated public images; other ratios are allowed when useful. Do not downscale or recompress a readable mockup just because base64 output would be too large for the terminal or chat transcript.
- When creating a browser handoff from local/generated images, prefer the file-backed CLI path: `yarn workspace @rateloop/agents handoff --file <ask.json> --image <image.png>`. It reads bytes from disk, computes `sha256`/`sizeBytes`, and stages large files through the handoff blob-upload route instead of squeezing base64 through a single JSON request.
- If using MCP directly, pass image bytes from file-backed tooling or an SDK process. Avoid `cat`, `print`, or shelling base64 into the conversation as the transport layer.

## Tokenless review boundaries

- Do not carry forward accepted assumptions from the legacy `ClusterPayoutOracle`, frontend-bond, governance, LREP, stake, or snapshot-recovery model. Those surfaces are removed in the tokenless target.
- Audit the tokenless design against its actual trust split: immutable fund custody and settlement; operator-attested future admission; public deterministic settlement evidence; off-chain moderation, correlation analytics, and legal eligibility.
- Test deployments are allowed to expose explicitly documented limitations. Do not turn a test-stage shortcut into a final trust claim; Phase 5 is the point where immutable/adminless-funds/privacy language must match the deployed system exactly.
