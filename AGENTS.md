# Agent Workflow Notes

- After a requested change is verified, commit it without waiting for a separate prompt unless the user explicitly asks not to commit.
- Commit independent fixes separately. Before pushing, review the changed files and group commits by concern instead of bundling unrelated fixes together.
- When the user asks to publish finished work, commit the intended fixes and push the current branch after verification passes.

## Governance rotation notes

- Rotating `ContentRegistry.setVotingEngine` alone is insufficient: escrows pin the engine at initialization and reject new work with `"Stale engine"` until a full replacement stack is deployed and rewired (`QuestionRewardPoolEscrow`, `FeedbackBonusEscrow`, `FeedbackRegistry`, fee creditor on `FrontendRegistry`, and X402 submitter escrow pointers as applicable).
- Treat engine migration as a coordinated governance runbook, not a single-timelock action.

## Base deployment notes

- Base mainnet (`8453`) is now the production smart-contract deployment boundary, with addresses recorded in `packages/foundry/deployments/8453.json`.
- Treat Base Sepolia (`84532`) as the staging and validation environment for future contract or integration changes before touching production.
- Do not redeploy the production smart contracts as a routine fix. Only consider a full redeploy for a major issue or protocol-breaking problem that cannot be safely repaired with governed upgrades, configuration changes, application changes, keeper/indexer changes, or a targeted runbook.
- Preserve the current production contract addresses by default when updating app, Ponder, Keeper, docs, or environment wiring.
- Frontend application data, blob/object storage, Ponder indexing state, and Keeper persistence should be provisioned explicitly for the selected Base environment instead of inheriting World Chain deployment assumptions.
- Ponder and Keeper services should resolve Base addresses from the shared `@rateloop/contracts` deployment artifacts for chain `84532` or `8453`; remove stale live address overrides instead of carrying World Chain values forward.

## Agent image handoff notes

- RateLoop handoff images support JPG, PNG, and WEBP files up to 10 MB per image. Do not downscale or recompress a readable mockup just because base64 output would be too large for the terminal or chat transcript.
- When creating a browser handoff from local/generated images, prefer the file-backed CLI path: `yarn workspace @rateloop/agents handoff --file <ask.json> --image <image.png>`. It reads bytes from disk, computes `sha256`/`sizeBytes`, and sends the base64 inside the request process without printing it.
- If using MCP directly, pass image bytes from file-backed tooling or an SDK process. Avoid `cat`, `print`, or shelling base64 into the conversation as the transport layer.

## Audit Trust Model Notes

- Do not assume RateLoop is trying to make every oracle-adjacent path fully economically secured per snapshot on-chain. `ClusterPayoutOracle` payout roots are intentionally optimistic: globally bonded frontend operators publish public deterministic artifacts, challengers/auditors can recompute them during the challenge window, governance arbitrates challenged roots, and bad proposers can lose reputation, future fee income, and their FrontendRegistry LREP bond.
- Treat `ClusterPayoutOracle` challenge bonds as anti-spam bonds, not payout-value coverage bonds. The default challenge bond is 5 USDC in atomic units (`5_000_000`).
- Treat the 60-minute `revealGracePeriod` as an accepted product/security parameter, even for long human-duration blind phases. Do not raise it as an audit finding merely because it is shorter than a question's custom epoch duration.
