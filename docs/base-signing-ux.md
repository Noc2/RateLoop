# Base signing UX plan

RateLoop's production deployment boundary is Base mainnet, with Base Sepolia used for staging and validation before future production changes. This note captures the wallet UX checks that should keep passing on both Base environments.

## Implemented improvements

- Deployed Base frontends can enable viem's Flashblocks/preconfirmation chain metadata with `NEXT_PUBLIC_USE_BASE_PRECONF_RPC=true`. Dedicated `NEXT_PUBLIC_BASE_PRECONF_RPC_URL_8453` and `NEXT_PUBLIC_BASE_PRECONF_RPC_URL_84532` values are preferred first, then Base's public preconfirmation endpoints, then the ordinary `NEXT_PUBLIC_RPC_URL_<chainId>` fallback.
- Base frontend clients poll preconfirmation RPCs at 500ms, and ordinary Base RPCs at 1s instead of the global 30s UI interval. Preconfirmation RPCs improve perceived speed, while mined receipts and Ponder indexing remain the source of truth for completed RateLoop state.
- External wallets now get a direct wagmi capability probe for EIP-5792 batch support. This covers Base Sepolia and Base mainnet wallets whose `wallet_getCapabilities` result is visible through wagmi even if the thirdweb active-wallet bridge is stale.
- Thirdweb in-app wallets use EIP-7702 on Base Sepolia and Base mainnet so the execution sender stays aligned with the Google/email wallet's EOA for sender-bound flows such as legacy allocation claims.
- Self-funded external wallet batches can execute through wagmi `sendCallsSync`, so MetaMask/Base Account style wallets can use `wallet_sendCalls` for atomic Base batches instead of falling back to separate `approve` and action transactions.
- Agent handoff and browser signing pages segment `transactionPlan.calls`, preserve reservation/explicit wait phases, and batch adjacent zero-delay calls through `wallet_sendCalls` when an external wallet reports atomic batch support.
- Batched voting no longer asks for an LREP permit signature first. If allowance is low, the batched path submits `LoopReputation.approve(votingEngine, amount)` and `RoundVotingEngine.commitVote(...)` together as one atomic wallet batch.
- Thirdweb in-app wallets keep the sponsored/self-funded thirdweb path, including the existing verifier allowlist for `approve + commitVote` and the current free-transaction accounting.

## Expected prompt counts

- Zero-LREP advisory vote: one transaction confirmation.
- Staked vote with enough allowance: one transaction confirmation.
- Staked vote with low allowance and atomic batching available: one wallet batch confirmation for `approve + commitVote`.
- Staked vote when the round must be opened first: one `openRound` confirmation, then one vote batch confirmation. This remains two phases because the vote runtime is anchored after the round exists.
- Question submit with bounty: reservation remains separate, then `approve + submitQuestion` can batch. The reservation wait is intentional protocol behavior.
- Question submit with bounty and feedback bonus: reservation remains separate, then `approve + submitQuestion`, then `approve + createFeedbackBonusPoolWithAsset`. The feedback pool needs the new `contentId`, so it cannot be safely pre-batched with submit without a new protocol/router design.

## Base Sepolia test checklist

1. Set `NEXT_PUBLIC_USE_BASE_PRECONF_RPC=true` and set `NEXT_PUBLIC_BASE_PRECONF_RPC_URL_84532` to a Base Sepolia Flashblocks/preconfirmation RPC, or confirm the default `https://sepolia-preconf.base.org` public endpoint is acceptable for the test run.
2. Keep Ponder and Keeper on sealed-block RPCs such as `PONDER_RPC_URL_84532`; they should not index against preconfirmed state.
3. Connect an external wallet on chain `84532` and confirm the app resolves atomic batch support.
4. Submit a question with a USDC bounty. Expected: reserve confirmation, then one atomic batch for approval plus submit.
5. Add a feedback bonus during submit. Expected: a second atomic batch for feedback approval plus pool creation after the content id exists.
6. Vote with an account that has LREP but no voting-engine allowance. Expected: no permit signature prompt; the wallet shows one batch containing approval and vote.
7. Repeat with thirdweb in-app login. Expected: sponsored execution remains available where the free-transaction verifier allows the call set.
8. Repeat failures with a wallet that does not report atomic support. Expected: the app falls back to the older direct transaction path instead of pretending batching is available.

## Deferred options

- Session keys can reduce repeated prompts for power users, but they need explicit spend limits, action allowlists, revocation UX, and a security review before enabling them.
- A single-transaction question submit plus feedback bonus would require a new router or protocol helper that can safely derive/fund the new `contentId`. Do not add this during Base Sepolia testing unless the desired custody and failure semantics are specified first.
