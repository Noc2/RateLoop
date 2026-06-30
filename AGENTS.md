# Agent Workflow Notes

- After a requested change is verified, commit it without waiting for a separate prompt unless the user explicitly asks not to commit.
- Commit independent fixes separately. Before pushing, review the changed files and group commits by concern instead of bundling unrelated fixes together.
- When the user asks to publish finished work, commit the intended fixes and push the current branch after verification passes.

## Governance rotation notes

- The RateLoop smart contracts are deployed in production. Do not change Solidity contracts,
  contract deployment wiring, or generated contract artifacts/ABIs as routine product work.
  Contract changes should happen only through the appropriate governance process, or for an
  urgent production/security issue that justifies emergency handling.
- Rotating `ContentRegistry.setVotingEngine` alone is insufficient: escrows pin the engine at initialization and reject new work with `"Stale engine"` until a full replacement stack is deployed and rewired (`QuestionRewardPoolEscrow`, `FeedbackBonusEscrow`, `FeedbackRegistry`, fee creditor on `FrontendRegistry`, and X402 submitter escrow pointers as applicable). Those contracts expose no governed `setVotingEngine`; plan a coordinated redeploy and rewire, not a registry-only timelock action.
- Treat engine migration as a coordinated governance runbook, not a single-timelock action.

## Agent image handoff notes

- RateLoop handoff images support JPG, PNG, and WEBP files up to 10 MB per image. Prefer 16:9 for newly generated public images; other ratios are allowed when useful. Do not downscale or recompress a readable mockup just because base64 output would be too large for the terminal or chat transcript.
- When creating a browser handoff from local/generated images, prefer the file-backed CLI path: `yarn workspace @rateloop/agents handoff --file <ask.json> --image <image.png>`. It reads bytes from disk, computes `sha256`/`sizeBytes`, and stages large files through the handoff blob-upload route instead of squeezing base64 through a single JSON request.
- If using MCP directly, pass image bytes from file-backed tooling or an SDK process. Avoid `cat`, `print`, or shelling base64 into the conversation as the transport layer.

## Audit Trust Model Notes

- Do not assume RateLoop is trying to make every oracle-adjacent path fully economically secured per snapshot on-chain. `ClusterPayoutOracle` payout roots are intentionally optimistic: globally bonded frontend operators publish public deterministic artifacts, challengers/auditors can recompute them during the challenge window, governance arbitrates challenged roots, and bad proposers can lose reputation, future fee income, and their FrontendRegistry LREP bond.
- Treat `ClusterPayoutOracle` challenge bonds as anti-spam bonds, not payout-value coverage bonds. The default challenge bond is 5 USDC in atomic units (`5_000_000`).
- Treat the 60-minute `revealGracePeriod` as an accepted product/security parameter, even for long human-duration blind phases. Do not raise it as an audit finding merely because it is shorter than a question's custom epoch duration.
