# World ID v4 Backend Issuer Production Rollout

This runbook deploys and activates `WorldIdV4BackendIssuer` on Base mainnet without running the full production `Deploy.s.sol`. Activation is one Governor proposal with three ordered calls that execute atomically through the timelock:

1. `RaterRegistryProxyAdmin.upgradeAndCall(RaterRegistry, newImplementation, "")`
2. `RaterRegistry.grantRole(SEEDER_ROLE, issuer)`
3. `WorldIdV4BackendIssuer.setIssuanceCap(activationCap)`

The deployment script leaves the issuer at `issuanceCap = 0`. Deployment alone cannot issue credentials.

## Fixed production addresses

| Contract | Base address |
| --- | --- |
| RaterRegistry proxy | `0x0Cc33Cef83e2D83C7Ac572a047164a1f43a4CC8e` |
| RaterRegistry ProxyAdmin | `0x77a93e251DeA0E5839717D247e7eE76Cd5439a52` |
| RateLoopGovernor | `0x62d19915041d93595EB149B4c8711D6a4c6ce087` |
| TimelockController | `0xE40055A0056425b4Ae6fd990474F070d9c3414a5` |

Both scripts reject any chain other than Base `8453`, a non-production profile, missing known-address bytecode, or a ProxyAdmin not owned by the timelock.

## 1. Preflight

Run from `packages/foundry` with a production Base RPC and Foundry keystore account:

```bash
export RATELOOP_DEPLOYMENT_PROFILE=production
export BASE_RPC_URL='https://...'
export FOUNDRY_ACCOUNT='<keystore-name>'
export WORLD_ID_V4_BACKEND_SIGNER='0x...'
export WORLD_ID_V4_RP_ID='<numeric uint64 RP id>'
export WORLD_ID_V4_ACTION='<numeric uint256 action>'
export WORLD_ID_V4_MAX_CREDENTIAL_TTL=604800

cast chain-id --rpc-url "$BASE_RPC_URL"
cast code 0x0Cc33Cef83e2D83C7Ac572a047164a1f43a4CC8e --rpc-url "$BASE_RPC_URL"
cast call 0x77a93e251DeA0E5839717D247e7eE76Cd5439a52 'owner()(address)' --rpc-url "$BASE_RPC_URL"
cast storage 0x0Cc33Cef83e2D83C7Ac572a047164a1f43a4CC8e \
  0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc \
  --rpc-url "$BASE_RPC_URL"
forge test --offline --match-path test/WorldIdV4BackendIssuerRollout.t.sol
make check-storage-layouts
make check-contract-sizes DEPLOY_PROFILE=deploy
```

Record the implementation address returned by `cast storage`; it is the rollback implementation. Stop if the chain is not `8453`, ProxyAdmin owner is not the fixed timelock, the implementation slot is zero, the signer is zero, the RP ID is not a nonzero `uint64`, the action is zero, or the TTL is above 604800 seconds.

## 2. Deploy disabled contracts

Simulate first. This is the narrow rollout script, not `Deploy.s.sol`:

```bash
forge script script/DeployWorldIdV4BackendIssuer.s.sol:DeployWorldIdV4BackendIssuerScript \
  --rpc-url "$BASE_RPC_URL" --account "$FOUNDRY_ACCOUNT" -vvvv
```

After reviewing the two CREATE transactions, broadcast and verify:

```bash
forge script script/DeployWorldIdV4BackendIssuer.s.sol:DeployWorldIdV4BackendIssuerScript \
  --rpc-url "$BASE_RPC_URL" --account "$FOUNDRY_ACCOUNT" \
  --broadcast --verify --etherscan-api-key "$BASESCAN_API_KEY" -vvvv
```

Set the emitted addresses only after receipts are confirmed:

```bash
export WORLD_ID_V4_RATER_REGISTRY_IMPLEMENTATION='0x...'
export WORLD_ID_V4_BACKEND_ISSUER='0x...'

cast code "$WORLD_ID_V4_RATER_REGISTRY_IMPLEMENTATION" --rpc-url "$BASE_RPC_URL"
cast code "$WORLD_ID_V4_BACKEND_ISSUER" --rpc-url "$BASE_RPC_URL"
cast call "$WORLD_ID_V4_BACKEND_ISSUER" 'issuanceCap()(uint256)' --rpc-url "$BASE_RPC_URL"
cast call "$WORLD_ID_V4_BACKEND_ISSUER" 'issuedCount()(uint256)' --rpc-url "$BASE_RPC_URL"
cast call "$WORLD_ID_V4_BACKEND_ISSUER" 'registry()(address)' --rpc-url "$BASE_RPC_URL"
cast call "$WORLD_ID_V4_BACKEND_ISSUER" 'rpId()(uint64)' --rpc-url "$BASE_RPC_URL"
cast call "$WORLD_ID_V4_BACKEND_ISSUER" 'action()(uint256)' --rpc-url "$BASE_RPC_URL"
cast call "$WORLD_ID_V4_BACKEND_ISSUER" 'maxCredentialTtl()(uint64)' --rpc-url "$BASE_RPC_URL"
```

Both counters must be zero, and the issuer domain must exactly match the intended proxy, numeric RP ID, action, and TTL. Do not add either address to `deployments/8453.json` until this deployment has actually succeeded.

## 3. Propose atomic activation

The activation cap must be nonzero and no more than `10,000`. Start materially below the maximum for the first canary. The helper appends the mandatory exact `#proposer=0x...` suffix to the description.

```bash
export WORLD_ID_V4_ACTIVATION_CAP=100
export WORLD_ID_V4_PROPOSER='0x...'
export WORLD_ID_V4_PROPOSAL_DESCRIPTION='Activate World ID v4 backend issuer'

forge script script/ProposeWorldIdV4BackendIssuerRollout.s.sol:ProposeWorldIdV4BackendIssuerRolloutScript \
  --rpc-url "$BASE_RPC_URL" --account "$FOUNDRY_ACCOUNT" -vvvv
```

Before broadcast, decode all three calls and confirm their order, zero ETH values, the new implementation, issuer, cap, and final proposer suffix. Then submit only the Governor proposal:

```bash
forge script script/ProposeWorldIdV4BackendIssuerRollout.s.sol:ProposeWorldIdV4BackendIssuerRolloutScript \
  --rpc-url "$BASE_RPC_URL" --account "$FOUNDRY_ACCOUNT" --broadcast -vvvv
```

Record the proposal ID. Follow the normal vote, queue, and two-day timelock lifecycle. Do not issue credentials until execution verification is green.

## 4. Publish rollout metadata

Only after deployment and proposal execution, add the two actual addresses and rollout facts to `deployments/8453.json`:

```json
{
  "0x<actual-new-implementation>": "RaterRegistryImplementation",
  "0x<actual-issuer>": "WorldIdV4BackendIssuer",
  "worldIdV4BackendIssuerRollout": {
    "signer": "0x<actual-signer>",
    "rpId": "<decimal uint64>",
    "action": "<decimal-or-0x uint256>",
    "maxCredentialTtl": 604800,
    "issuanceCap": 100,
    "proposalId": "<proposal-id>",
    "activationBlockNumber": 0
  }
}
```

Replace every example value with receipt-derived data, including a positive activation block. Never commit the example object or placeholder addresses. Then run:

```bash
make generate-abis-only
cd ../..
yarn base:check
BASE_RPC_URL="$BASE_RPC_URL" yarn base:check --live
```

## 5. Post-execution gates

All must pass before the backend signer is allowed to serve issuance requests:

```bash
cast storage 0x0Cc33Cef83e2D83C7Ac572a047164a1f43a4CC8e \
  0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc \
  --rpc-url "$BASE_RPC_URL"
cast call 0x0Cc33Cef83e2D83C7Ac572a047164a1f43a4CC8e \
  'hasRole(bytes32,address)(bool)' "$(cast keccak SEEDER_ROLE)" "$WORLD_ID_V4_BACKEND_ISSUER" \
  --rpc-url "$BASE_RPC_URL"
cast call "$WORLD_ID_V4_BACKEND_ISSUER" 'issuanceCap()(uint256)' --rpc-url "$BASE_RPC_URL"
cast call "$WORLD_ID_V4_BACKEND_ISSUER" 'issuedCount()(uint256)' --rpc-url "$BASE_RPC_URL"
```

The implementation slot must equal the new implementation, the issuer must hold `SEEDER_ROLE`, `issuanceCap` must equal the approved activation cap, and `issuedCount` must still be zero. `yarn base:check --live` additionally verifies bytecode selectors, implementation, role, immutable domain, signer, TTL, and cap from published metadata.

## Rollback

Before proposal execution, cancel the proposal or let it expire; the issuer remains disabled at cap zero and has no registry role.

After execution but before any issuance, submit an emergency atomic governance proposal in this order:

1. `issuer.setIssuanceCap(0)`
2. `RaterRegistry.revokeRole(SEEDER_ROLE, issuer)`
3. `RaterRegistryProxyAdmin.upgradeAndCall(RaterRegistry, recordedOldImplementation, "")`

After issuance has begun, use the same sequence and add `issuer.pause()` immediately after setting cap zero. Already-recorded credentials remain in proxy storage; rollback prevents new backend issuance but does not erase or revoke existing credentials. Handle any credential revocations through the registry's governed revocation path and reconcile `issuedCount`, nullifiers, and backend audit evidence before considering reactivation.
