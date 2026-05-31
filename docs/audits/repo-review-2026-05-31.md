# RateLoop Repo Review — 2026-05-31

Scope: the whole repository at `main` HEAD `1b4c256b` ("Merge pull request #29 from Noc2/claude/wip"), with attention concentrated on everything that changed since the last full audit baseline `0dfc83b8` (`docs/audits/full-repo-audit-2026-05-22.md`) — **308 commits**. The biggest new surfaces in that window are the financial flows added since the last audit: EIP-3009 USDC `receiveWithAuthorization` funding, LREP permit-backed vote commits, the asset-aware `FeedbackBonusEscrow`, `QuestionRewardPoolEscrow`, and the in-app wallet / EIP-7702 delegation fallbacks.

Method: five parallel scope-focused agents (contracts-funds, contracts-access/lifecycle, ponder indexer, nextjs wallet/signing, keeper + cross-package), each briefed with the two prior audits and the list of findings already being remediated in worktree branches so they would not re-report known issues. Every candidate finding was then handed to an independent adversarial verifier instructed to **refute by default** and to read the actual source (callers + callees) before confirming. 12 candidates were raised; **5 confirmed, 7 refuted** on verification. The confirmed contract finding (drand) and the headline severity were additionally re-verified by hand for this report.

**Pre-deployment framing.** Nothing is deployed to mainnet yet. Severities reflect "impact-if-this-shipped-as-is". The one High item is a deployment/wiring defect that bricks an *already-active* component on the World Chain Sepolia (4801) testnet, which is exactly the deployment whose artifacts are being actively refreshed — so it is the most actionable item here.

**Out of scope / could not run.** Foundry contract tests could not execute in this environment (sandbox has no network to fetch `solc 0.8.35`), so the contract findings are from static review only. The following DID run clean: Ponder test suite (195 passed, 2 skipped); `check-types` for ponder, keeper, sdk, node-utils, agents, and nextjs (all pass).

**Already being fixed (NOT re-reported here).** Worktree branches are mid-remediation on: advisory cooldown across recorder rotation (L-Vote-5), `ContentRegistry` `revokeVotingEngine` / callback auth (M-Identity-1), frontend-fee drift on `tryTransfer` redirect (M-Funds-1), cancel-lockout test gap (L-Vote-4), proposer-bond clawback (L-Integrations-1), `ProfileRegistry.releaseName` role gate (L-Identity-2). The previously-deferred `openRound` reentrancy item (M-1) was confirmed fixed by commit `b90cead6` ("Guard open round against reentrancy").

---

## Resolution summary

| Severity      | Confirmed | Refuted on verification |
| ------------- | --------- | ----------------------- |
| Critical      | 0         | 0                       |
| High          | 1         | 0                       |
| Low           | 3         | 4                       |
| Informational | 0         | 3                       |
| **Total**     | **4**     | **7**                   |

(The original 5 confirmed items collapse to 4: two of them — one filed under contracts-funds, one under contracts-access — are the same `commitVote` permit issue and are merged below as **F-2**.)

**Headline.** The protocol contracts are in good shape — no Critical/High contract findings, and the new EIP-3009/permit fund-flow paths held up to value-conservation and replay scrutiny (see Refuted). The one High is **off-chain**: the keeper hardcodes the *mainnet* drand beacon and therefore cannot decrypt (and so can never reveal) any vote on the testnet deployment, whose rounds commit to the `quicknet-t` beacon.

---

## High

### F-1 — Keeper hardcodes the mainnet drand client and cannot reveal votes on the testnet (4801) deployment

> ✅ **Fixed independently on `main` in commit `3d8921fa` ("Fix keeper tlock client selection")** — landed while this PR was in review. `main`'s fix resolves the per-round beacon selection in the keeper, so this PR no longer carries a keeper change for F-1 (the merge takes main's version). The finding below is retained for the record.

- **Files:** `packages/keeper/src/keeper.ts:48` (module init), `:330-345` (`decryptTlockVoteCiphertext`), `:347-377` (`validateCiphertextMetadata`).
- **What's wrong.** The keeper builds a single tlock client at module load — `const tlockClient = mainnetClient();` (`keeper.ts:48`) — and decrypts **every** committed vote with it via `timelockDecrypt(armored, tlockClient)` (`keeper.ts:343`). It never consults the round's `drandChainHash`. It imports only `decodeRbtsVotePlaintext` and `parseTlockCiphertextMetadata` from `@rateloop/contracts/voting` — not the shared `resolveTlockClientForRuntime`, which is internal to that module and not exported.
- **Why it breaks the testnet.** `Deploy.s.sol._resolveDrandConfig` configures `ProtocolConfig` on chainId **4801** (World Chain Sepolia) to `TESTNET_DRAND_CHAIN_HASH = 0xcc9c3984…a9a5` = `quicknet-t` (`Deploy.s.sol:64-65`, with an explicit comment that testnet "explicitly commits to `quicknet-t`"). `RoundVotingEngine` snapshots that hash per round and enforces that each commit's `drandChainHash` matches it, so on 4801 every ciphertext the frontend produces is timelock-encrypted to the **quicknet-t** beacon. The frontend does this correctly via `voting.ts → resolveTlockClientForRuntime`, which maps that hash to `createHttpTlockClient(QUICKNET_T_CHAIN)`. The keeper then feeds that ciphertext to the **mainnet quicknet** client → wrong beacon public key → `timelockDecrypt` fails.
- **Why it's silent and terminal.** `validateCiphertextMetadata` only checks that the ciphertext metadata's `drandChainHash` equals the commit's stored `drandChainHash` — it never checks that the client actually *serves* that chain — so the bad ciphertext passes straight into decrypt. `classifyDecryptError` treats anything that isn't the `"too early to decrypt the ciphertext"` fragment as non-retryable; `trackDecryptFailure` accumulates to `MAX_DECRYPT_RETRIES = 10` and the commit is marked permanently failed. Both `_revealCommits` and `_revealAdvisoryCommits` share this decrypt path.
- **Net effect.** On the active 4801 testnet the keeper can never reveal any RBTS or advisory vote; rounds drift to reveal-failed and stakes are swept/refunded instead of settling. Mainnet (480) and local dev (31337) use mainnet `quicknet`, so they work — which masks the bug exactly where it isn't tested. There is no keeper env knob (no `DRAND_*`/`TLOCK_*` var in `config.ts`) to redirect the beacon.
- **Trigger.** Run the keeper against 4801, cast an RBTS vote from the frontend, let the epoch end. The keeper fetches the ciphertext from Ponder, verifies the keccak hash, then `timelockDecrypt` with `mainnetClient()` fails; after 10 ticks the commit is permanent-failed and the round becomes reveal-failed despite a valid, decryptable vote existing.
- **Suggested fix.** Select the tlock client per-round from `drandChainHash` instead of hardcoding `mainnetClient()`. Cleanest: export `resolveTlockClientForRuntime` (or a thin `getTlockClientForChainHash(hash)`) from `@rateloop/contracts/voting` and have `decryptTlockVoteCiphertext` build/cache a client keyed by `commit.drandChainHash`. At minimum, extend `validateCiphertextMetadata` to assert the commit's `drandChainHash` is the chain the active client serves and **hard-fail loudly** (alert) rather than looping silently to permanent-fail, and add a keeper env override (`DRAND_CHAIN_HASH` / `DRAND_URL`) so 4801 can point at `quicknet-t`. Add a keeper test that exercises a `quicknet-t` round to lock this in.

---

## Low

### F-2 — Appended LREP permit in `commitVote` is not front-run-tolerant (removed `try/catch`), enabling a one-tx griefing delay

- **Files:** `packages/foundry/contracts/RoundVotingEngine.sol:530-547` (`_applyAppendedPermit`), called from `commitVote` at `:381-382`.
- **What's wrong.** The new permit-backed commit path parses an ERC-2612 permit appended after the ciphertext calldata and applies it with a **bare** call — `IERC20Permit(address(lrepToken)).permit(msg.sender, address(this), stakeAmount, permitDeadline, v, r, s)` (`:546`) — with no `try/catch` and no allowance fallback. The previous helper `VotePreflightLib.permitStake` (deleted in this diff range) wrapped `permit` in `try/catch` and only required `allowance >= amount` afterwards, precisely so a front-run that consumed the owner's nonce could not brick the commit. That tolerance was removed.
- **Impact.** ERC-2612 permits carry a public signature in the mempool; an observer can copy the appended `(deadline,v,r,s)` and submit a bare `lrepToken.permit(victim, engine, …)` first, advancing the owner's nonce. The victim's `commitVote` then reverts inside `permit()`. No funds are at risk (the `safeTransferFrom` is downstream and never runs). The DoS is **self-healing after a single failed tx**: the front-runner's own replayed permit sets the victim's allowance to `stakeAmount`, so the frontend's next plan build sees sufficient allowance (`roundVoteTransactionPlan.ts` `needsApproval = currentAllowance < stakeWei`) and falls through to a plain `commitVote` with no appended permit, which succeeds. So this is a one-transaction griefing delay, not a persistent lock-out. Existing test `RoundVotingEngineBranches.t.sol:733-752` already demonstrates the revert path.
- **Note on framing.** The finder labeled this a regression of "L-Vote-7"; that ID does not appear in the cited audit docs, so treat the label loosely — the underlying `try/catch` removal is real regardless.
- **Suggested fix.** Restore front-run tolerance in `_applyAppendedPermit`: short-circuit when allowance already suffices, and wrap the permit in `try/catch`, e.g. `if (lrepToken.allowance(msg.sender, address(this)) >= stakeAmount) return; try IERC20Permit(address(lrepToken)).permit(msg.sender, address(this), stakeAmount, permitDeadline, v, r, s) {} catch {}` — leaving the existing `safeTransferFrom` to enforce sufficiency. This makes the single-tx happy path succeed even when a front-runner already consumed the nonce.

### F-3 — `FeedbackBonusEscrow` funder-refund forfeiture is never indexed (pool shows funds available forever)

- **Files:** contract `packages/foundry/contracts/FeedbackBonusEscrow.sol:388-397` (event `FeedbackBonusFunderRefunded` declared at `:113`); indexer `packages/ponder/src/FeedbackBonusEscrow.ts` (handlers registered only for `FeedbackBonusPoolCreated`, `FeedbackBonusAwarded`, `FeedbackBonusForfeited`).
- **What's wrong.** `forfeitExpiredFeedbackBonus` has two exit paths: if the protocol treasury is set it transfers the residue to treasury and emits `FeedbackBonusForfeited`; if the treasury is unset (`address(0)` — a paused/rotated `ProtocolConfig`) it falls back to refunding the original funder and emits **`FeedbackBonusFunderRefunded`**. Both branches first set `pool.forfeited = true` and `pool.remainingAmount = 0`. The Ponder indexer has **no handler** for `FeedbackBonusFunderRefunded` (the event is present in the consumed ABI, `FeedbackBonusEscrowAbi.ts:1032`). So when the fallback fires, the on-chain pool is fully drained but the indexed `feedbackBonusPool` row keeps its old `remainingAmount`, `forfeited=false`, `forfeitedAmount=0` indefinitely — an event-vs-storage drift that reports the pool as still having unawarded funds.
- **Severity rationale.** The fallback branch is an explicit defense-in-depth path (dev comment "L-Funds-2") reached only when `ProtocolConfig` is unset / `treasury()` is `address(0)` — an uncommon degraded state, not the normal path (which emits `FeedbackBonusForfeited` and *is* indexed). No fund loss; the on-chain `require(!pool.forfeited)` prevents any double-action. Impact is purely stale indexer data in a rare config state.
- **Suggested fix.** Add a `ponder.on("FeedbackBonusEscrow:FeedbackBonusFunderRefunded", …)` handler mirroring the `FeedbackBonusForfeited` one (`remainingAmount: 0n`, `forfeitedAmount += amount`, `forfeited: true`, bump `updatedAt`, `touchContent`). Both branches are the same terminal state, so factor a shared `updateForfeited` helper to prevent future drift.

### F-4 — Browser signing page sends wallet transactions without an explicit `chainId`

- **File:** `packages/nextjs/components/agent/BrowserSigningPage.tsx:441` (`handleExecute`).
- **What's wrong.** Each transaction-plan call is dispatched via `sendTransaction(wagmiConfig, { data, to, value })` with **no `chainId`**. The code awaits `switchToChain(intent.chainId)` once before the loop, but wagmi/viem only perform a live `eth_chainId` assertion when a chain is passed: with `chainId` omitted, `@wagmi/core` sets `chain: null` and viem's `assertCurrentChain` is gated behind `if (chain !== null)`, so the per-call live-chain check is skipped entirely (wagmi also hardcodes `assertChainId: false`). If the pre-loop switch is resolved optimistically by the wallet, ignored, or the user manually switches back, the ERC-20 approve + escrow-funding calls can broadcast on an unintended chain.
- **Why it's distinct from prior work.** The earlier H-1 fix bound the EIP-712 **typed-data** `domain.chainId`; the typed-data branch here does cross-check `typedData.domain.chainId === intent.chainId`. But the **wallet-calls** branch — the common path for bounty / reward-pool funding — has no equivalent runtime guard. `value` is forced to 0, so the hazard is mis-targeted approve/funding calls, recoverable but real.
- **Suggested fix.** Pass `chainId: intent.chainId` to `sendTransaction` (guarded by a non-null check) so viem re-asserts the live wallet chain per call and throws `ChainMismatchError` on mismatch; optionally a defensive `getChainId(wagmiConfig)` check right after the switch, and pass `chainId` to `waitForTransactionReceipt` too.

---

## Refuted on verification

Each of these was raised by a finder and dropped after an independent reader traced the actual guards/callers. Recorded so they aren't re-investigated next pass.

| # | Title | Why it doesn't hold |
|---|-------|---------------------|
| R-1 | EIP-3009 funding nonce is deterministic, "blocks" duplicate identical pools (`FeedbackBonusEscrow` / `QuestionRewardPoolEscrow`) | Expected EIP-3009 property. Second identical submission simply reverts before any state change; funder varies `validAfter`/`validBefore` (or any field) for a distinct nonce. `to == address(this) == msg.sender` blocks third-party replay. No fund/accounting impact. |
| R-2 | `X402QuestionSubmitter` could strand USDC if downstream pulls less than the forced approval | Value is conserved at three enforced points: `value == amount` assertion, `pullExactToken` `require(received == amount)`, and unmodified `amount` threaded with no fee skim. USDC is non-fee-on-transfer. Candidate self-flagged as "N/A on current code". |
| R-3 | Appended-permit calldata length under-validated (partial tail accepted) | Caller-controlled direct call bound to `msg.sender`; a partial tail leaves the `s` word zero-padded → invalid sig → `permit()` reverts (fail-closed). No forge path, no silent success. Normal client appends exactly 128 bytes. |
| R-4 | Ponder `FeedbackBonusAwarded` asset fallback `?? 1` and `FeedbackRevealed` `committedAt` mislabels | Unreachable. Single-chain strict `(block, logIndex)` ordering + on-chain causality (award requires existing pool; reveal requires prior commit) means the insert/fallback branches never run. Dead defensive code, unlike the genuine follow.createdAt case. |
| R-5 | `QuestionRewardClaimed` updates aggregates unconditionally (no `existingClaim` guard) unlike the bundle handler | Real code asymmetry but not reachable: on-chain `rewardClaimed` mapping prevents a second emit; Ponder's reorg model rolls back the increment with the row, so no double-count. Stylistic, not a bug. |
| R-6 | `completeAgentSigningIntent` idempotency not atomic (concurrent double-complete) | Every downstream effect is idempotent: confirm tool short-circuits on `status == "submitted"` and only re-reads already-mined receipts; terminal DB write uses guarded `CASE WHEN status = 'submitted'` SQL. Racing writers converge to identical state. |
| R-7 | EIP-3009/permit EIP-712 domains hardcode name/version, breaking non-canonical token deployments | LREP domain matches `LoopReputation` in every deployment. USDC name only differs for the local-dev `MockERC20` ("USD Coin"), never production. Caller falls back to approve+fund on signature failure; funds never misrouted. |

---

## Test / typecheck status captured during this review

- **Ponder tests:** 195 passed, 2 skipped (`yarn workspace @rateloop/ponder test`).
- **Type-checks:** pass for ponder, keeper, sdk, node-utils, agents, nextjs.
- **Foundry contract tests:** could not run — the environment has no network to fetch `solc 0.8.35` (`forge` errors with "can't install missing solc 0.8.35 in offline mode"). Contract findings above are static-review only and should be confirmed against a live `forge test` run. F-2's revert path is already covered by existing test `RoundVotingEngineBranches.t.sol:733-752`.
