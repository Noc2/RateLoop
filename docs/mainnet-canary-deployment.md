# Mainnet Canary Deployment Plan

This runbook describes a one-time World Chain mainnet canary that reuses the
same Vercel and Railway services, then resets those services for the real
production mainnet launch.

The short rule is: the services can be reused, but canary state must not be.
Vercel and Railway deployments will pick up new environment variables and new
`@rateloop/contracts` artifacts after a rebuild. Ponder will also point at new
contract addresses after a redeploy. Existing databases, Ponder checkpoints,
keeper state, and artifact storage do not reset automatically.

## Current Constraint

The normal World Chain mainnet deploy path always uses the bundled production
World ID v4 verifier:

```text
0x00000000009E00F9FE82CfeeBB4556686da094d7
```

Mainnet rejects `WORLD_ID_V4_VERIFIER_ADDRESS` overrides unless the override
matches the selected deploy mode. A canary that uses the World ID staging
verifier on chain `480` must use the explicit staging canary deploy flag. The
staging verifier is:

```text
0x703a6316c975DEabF30b637c155edD53e24657DB
```

Do not reuse a staging-verifier canary contract as production. Deploy fresh
production contracts once canary testing is finished.

### World ID ABI Launch Gate

The production cutover must verify more than address bytecode. Before treating
World ID as an enforced production credential, confirm the final World ID v4
verifier ABI matches the `IWorldIDVerifier` interface compiled into
`RaterRegistry`, run a live integration test against the production verifier
address, and redeploy contracts if the final selector, argument order, proof
shape, or revert/return behavior differs. `WORLD_ID_V4_VERIFIER_ADDRESS` only
changes the verifier address; it cannot patch a deployed ABI mismatch.

## Deployment Model

Use the same hosted services only because the canary is temporary and does not
need to run at the same time as production.

- Same Vercel project is acceptable.
- Same Railway services are acceptable.
- Same public domains are acceptable only during a planned maintenance/private
  testing window.
- Same databases or Ponder schema are not acceptable unless they are wiped
  before production.
- Same keeper/correlation artifact volume is acceptable only if the canary files
  are cleared or production uses a different directory/prefix.

The unsafe state to avoid is a mixed deployment, for example the web app pointing
at production contracts while Ponder or the keeper still has canary data.

## Phase 1: Prepare The Canary Branch

1. Create a canary branch from current `main`.
2. Keep the generated chain `480` deployment artifacts canary-only on this branch
   until the final production deployment replaces them.
3. Confirm Vercel/Railway staging World ID values are ready before deploy. The
   deploy command can select the staging verifier, but it cannot infer the World
   Developer Portal app, RP, issuer schema, or signing key values.

## Phase 2: Deploy Canary Contracts

Use World Chain mainnet, but World ID staging credentials.

Contract deploy environment:

```sh
WORLDCHAIN_RPC_URL=<mainnet rpc>
NEXT_PUBLIC_WORLD_ID_APP_ID=<staging World app id>
NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION=rateloop-human-credential-v1
NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION=rateloop-human-presence-v1
WORLD_ID_V4_RP_ID=<staging numeric on-chain rp id>
WORLD_ID_V4_ISSUER_SCHEMA_ID=<staging issuer schema id>
WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN=0
```

Deploy:

```sh
yarn deploy --network worldchain --world-id-staging-canary --keystore <foundry keystore name>
```

The deploy wrapper automatically sets:

```sh
RATELOOP_MAINNET_CANARY=true
RATELOOP_DEPLOYMENT_PROFILE=mainnet-canary
WORLD_ID_V4_VERIFIER_ADDRESS=0x703a6316c975DEabF30b637c155edD53e24657DB
```

After deployment, confirm the generated chain `480` artifacts contain the canary
contract addresses, deployed start blocks, and `deploymentProfile` set to
`mainnet-canary`.

Run the offline readiness check:

```sh
yarn worldchain:check --canary
```

## Phase 3: Point Hosted Services At Canary

Deploy the same Vercel/Railway services from the canary commit and set the
runtime variables below.

### Vercel / Next.js

```sh
NEXT_PUBLIC_TARGET_NETWORKS=480
NEXT_PUBLIC_RPC_URL_480=<browser-safe mainnet rpc>
NEXT_PUBLIC_PONDER_URL=https://<ponder-domain>
DATABASE_URL=<canary app database or wipeable canary schema>
APP_URL=https://<app-domain>
NEXT_PUBLIC_APP_URL=https://<app-domain>

NEXT_PUBLIC_WORLD_ID_ENVIRONMENT=staging
NEXT_PUBLIC_WORLD_ID_APP_ID=<staging World app id>
NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION=rateloop-human-credential-v1
NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION=rateloop-human-presence-v1
WORLD_ID_RP_ID=<staging rp_... id>
WORLD_ID_SIGNING_KEY=<staging request signing key>
```

Notes:

- `WORLD_ID_RP_ID` is the public `rp_...` IDKit relying-party ID.
- `WORLD_ID_V4_RP_ID` is numeric for contract deploys. Do not use the `app_...`
  app ID as either RP value.
- Public `NEXT_PUBLIC_*` values require a Vercel rebuild.

### Railway / Ponder

```sh
NODE_ENV=production
PONDER_NETWORK=worldchain
PONDER_RPC_URL_480=<mainnet rpc>
DATABASE_URL=<Postgres url>
CORS_ORIGIN=https://<app-domain>
RATE_LIMIT_TRUSTED_IP_HEADERS=x-forwarded-for
```

If the keeper publishes file-backed correlation artifacts, also set:

```sh
PAYOUT_ARTIFACT_HTTPS_ALLOWLIST=https://<keeper-domain>/correlation-artifacts
```

Ponder reads live-chain contract addresses from `@rateloop/contracts`, but its
database tables and checkpoints persist. On Railway, leave
`RATELOOP_PONDER_DATABASE_SCHEMA` unset so `yarn ponder:start` can use the
Railway deployment-scoped schema and avoid reusing schema metadata from an older
Ponder app build. If Railway logs `Schema '<name>' was previously used by a
different Ponder app`, unset the static schema override or switch it to a fresh,
never-used schema before redeploying. Reusing
`rateloop_ponder_worldchain_canary` across canary builds can trigger that startup
failure after the Ponder app signature changes.

### Railway / Keeper

```sh
NODE_ENV=production
CHAIN_ID=480
RPC_URL=<mainnet rpc>
PONDER_BASE_URL=https://<ponder-domain>
KEYSTORE_ACCOUNT=<canary keeper keystore>
KEYSTORE_PASSWORD=<canary keeper password>
KEEPER_DATABASE_URL=<canary keeper database or wipeable schema>
```

If testing correlation payouts:

```sh
KEEPER_CORRELATION_SNAPSHOTS_ENABLED=true
KEEPER_CORRELATION_SNAPSHOTS_MODE=auto
KEEPER_CORRELATION_ARTIFACT_STORAGE=file
KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR=<persistent canary directory>
KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL=https://<keeper-domain>/correlation-artifacts
```

Prefer separate canary wallets/keystores with limited funding.

## Phase 4: Canary Verification

Run canary tests with small real mainnet value.

- Confirm every canary contract address has bytecode on chain `480`.
- Confirm `RaterRegistry` points at
  `0x703a6316c975DEabF30b637c155edD53e24657DB`.
- Confirm the app is built with `NEXT_PUBLIC_TARGET_NETWORKS=480`.
- Confirm World ID requests use `NEXT_PUBLIC_WORLD_ID_ENVIRONMENT=staging`.
- Confirm Ponder `/status` is indexed past the canary deployment block.
- Create one minimal ask.
- Submit a World ID staging credential.
- Commit/reveal/settle a minimal round.
- Confirm Ponder serves the ask, votes, and settlement result.
- If enabled, confirm keeper settlement and correlation artifact publication.

## Phase 5: Production Cutover

Treat cutover as a maintenance window.

1. Stop or pause public access to the Vercel app.
2. Stop the keeper so it cannot act against a half-updated environment.
3. Stop Ponder or leave it isolated from public consumers.
4. Deploy fresh production contracts from a clean production branch.
5. Do not set `RATELOOP_MAINNET_CANARY`.
6. Do not set the staging verifier override.
7. Use production World ID values:

   ```sh
   NEXT_PUBLIC_WORLD_ID_APP_ID=<production World app id>
   NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION=rateloop-human-credential-v1
   NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION=rateloop-human-presence-v1
   WORLD_ID_V4_RP_ID=<production numeric on-chain rp id>
   WORLD_ID_V4_ISSUER_SCHEMA_ID=<production issuer schema id>
   WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN=<production lower bound>
   ```

8. Replace the generated chain `480` artifacts with production addresses and
   deployed start blocks. The production deploy should stamp
   `deploymentProfile: "production"`.
9. Rebuild and redeploy Vercel/Railway from the production commit.
10. Reset persistent state:
    - App database: switch to a fresh production database/schema or wipe the
      canary database.
    - Ponder database: switch to `rateloop_ponder_worldchain` or another fresh
      production schema. Do not reuse `rateloop_ponder_worldchain_canary`.
    - Keeper database/cache: switch to a fresh production database/schema or wipe
      canary rows.
    - Correlation artifacts: clear the canary directory/prefix or switch to a
      production directory/prefix.
    - Blob/uploads: clean if desired; at minimum ensure production app rows do
      not reference canary-only uploads.
11. Start Ponder first and wait for `/status` to catch up past the production
    deployment block.
12. Start the keeper.
13. Re-enable the web app.

Before re-enabling public traffic, run:

```sh
yarn worldchain:check --production
```

When live URLs are configured:

```sh
WORLDCHAIN_RPC_URL=https://... \
WORLDCHAIN_PONDER_URL=https://... \
WORLDCHAIN_APP_URL=https://... \
yarn worldchain:check --production --live --require-live-targets
```

## Phase 6: Production Verification

- Confirm `RaterRegistry` points at the production verifier:

  ```text
  0x00000000009E00F9FE82CfeeBB4556686da094d7
  ```

- Confirm `NEXT_PUBLIC_WORLD_ID_ENVIRONMENT=production`.
- Confirm the World ID app ID, public `rp_...` ID, numeric RP ID, issuer schema,
  and signing key all come from the production World Developer Portal app.
- Confirm Ponder `/status` is indexed past the production deployment block.
- Confirm the app reads production chain `480` contract addresses.
- Create one minimal production ask and verify it flows through app, contracts,
  Ponder, and keeper.

## Preparation Work Available Now

Before the actual canary window, the repo can be prepared with:

- a dry run of the guarded `--world-id-staging-canary` deploy command against a
  mainnet fork, once RPC credentials are ready;
- a Vercel/Railway environment inventory checklist;
- reset scripts or SQL snippets for app, Ponder, and keeper state;
- a post-deploy verifier script that checks bytecode, verifier address, Ponder
  status, and frontend public configuration.

## Voting Engine Rotation

Rotating `ContentRegistry.setVotingEngine` alone is not sufficient for a live
deployment. Escrows pin the engine at initialization and reject new work with
`"Stale engine"` until the full replacement stack is deployed and rewired:

- `QuestionRewardPoolEscrow`
- `FeedbackBonusEscrow`
- `FeedbackRegistry` (engine is set only in `initialize`; there is no governed
  `setVotingEngine`)
- `FrontendRegistry` (a new engine clears the active `feeCreditor` until it is
  re-bound)

Treat voting-engine replacement as a coordinated governance runbook, not a
single timelock action. The Foundry escrow tests document the required
full-stack replacement sequence.
