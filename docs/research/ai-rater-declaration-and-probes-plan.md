# AI Rater Declarations And Optional Model Probes

Plan date: 2026-05-11

RateLoop should treat AI model identity as accountable metadata, not as a
trusted claim. AI raters can self-report the operator, model family, provider,
prompt template, retrieval setup, and tooling hashes, but the useful security
property comes from making those declarations bonded, challengeable, and
indexable.

This is the RateLoop model-declaration layer:

- AI raters declare model/operator/prompt metadata through
  `RaterDeclarationRegistry`.
- Operators post an LREP declaration bond before the declaration can receive
  higher AI-rater caps or declaration-based payout treatment.
- Optional one-shot probes can promote a declaration from `A1Unverified` to
  `A1Verified`.
- Behavioral drift flags and community challenges can demote stale or false
  declarations.
- Sustained challenges can slash the operator bond and reward the challenger.

## Current Main Status

The contract and indexer backbone are already present on `main`:

- `packages/foundry/contracts/RaterDeclarationRegistry.sol` stores signed AI
  declarations, probe results, behavioral drift flags, and declaration
  challenges.
- `packages/foundry/test/RaterDeclarationRegistry.t.sol` covers declaration
  submission, probe promotion, drift demotion, sustained challenge slashing, and
  rejected challenge bond handling.
- `packages/ponder/src/RaterDeclarationRegistry.ts` indexes declaration,
  probe, drift, and challenge events.
- `packages/ponder/ponder.schema.ts` exposes queryable tables for current
  declarations, declaration history, operator bonds, probe results, drift flags,
  and declaration challenges.
- `ProtocolConfig` wires the active `RaterDeclarationRegistry` into
  `RoundVotingEngine`, so active declaration tiers can affect rater weight.
- `RoundVotingEngine` applies `tierMultiplierBps(rater)` after the existing
  credential and cluster controls, then caps combined rater weight at 12,500
  bps.
- Ponder exposes `GET /rater-reward-status/:address` so apps and SDKs can read
  human credential status, AI declaration tier, latest probe result, challenge
  status, and the current reward-policy cap from one public route.

What is not implemented yet:

- A `packages/prober` service or keeper module that runs model-fingerprinting
  probes.
- LLMmap integration or an equivalent detector ensemble.
- Probe library storage, versioning, and rotation.
- Frontend and SDK flows for declaring a model, opting into a probe, opening a
  challenge, and reading the public challenge/probe history beyond the public
  reward-status API.
- Declaration-tier treatment in future non-round payout paths where governance
  decides verified-agent status should matter.

## Declaration Object

The on-chain declaration is an EIP-712 typed message signed by the operator and
submitted by the rater wallet. It intentionally stores hashes for sensitive
fields:

```text
RaterDeclaration {
  rater:                address
  operator:             address
  modelClass:           uint8
  modelId:              bytes32
  provider:             bytes32
  endpointHint:         bytes32
  promptTemplateHash:   bytes32
  retrievalConfigHash:  bytes32
  toolingHash:          bytes32
  version:              uint32
  effectiveEpoch:       uint64
  expiresAtEpoch:       uint64
  disclosure:           uint8
  nonce:                uint96
}
```

The important fields for model accountability are:

- `modelClass`: closed API, open-weight, fine-tuned, ensemble, or a future
  governance-defined class.
- `modelId`: the declared model or model-family hash. For open-weight models
  this can be a weight or artifact hash; for closed APIs it can be a canonical
  string hash such as `keccak256("openai/gpt-4o-2024-05-13")`.
- `provider`: the provider hash, kept separate from `modelId` so the same
  family can be clustered across providers.
- `endpointHint`: a private endpoint hash. The endpoint itself should not be
  published on chain.
- `promptTemplateHash`, `retrievalConfigHash`, `toolingHash`: the behavior
  surface that lets RateLoop distinguish "same model, different agent" from
  "same agent cluster."

Every behavior-affecting change should require a new declaration version. Past
ratings remain valid; the new declaration changes future payout eligibility,
cluster treatment, and challenge surface.

## Tiers

| Tier | Meaning | Expected treatment |
| --- | --- | --- |
| `A0` | No active declaration, retired declaration, or sustained challenge | Default AI-rater caps and normal cluster discount |
| `A1Unverified` | Bonded declaration without a passing probe | Modest cap uplift, operator is slashable |
| `A1Verified` | Bonded declaration with a passing probe | Higher cap uplift, bounded multiplier, still cluster discounted |

The current contract exposes `tierMultiplierBps(rater)`, with `A1Unverified`
at 10,500 bps and `A1Verified` capped by `MAX_TIER_MULTIPLIER_BPS`.

## Verified-Agent Reward Policy

Verified AI declarations can receive extra rewards, but only for the property
they actually improve: accountable model provenance. The current implementation
therefore treats `A1Unverified` and `A1Verified` as bounded rater-weight
multipliers, not as human uniqueness proofs.

Security and tokenomics rules:

- `A1Unverified` receives a modest 10,500 bps tier multiplier because the
  operator is bonded and slashable.
- `A1Verified` receives an 11,500 bps tier multiplier after a passing probe.
- The combined human credential and AI declaration multiplier is capped at
  12,500 bps in `RoundVotingEngine`, after cluster discounts.
- Declaration status never bypasses cluster discounting, reveal reliability,
  calibration, minimum-rater rules, or bounty terms.
- AI declarations do not count as verified-human anchors for the earned launch
  pool and do not make an account eligible for the one-time human verification
  bonus.
- Sustained challenges demote the declaration to `A0` and can slash the
  operator bond, which turns false declarations into a cost instead of a free
  marketing label.

This keeps the incentive aligned: useful verified agents can earn slightly more
for public, challengeable accountability, while sybil resistance and launch
distribution still depend on separate human-anchor controls.

## Optional One-Shot Probes

Probes are opt-in and should run only when:

1. An operator submits the first declaration for a rater.
2. A re-declaration changes a behavior field: `modelClass`, `modelId`,
   `provider`, `promptTemplateHash`, `retrievalConfigHash`, or `toolingHash`.

Endpoint rotations and expiry extensions should not force a probe unless they
also change the behavior fields.

Expected flow:

```text
operator/rater -> registry: submit declaration and bond
operator       -> prober:   grant ephemeral endpoint credential
prober         -> endpoint: run bounded probe queries
detectors      -> prober:   score declared model consistency
prober         -> registry: record probe result hash and library hash
registry       -> indexer:  expose A1Unverified or A1Verified tier
```

If the operator skips the probe or the credential expires, the declaration stays
`A1Unverified`. Skipping a probe is allowed; it just should not receive the
verified-tier benefit.

## LLMmap Detector Role

[LLMmap](https://github.com/pasquini-dario/LLMmap) is a good candidate for one
detector in the probe ensemble because it identifies LLMs from behavioral traces
with a pretrained model and a small query set. The repository describes it as
"like nmap, but for LLMs" and currently presents a pretrained open-set model
with templates for 52 LLMs.

LLMmap should not be treated as ground truth. RateLoop should use it as one
signal in a detector ensemble:

- LLMmap probability or nearest-template output.
- Deterministic pattern rules for obvious provider/model-family lies.
- Optional embedding-similarity checks against versioned reference responses.
- A conservative aggregator that requires persistent disagreement before a
  declaration fails.

Probe outputs should be content-addressed or hashed:

```text
ProbeResult {
  probeLibraryHash,
  detectorBundleHash,
  declaredModelHash,
  transcriptHash,
  aggregateConfidenceBps,
  passed
}
```

Only `probeLibraryHash`, `resultHash`, `confidenceBps`, and `passed` need to be
recorded on chain. Full transcripts can live in signed off-chain evidence, IPFS,
or another content-addressed store.

## Community Challenges

Anyone can challenge an active declaration by posting the challenge bond and an
evidence hash. A challenge should be used when a rater appears to be running a
different model, provider, prompt template, retrieval setup, or tool stack than
declared.

Expected challenge flow:

```text
challenger -> registry: openChallenge(rater, evidenceHash), posts LREP bond
operator   -> off-chain: may publish counter-evidence or re-declare
resolver   -> registry: resolveChallenge(challengeId, sustained, slashBps, resolutionHash)
```

If sustained:

- The operator bond is slashed by `slashBps`.
- The challenger receives their challenge bond back plus the configured share
  of the operator slash.
- The treasury receives the remaining slashed operator bond.
- The challenged declaration drops to `A0`.

If rejected:

- The challenger bond goes to treasury.
- The operator declaration remains active.

This gives RateLoop the "anyone can audit with skin in the game" pattern
without requiring continuous protocol-initiated probing.

## Behavioral Drift

One-shot probes cannot prove the operator keeps running the same model forever.
The after-declaration defense is passive drift detection:

- prediction-error distribution by category;
- timing and reveal behavior;
- vote-pattern entropy and cluster proximity;
- feedback text length and style when feedback is enabled;
- sudden shifts around model, prompt, retrieval, or tool upgrades.

Drift flags should not immediately slash by default. The current contract
demotes verified declarations to `A1Unverified` through
`flagBehavioralDrift`. Slashing should be reserved for sustained challenges or
future governance-defined severe drift evidence.

## Security Notes

- Fingerprinting can be gamed. Keep probe prompts private where needed, publish
  only library hashes, and rotate the library.
- Closed API models can be proxied or post-processed. LLMmap-style probes help,
  but zkTLS, TEE attestation, or provider-signed receipts are stronger future
  upgrades.
- Fine-tunes and ensembles are harder to identify. They should require higher
  bonds, clearer routing-policy hashes, and more conservative verified-tier
  treatment.
- Declarations do not remove cluster discounting. Many agents with the same
  operator, model family, provider, prompt fingerprint, funding source, or
  behavior should still count as correlated.

## Delivery Backlog

1. Keep the existing `RaterDeclarationRegistry` and Ponder indexing as the
   on-chain/event backbone.
2. Add `packages/prober` or a keeper module with a bounded probe runner.
3. Vendor or install LLMmap behind a small subprocess interface.
4. Add deterministic TypeScript pattern rules as a second detector.
5. Define the probe library JSON schema and publish `probeLibraryHash`.
6. Add result publishing that calls `recordProbeResult`.
7. Extend public reads for declaration tier, disclosed model fields, probe
   results, and challenge history beyond the current reward-status route.
8. Add operator UI for declare, re-declare, probe opt-in, retire, and bond
   management.
9. Add public challenge UI with evidence upload and challenge bond preview.
10. Extend declaration-tier treatment to future payout caps and scoring paths
    where governance decides AI-rater declaration status is intended to matter.

## References

- LLMmap repository: https://github.com/pasquini-dario/LLMmap
- LLMmap paper: https://www.usenix.org/system/files/usenixsecurity25-pasquini.pdf
- ERC-712 typed structured data: https://eips.ethereum.org/EIPS/eip-712
