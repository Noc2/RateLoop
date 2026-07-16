# Smart Contracts

The tokenless v4 target keeps customer-funded settlement in four narrow contracts. The v4 registry is currently
**unreleased**: no canonical v4 Base Sepolia address bundle exists yet, and historical v1-v3 addresses are not v4
addresses.

<a id="tokenless-panel"></a>

## TokenlessPanel

The immutable fund core creates and funds rounds, accepts voucher-bound commits, reveals sealed reports, processes
deterministic settlement, compensates accepted work, returns refunds, pays claims, releases fees, and returns stale
shares. It has no administrator or operator path to customer funds.

<a id="credential-issuer"></a>

## CredentialIssuer

The issuer accepts epoch-scoped admission signers for future vouchers. A signer can affect who may join future work,
but the contract holds no customer funds and cannot change an accepted commit, settlement input, or payout destination.

<a id="x402-panel-submitter"></a>

## X402PanelSubmitter

The stateless adapter verifies the agent's EIP-3009 USDC authorization and bound round authorization, transfers the
exact approved amount, and calls the panel in one transaction. It cannot retain or redirect the customer's funds.

<a id="tokenless-feedback-bonus"></a>

## TokenlessFeedbackBonus

The optional Feedback Bonus has its own immutable escrow and accounting. A configured human awarder may pay selected
eligible written feedback from the prefunded pool; the connected agent, platform operator, and automatic scoring cannot
choose an award or redirect its payout. Unawarded funds return to the immutable refund recipient after the deadline.
Bonus funds cannot satisfy guaranteed bounty, fee, reserve, or accepted-work liabilities.

<a id="deployment-key"></a>

## One deployment key

A v4 deployment key binds the chain, deployment block, panel, issuer, x402 adapter, Feedback Bonus escrow, and generated
interfaces. The app, indexer, and keeper reject incomplete or mixed address bundles rather than guessing which contract
set is authoritative.
