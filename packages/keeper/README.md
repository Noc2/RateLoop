# RateLoop tokenless-v4 keeper

Permissionless liveness automation for the disposable tokenless Base Sepolia deployment. The keeper has no protocol role and no fund authority. Any account can execute every call it makes.

The worker scans the immutable `TokenlessPanel` directly and performs only:

- opening the reveal window through the disclosed beacon-failure deadline;
- tlock decryption and reveal submission;
- `beginSettlement` terminal/refund or reveal-set freeze;
- bounded aggregate and weight processing;
- finalization;
- permissionless payout/compensation claims when the public ciphertext yields the committed destination material;
- stale unclaimed-share return after the claim deadline.

Round scans start at the newest on-chain ID after a restart and rotate backward through history. New arrivals can use
at most half of a multi-round tick; the rest continues the non-overlapping historical sweep. A one-round tick
alternates tip and history when both lanes have work. Terminal rounds outside their claim window do not trigger
historical commit-log reads. This keeps deadline-sensitive work discoverable without letting sustained round creation
starve older IDs.

There are no frontend-fee, governance, oracle, correlation-root, reward-pool, feedback-bonus, advisory-vote, content-dormancy, or registry jobs.

## Deployment identity

Production startup only accepts Base Sepolia (`84532`) and requires:

```text
tokenless-v4:<chainId>:<panel>:<credentialIssuer>:<x402PanelSubmitter-or-zero>:<feedbackBonus>
```

The configured addresses must match that key. Startup also verifies bytecode at the panel and issuer, checks the panel's immutable `credentialIssuer`, confirms the RPC chain, and rejects a deployment block ahead of the chain. This prevents a legacy or mixed deployment bundle from looking healthy.

## Signer custody

Production accepts only a dedicated AWS KMS `ECC_SECG_P256K1` gas signer. The
configured exact key ARN must be in an EU AWS region, its public key must recover
the configured keeper address, and every signature must come back from that same
key. The key policy should grant only `kms:GetPublicKey` and `kms:Sign`; the
permissionless keeper role needs no protocol or fund authority.

AWS credentials come from `AssumeRoleWithWebIdentity`. The Railway deployment
must mount a continuously refreshed OIDC token at `AWS_WEB_IDENTITY_TOKEN_FILE`
and scope `TOKENLESS_KEEPER_KMS_ROLE_ARN` to the isolated keeper workload in the
IAM trust policy. The AWS SDK exchanges that token for short-lived credentials
and refreshes them from the file. Static AWS access keys, raw keeper private keys,
and local keystores are rejected in production. A Foundry keystore or raw key is
available only for explicit non-production development and tests.

Every managed signing attempt is written to the shared Postgres ledger before
KMS is called, then receives an immutable success or failure event before the
keeper continues. The events bind the keeper role, exact key ARN, digest,
purpose, AWS request ID, error class, timestamps, and signature or transaction
identity without storing signature bytes or secret material. `DATABASE_URL` is
therefore required whenever the managed signer is configured. Per-class signing
failure counters distinguish retryable timeouts, throttling, and outages from
key/access configuration or malformed-response incidents.

## Sealed reveal payload

The tlock plaintext is ABI encoded as:

```text
(bytes4 magic="RLT1", uint8 version=1, uint256 roundId, address voteKey,
 uint8 vote, uint16 predictedUpBps, bytes32 responseHash,
 address payoutAddress, bytes32 salt)
```

The keeper rejects wrong magic/version, invalid prediction buckets, and round or vote-key mismatches. Base Sepolia is pinned to drand quicknet-t.

If the beacon is late or unavailable, the keeper does not invent or retain a rater key. Both automatic reveal and the rater's client-backed self-reveal remain open through `beaconFailureDeadline`. After the normal reveal deadline, zero-commit and already-quorate rounds settle immediately; an under-quorum round stays open for valid late reveals and settles only after the beacon-failure deadline. The keeper reports both `selfRevealFallbacksPending` and `roundsAwaitingBeaconFailure`. In a beacon-failure terminal round, automatic compensation claiming is possible only if the ciphertext later decrypts. Otherwise the rater must use their locally retained payout material before the claim deadline.

## Health

- `GET /live`: public container liveness.
- `GET /ready`: public operational readiness without secret metrics.
- `GET /health`: authenticated operational health.
- `GET /metrics`: authenticated Prometheus metrics.

Set `METRICS_AUTH_TOKEN` to at least 16 characters for any hosted/non-loopback bind.

## Run

```bash
yarn workspace @rateloop/keeper check-types
yarn workspace @rateloop/keeper test
yarn workspace @rateloop/keeper start
```
