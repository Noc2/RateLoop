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

Production uses a dedicated gas-only secp256k1 key held in Railway's sealed
service variables. `KEEPER_PRIVATE_KEY` remains the deployment-compatible input;
`TOKENLESS_KEEPER_PRIVATE_KEY` is the preferred explicit name for new services.
When both exist they must contain the same key. The permissionless keeper account
has no protocol or fund authority and should hold only the configured minimum gas
balance.

`TOKENLESS_KEEPER_EXPECTED_ADDRESS` optionally pins the recovered address, and
`TOKENLESS_KEEPER_KEY_VERSION` optionally pins the rotation identifier. Startup
fails on a mismatch. Existing isolated deployments without those values derive
the address from the sealed key and use the deterministic
`railway-tokenless-v1` version until the explicit pins are added. A Foundry
keystore remains local-test only.

Every signing attempt is written to the shared Postgres ledger before the key is
used, then receives an immutable success or failure event before the keeper
continues. Events bind the keeper role, `platform-secret` provider, non-secret
key version identifier, digest, purpose, error class, timestamps, and signature
or transaction identity without storing signature bytes or key material.
`DATABASE_URL` is therefore required. Per-class counters distinguish operational
failures from key configuration or malformed-signature incidents.

## Sealed reveal payload

The tlock plaintext is ABI encoded as:

```text
(bytes4 magic="RLT1", uint8 version=1, uint256 roundId, address voteKey,
 uint8 vote, uint16 predictedUpBps, bytes32 responseHash,
 address payoutAddress, bytes32 salt)
```

The keeper rejects wrong magic/version, invalid prediction buckets, and round or vote-key mismatches. Base Sepolia is
pinned to drand quicknet-t. Scoring evidence is the raw 48-byte drand signature, and the keeper also requires the
reported randomness to equal `sha256(signature)` before it submits the proof on-chain.

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
