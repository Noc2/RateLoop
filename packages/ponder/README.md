# RateLoop tokenless-v4 indexer

This package indexes only the greenfield `TokenlessPanel` and `CredentialIssuer` deployment. Removed protocol generations have no compatibility surface here.

## Deployment identity

Every row and database namespace is bound to:

```text
tokenless-v4:<chainId>:<panel>:<issuer>:<adapter-or-zero>:<feedbackBonus>
```

Startup fails if `RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY` conflicts with the configured addresses. A changed core, issuer, or adapter therefore gets a fresh index instead of silently mixing deployments.

Supported networks are local Hardhat/Anvil (`31337`) and the isolated Base Sepolia tokenless deployment (`84532`). Base mainnet and all legacy address bundles are intentionally rejected.

## Configuration

Copy `.env.example` to `.env.local` and set:

- `PONDER_TOKENLESS_PANEL_ADDRESS`
- `PONDER_CREDENTIAL_ISSUER_ADDRESS`
- `PONDER_X402_PANEL_SUBMITTER_ADDRESS` or the zero address
- `PONDER_TOKENLESS_START_BLOCK`
- `PONDER_RPC_URL_<chainId>`
- `CORS_ORIGIN`, and in production `PONDER_KEEPER_WORK_TOKEN`

Run `yarn codegen`, `yarn check-types`, and `yarn test` from this package. Production runs through `node scripts/start.mjs`, which derives a database schema from the stable deployment identity.

## Indexed evidence

- Round economic terms and deterministic lifecycle cursors.
- Public tlock ciphertext bytes and their signed hashes.
- Vote-key, nullifier, payout commitment, reveal, response hash, and accuracy score.
- Claim destination and amount. This deliberately reflects the v0 privacy limitation: a normal claim links the vote key to its payout destination.
- Issuer signer epochs, scheduled grace, and emergency rotations.

Round creation and commit handlers read the immutable contract record at the event block because the compact events do not repeat every term. A transient RPC failure fails the handler and is retried by Ponder; no partial default record is persisted.

## API

- `GET /deployment`
- `GET /status/tokenless`
- `GET /rounds`
- `GET /rounds/:roundId`
- `GET /rounds/:roundId/commits`
- `GET /rounds/:roundId/claims`
- `GET /issuer/epochs`
- `GET /keeper/work?now=<unix-seconds>&direction=<asc|desc>&cursor=<round-id>&limit=<1-500>`

`/keeper/work` filters due rows before applying a bounded page and returns `nextCursor` for keyset pagination. It emits
only event-derived permissionless panel actions: begin settlement, process aggregation, process scores, finalize, and
return stale shares. Reveal-window opening is deliberately absent because `openReveal` has no event and is unnecessary
for either reveal or settlement; the direct-chain keeper handles automatic reveal submission. The feed never asks a
keeper to publish a payout root or exercise an operator fund-control path.
