# Base signing UX plan

RateLoop's production deployment boundary is Base mainnet, with Base Sepolia used for staging and validation before future production changes. This note captures the wallet UX checks that should keep passing on both Base environments.

## Implemented improvements

- Deployed Base frontends can enable viem's Flashblocks/preconfirmation chain metadata with `NEXT_PUBLIC_USE_BASE_PRECONF_RPC=true`. When enabled, the matching `NEXT_PUBLIC_RPC_URL_<chainId>` must point at a Flashblocks-capable provider; RateLoop does not use a separate preconfirmation RPC env var or Base's public preconfirmation endpoint.
- Base frontend clients poll active preconfirmation receipt status at 200ms, and ordinary Base RPCs at 1s instead of the global 30s UI interval. Preconfirmation RPCs improve perceived speed, while mined receipts and Ponder indexing remain the source of truth for completed RateLoop state.
- External wallets now get a direct wagmi capability probe for EIP-5792 batch support. This covers Base Sepolia and Base mainnet wallets whose `wallet_getCapabilities` result is visible through wagmi even if the thirdweb active-wallet bridge is stale.
- Thirdweb in-app wallets use EIP-7702 on Base Sepolia and Base mainnet so the execution sender stays aligned with the Google/email wallet's EOA for sender-bound flows such as legacy allocation claims.
- Self-funded external wallet batches can execute through wagmi `sendCallsSync`, so MetaMask/Base Account style wallets can use `wallet_sendCalls` for atomic Base batches instead of falling back to separate `approve` and action transactions.
- Agent handoff and browser signing pages segment `transactionPlan.calls`, preserve reservation/explicit wait phases, and batch adjacent zero-delay calls through `wallet_sendCalls` when an external wallet reports atomic batch support.
- Feedback Bonus wallet-call plans mark their adjacent `approve + createFeedbackBonusPoolWithAsset` calls as requiring atomic execution. Browser wallet flows stop with a clear unsupported-wallet message instead of degrading that pair into separate transactions; trusted local signer automation still validates and submits its server-returned calls in order.
- Low-level MCP, SDK, or raw HTTP wallet-call hosts must treat `requiresAtomicExecution: true` as a hard requirement: execute the full plan as an atomic wallet batch or return an unsupported-wallet error.
- Native EIP-3009/x402 ask submission uses the x402 submitter as the gateway, so bounty-only asks no longer need a separate reservation transaction. When a single-question ask includes a USDC Feedback Bonus, the signed authorization covers bounty plus bonus and `submitQuestionWithX402OneShotPayment` funds both protocol escrow and the Feedback Bonus pool in one submit transaction.
- Batched voting no longer asks for an LREP permit signature first. If allowance is low, the batched path submits `LoopReputation.approve(votingEngine, amount)` and `RoundVotingEngine.commitVote(...)` together as one atomic wallet batch.
- Thirdweb in-app wallets keep the sponsored/self-funded thirdweb path, including the existing verifier allowlist for `approve + commitVote` and the current free-transaction accounting.

## Expected prompt counts

- Zero-LREP advisory vote: one transaction confirmation.
- Staked vote with enough allowance: one transaction confirmation.
- Staked vote with low allowance and atomic batching available: one wallet batch confirmation for `approve + commitVote`.
- Staked vote when the round must be opened first: one `openRound` confirmation, then one vote batch confirmation. This remains two phases because the vote runtime is anchored after the round exists.
- Direct wallet-call question submit with bounty: reservation remains separate, then `approve + submitQuestion` can batch. The reservation wait is intentional protocol behavior for the public direct path.
- Browser handoff or native EIP-3009/x402 question submit with an eligible USDC bounty: one wallet signature for the USDC authorization, then one submit transaction.
- Native EIP-3009/x402 question submit with bounty and a USDC Feedback Bonus: one wallet signature for the total USDC authorization, then one one-shot submit transaction that funds both pools. LREP Feedback Bonus funding still uses the separate wallet-call pool flow.

## Base Sepolia test checklist

1. Set `NEXT_PUBLIC_USE_BASE_PRECONF_RPC=true` and set `NEXT_PUBLIC_RPC_URL_84532` to a Base Sepolia Flashblocks-capable RPC.
2. Keep Ponder and Keeper on sealed-block RPCs such as `PONDER_RPC_URL_84532`; they should not index against preconfirmed state.
3. Connect an external wallet on chain `84532` and confirm the app resolves atomic batch support.
4. Submit a direct wallet-call question with a USDC bounty. Expected: reserve confirmation, then one atomic batch for approval plus submit.
5. Submit a native EIP-3009/x402 question with a USDC bounty. Expected: one USDC authorization signature, then one submit transaction without a reservation transaction.
6. Add a USDC Feedback Bonus to the native EIP-3009/x402 ask. Expected: the authorization value is bounty plus bonus, the plan has one `submitQuestionWithX402OneShotPayment` call, and status shows the Feedback Bonus as funded after `rateloop_confirm_ask_transactions`.
7. Vote with an account that has LREP but no voting-engine allowance. Expected: no permit signature prompt; the wallet shows one batch containing approval and vote.
8. Repeat with thirdweb in-app login. Expected: sponsored execution remains available where the free-transaction verifier allows the call set.
9. Repeat failures with a wallet that does not report atomic support. Expected: ordinary ordered plans fall back to the older direct transaction path, while atomic-required Feedback Bonus batches stop with an unsupported-wallet message instead of splitting the protected pair.

## Deferred options

- Session keys can reduce repeated prompts for power users, but they need explicit spend limits, action allowlists, revocation UX, and a security review before enabling them.
- Collapsing direct wallet-call bounty submission into one prompt without x402 would require a different account abstraction or delegated-session model. Keep that behind explicit spend limits, revocation UX, and a security review.
