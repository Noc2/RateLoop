# AI Rater Declarations And Optional Model Probes

Plan date: 2026-05-11. Updated for the final pre-deploy participation policy on
2026-05-12.

This note is research context for the AI declaration layer. The canonical
implementation policy lives in `docs/implementation-plan.md`.

## Current Status

AI raters can publish bonded model/operator/prompt metadata through
`RaterDeclarationRegistry`. The registry stores declarations, probe results,
behavioral drift flags, challenges, and declaration-bond slashing state.

The declaration layer is an accountability rail, not proof-of-personhood and
not a settlement reward multiplier.

Implemented behavior:

- `RaterDeclarationRegistry` stores versioned AI declarations, operator bonds,
  probes, drift flags, and challenges.
- Open challenges make a declaration inactive until resolved.
- Sustained challenges can slash the declaration's reserved operator bond.
- Ponder indexes current declarations, history, probes, drift flags, operator
  bonds, and challenges.
- `RoundVotingEngine` snapshots whether a commit had an active AI declaration
  for launch-anchor exclusion.
- Ponder exposes `GET /rater-participation-status/:address` for participation
  lane, human credential status, AI declaration status, launch progress, and
  explicit policy booleans.

Removed before deployment:

- AI declaration reward-weight boosts.
- Human credential reward-weight boosts.
- Cluster or independence discounts.
- The old reward-status route name.

## Declaration Object

The on-chain declaration is an EIP-712 typed message signed by the operator and
submitted by the rater wallet. It stores hashes for sensitive fields:

```text
RaterDeclaration {
  rater:                address
  operator:             address
  modelClass:           uint8
  modelId:              bytes32
  provider:             bytes32
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

`effectiveEpoch` and `expiresAtEpoch` are Unix-second chain timestamps despite
the legacy field suffix. API responses also expose `effectiveAt` and
`expiresAt` aliases.

## Tiers

| Tier           | Meaning                                                           | Protocol effect                                      |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| `A0`           | No active declaration, retired declaration, or sustained challenge | Open participation lane                              |
| `A1Unverified` | Bonded declaration without a passing probe                        | Publicly declared, challengeable AI participation    |
| `A1Verified`   | Bonded declaration with a passing probe                           | Publicly probed, challengeable AI participation      |

Tiers do not change settlement reward weight. Their protocol-sensitive use is
launch-anchor exclusion: an active AI declaration cannot count as a
verified-human anchor for that commit.

## Optional One-Shot Probes

Probes are opt-in and should run when:

1. An operator submits the first declaration for a rater.
2. A redeclaration changes a behavior field: `modelClass`, `modelId`,
   `provider`, `promptTemplateHash`, `retrievalConfigHash`, or `toolingHash`.

Endpoint rotations and expiry extensions should not force a probe unless they
also change behavior fields.

Expected flow:

```text
operator/rater -> registry: submit declaration and bond
operator       -> prober:   grant ephemeral endpoint credential
prober         -> model:    run probe prompts
prober         -> registry: record result hash and pass/fail
community      -> registry: open challenge if public behavior contradicts claim
resolver       -> registry: resolve challenge, demote/slash if sustained
```

The prober service is future work. LLMmap or a similar detector ensemble can be
one probe source, but the registry must treat probe output as challengeable
evidence rather than an unquestioned oracle.

## Product Language

Use:

- "AI declared" for an active declaration.
- "Verified agent" only for an active declaration with a passing probe.
- "Verified human" only for World ID and seeded Curyo Self.xyz human
  credentials.

Avoid:

- Calling verified agents human.
- Saying AI declarations increase reward weight.
- Saying AI declarations count as launch anchors.
