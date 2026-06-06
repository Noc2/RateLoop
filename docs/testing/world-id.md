# World ID v4 Testing

RateLoop is v4-only for new deployments. Local tests use `MockWorldIDVerifier`;
World Chain deploys use the World ID v4 verifier proxy and never request or
submit deprecated proof formats.

Keep these values aligned across the deploy script, Next.js runtime, and World
Developer Portal:

- `NEXT_PUBLIC_WORLD_ID_APP_ID`
- `WORLD_ID_V4_RP_ID`
- `NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION` (`rateloop-human-credential-v1` by default)
- `NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION` (`rateloop-human-presence-v1` by default)
- `WORLD_ID_V4_ISSUER_SCHEMA_ID`
- `WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN` when using a deployment-specific lower bound

The frontend should request v4-only proofs with `allow_legacy_proofs=false`.
For bounty rechecks, it should request the selected credential kind with
`require_user_presence=true` against the short-lived presence action and submit the result to
`RaterRegistry.attestHumanPresenceWithV4Proof`. The current freshness window is
15 minutes.

## Credential Lanes

RateLoop bounty eligibility uses these encoded credential masks:

- `0`: everyone.
- `0x02`: Selfie Check / fresh liveness (v4 beta; hidden unless explicitly enabled).
- `0x04`: Passport / NFC document.
- `0x08`: Proof of Human.
- Credential bits can be ORed together; for example `0x0c` means Passport or Proof of Human.
- `0x80`: optional recent-recheck flag ORed into any non-open mask.

Proof of Human, Passport, and the v4 `face` credential lane map to these
on-chain credential kinds. Selfie Check remains feature-gated by default; enable
`NEXT_PUBLIC_WORLD_ID_ENABLE_V4_SELFIE=true` only after the deployed World app has
confirmed v4 `face` support.

## Deterministic Local Lane

Run the focused checks:

```sh
yarn world-id:test
```

That expands to:

```sh
yarn world-id:test:contracts
yarn world-id:test:next
```

The contract slice covers:

- storing a World ID v4 Proof of Human credential for `msg.sender`
- storing Passport/Selfie credential-kind rows where configured
- binding proof signals to the wallet address and credential kind
- rejecting reused credential nullifiers and exact presence proof replays
- recording fresh presence rechecks with a 15-minute `freshUntil`
- exposing commit-time credential and fresh-recheck masks for bounty qualification

The Next.js slice runs World ID API and client parsing tests under:

- `packages/nextjs/app/api/world-id`
- `packages/nextjs/lib/world-id`

For browser E2E against the deterministic local chain:

```sh
yarn chain
yarn deploy
yarn dev:stack
yarn world-id:e2e:local
```

Notes:

- `yarn deploy` on `localhost` deploys `MockWorldIDVerifier`.
- Local deterministic World ID E2E should not require `WORLD_ID_SIGNING_KEY` or
  the hosted simulator.
- Local mocks must emit parser-compatible World ID v4 results with `responses[i]`
  fields that map to `WorldIDVerifier.verify`.

## World Chain Sepolia Lane

Use this lane when you want a real IDKit staging request before production.

Create or update the Next.js local env:

```sh
cp packages/nextjs/.env.example packages/nextjs/.env.local
```

Set these values from the staging app/RP/action in the World Developer Portal:

```sh
NEXT_PUBLIC_TARGET_NETWORKS=4801
NEXT_PUBLIC_WORLD_ID_APP_ID=<staging app id>
NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION=rateloop-human-credential-v1
NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION=rateloop-human-presence-v1
NEXT_PUBLIC_WORLD_ID_ENVIRONMENT=staging
WORLD_ID_V4_RP_ID=<numeric rp id>
WORLD_ID_V4_ISSUER_SCHEMA_ID=<issuer schema id>
WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN=0
WORLD_ID_SIGNING_KEY=<staging request signing key>
NEXT_PUBLIC_PONDER_URL=<reachable Ponder URL for this deployment>
```

Add `NEXT_PUBLIC_WORLD_ID_ENABLE_V4_SELFIE=true` only for staging apps where v4
Selfie Check has been confirmed.

Optional RPC overrides:

```sh
NEXT_PUBLIC_RPC_URL_4801=<browser RPC URL>
WORLDCHAIN_SEPOLIA_RPC_URL=<deploy RPC URL>
```

Deploy contracts to World Chain Sepolia:

```sh
yarn deploy --network worldchainSepolia --keystore <foundry keystore name>
```

The deploy script uses the World ID v4 verifier proxy for World Chain networks
and stores the numeric RP ID, credential action hash, presence action hash,
issuer schema ID, and credential genesis lower bound in `RaterRegistry`.

Start the app with the Sepolia env above:

```sh
yarn start
```

Open `/settings#identity`, connect a wallet on World Chain Sepolia, and request
Proof of Human or Passport. The app fetches RP context from:

```text
/api/world-id/rp-context
```

Expected results:

- a successful credential transaction calls `RaterRegistry.attestHumanCredentialWithV4Proof`
- a recheck transaction calls `RaterRegistry.attestHumanPresenceWithV4Proof`
- Ponder `/rater-participation-status/:address` shows the relevant credential
  kind plus `fresh` recheck status until `freshUntil`
- repeated attempts with the same nullifier fail

## Troubleshooting

- `World ID is not configured for this deployment.` means the app ID, RP ID, or
  signing key is missing at runtime.
- `invalid_rp_signature` usually means `WORLD_ID_SIGNING_KEY`,
  `WORLD_ID_V4_RP_ID`, or `NEXT_PUBLIC_WORLD_ID_ENVIRONMENT` does not match the
  staging app.
- `World ID action does not match this deployment.` means the IDKit result action
  differs from `NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION` or
  `NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION`.
- `World ID proof is not bound to the connected wallet.` means the proof signal
  was generated for a different wallet address than the transaction sender.
- A contract revert from `WorldIDVerifier` usually means the RP ID, action,
  nonce, signal hash, issuer schema ID, credential genesis lower bound, expiry,
  or proof array differs from the deployed `RaterRegistry` configuration.

References:

- [World ID credentials](https://docs.world.org/world-id/idkit/credentials)
- [World ID on-chain verification](https://docs.world.org/world-id/idkit/onchain-verification)
- [World ID 4.0 migration](https://docs.world.org/world-id/4-0-migration)
