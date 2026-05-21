# RateLoop testnet-readiness audit — 2026-05-21

Repo-wide audit of `main` (HEAD `61679861`, post-PR-#22 merge) on branch `claude-testnet-readiness`. Goal: identify everything that would block or degrade a clean **World Chain Sepolia (chainId 4801)** deployment.

**Method.** Six parallel scope-focused agents — contracts + deploy, frontend regressions, legacy-claim flow, testnet config + ABIs + indexer, E2E flake + test infra, plus one web-research agent for 2025–2026 OP-stack / World Chain testnet pitfalls. Every finding was manually re-read against current source before inclusion; agent claims that didn't survive verification are recorded under "False positives" so a future pass doesn't re-flag the same paths.

The post-PR-22 merge brought ~46 commits onto main — most notably the **complete removal of ParticipationPool** (contract, ABI, indexer, UI flows, hooks, tests) and the **addition of a hidden legacy-claim flow** (contract vesting rail, page, hook, API route, manifest). Both are major surfaces and dominated the findings.

## Summary

| Severity | Count |
|---|---|
| Critical (must fix before testnet deploy) | 3 |
| High | 6 |
| Medium | 6 |
| Low / Informational (incl. positive verifications) | 9 |
| Verified false-positives recorded | 2 |

**Top-3 blocking items:**
1. **DRAND-1** — `ProtocolConfig.drandChainHash` is hardcoded to the *mainnet* `quicknet` chain hash. Tlock signatures on World Chain Sepolia must be verified against the *testnet* `quicknet-t` hash. Without a `setDrandConfig(...)` call right after deploy, every reveal will fail.
2. **CLAIM-1** — `lib/legacy-claim/manifest.ts` ships with an empty `entries: []` and `merkleRoot: null`. The on-chain `setLegacyContributorRoot(...)` is also unset on testnet. Until both are populated, every user lands on "Legacy claim root pending" — the feature is non-functional on day one.
3. **DEPLOY-1** — No `4801.json` deployment artifact exists in `packages/foundry/deployments/`. The frontend, Ponder, and keeper all key off this file. Booting any of them against chainId 4801 today throws "Missing deployed contract definitions for chain IDs: 4801" or the equivalent.

---

## Critical findings

### DRAND-1 — `drandChainHash` defaults to mainnet `quicknet`; testnet needs `quicknet-t`

**Severity:** Critical (blocks every reveal on testnet)

**Files / lines:** `packages/foundry/contracts/ProtocolConfig.sol:154-156`:
```
drandChainHash = 0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971; // mainnet `quicknet`
drandGenesisTime = 1_692_803_367;
drandPeriod = 3;
```

**Cross-cutting verification.** The research agent independently surfaced the same hash collision: drand operates **two production chains** today — `quicknet` (mainnet G1, hash `52db9b…e971`) and `quicknet-t` (testnet G1, hash `f3827d772c155f95a9fda8901ddd59591a082df5ac6efe3a479ddb1f5eeb202c`). Encrypting with one chain's public key and verifying against the other silently fails. The repo's tlock client (`packages/keeper/src/...` + frontend equivalents) reads the chain hash from `ProtocolConfig`, so the contract is the load-bearing piece.

**Symptom on testnet.** Every commit-reveal cycle will hit `_validateTlockReveal` and revert (signature does not validate against the wrong chain's public key). Voters cannot reveal, stakes forfeited to treasury, rounds deadlock at threshold. The keeper will retry and report `keeper_decrypt_failures_total++` on every iteration.

**Fix.** Two options:
- **(Preferred, surgical)** in `Deploy.s.sol`, immediately after the `ProtocolConfig` proxy is initialized (around `Deploy.s.sol:130-133`), branch on `block.chainid` and call `protocolConfig.setDrandConfig(...)` with the testnet chain hash, testnet genesis time, and testnet period. Source values from a constant or env-driven helper (`_resolveTestnetDrandConfig()` in `DeployHelpers.s.sol`).
- **(Wider)** change `ProtocolConfig.initialize` to take drand config as a parameter, so every chain gets its values explicitly at deploy time and there is no implicit mainnet bias.

Document the testnet drand chain in `packages/foundry/.env.example` and the keeper / frontend tlock client configuration too, otherwise the off-chain encrypter and the on-chain verifier will drift.

**Sources.** [drand quicknet announcement](https://docs.drand.love/blog/2023/10/16/quicknet-is-live/), [fastnet sunset / RFC 9380 compliance note](https://docs.drand.love/blog/2023/07/03/fastnet-sunset-quicknet-new/).

---

### CLAIM-1 — Legacy-claim manifest is empty; feature is dead on arrival

**Severity:** Critical (feature unusable on day one)

**Files / lines:** `packages/nextjs/lib/legacy-claim/manifest.ts:14-19`:
```ts
export const legacyClaimManifest: LegacyClaimManifest = {
  merkleRoot: null,
  allocationTotal: "0",
  generatedAt: null,
  entries: [],
};
```

**Symptom on testnet.** Every wallet hitting `/claim/legacy` sees "Legacy claim root pending" regardless of eligibility. The `setLegacyContributorRoot(...)` on the on-chain `LaunchDistributionPool` is also unset, so even if the manifest were populated, `claimLegacyContributorAllocation(...)` would revert.

**Fix.** Before the first testnet-with-legacy-claim deploy:
1. Generate the merkle tree off-chain from the actual legacy-contributor list. Encode each entry as `keccak256(abi.encodePacked(address, allocation))` (verify the leaf format against `LaunchDistributionPool.claimLegacyContributorAllocation` — read `bdfd4702`'s diff for the canonical layout).
2. Populate `legacyClaimManifest` with the resulting `{merkleRoot, allocationTotal, generatedAt, entries[]}`. Commit and deploy the frontend.
3. Call `launchDistributionPool.setLegacyContributorRoot(merkleRoot, allocationTotal)` on testnet. Verify allocation matches manifest total.
4. Smoke-test one eligible address end-to-end: lookup → page render → claim → tx receipt → second visit shows "claimed" state.

A follow-up improvement would be to fetch the manifest from a build-time API endpoint instead of committing it (large manifests in source bloat the bundle); not blocking for the first testnet drop.

---

### DEPLOY-1 — Only `31337.json` deployment artifact exists; testnet bootstrapping is blocked until `yarn deploy --network worldchainSepolia` runs

**Severity:** Critical (blocks every downstream service)

**Files / lines:** `packages/foundry/deployments/` contains only `31337.json` (verified). The frontend's `utils/env/public.ts:80-95`, Ponder's `ponder.config.ts:179-180,207-209`, the keeper's `config.ts:300`, and the SDK all key off shared deployment metadata that gets emitted by `Deploy.s.sol` per-chain.

**Symptom on testnet.** Booting any of those services against chainId 4801 throws "Missing deployed contract definitions for chain IDs: 4801" (frontend) or the equivalent shape elsewhere. Cannot run Ponder, cannot build the Next.js production bundle (unless `NEXT_PUBLIC_ALLOW_UNDEPLOYED_TARGET_NETWORKS=true`, which is an escape hatch, not a fix).

**Fix.** Run `DEPLOY_TARGET_NETWORK=worldchainSepolia yarn deploy` once a deployer keystore is ready and `WORLDCHAIN_SEPOLIA_RPC_URL` is set. The deploy script auto-emits `packages/foundry/deployments/4801.json` and updates `packages/contracts/src/deployedContracts.ts`. Commit both artifacts. Repeat for mainnet (chainId 480) when ready.

Pair this with the **DRAND-1 fix** above and the **WORLDID-1 verification** below — they need to land in the same deploy or the script will produce a 4801.json that bakes in the wrong drand chain.

---

## High findings

### STALE-1 — `packages/foundry/deployments/31337.json` still references the deleted `ParticipationPool`

**Severity:** High (confuses local-dev tooling; can corrupt SDK reads)

**Files / lines:** `packages/foundry/deployments/31337.json` contains `"0x8B03e92900E9d2251a93e6640A79353E3e10Df1C": "ParticipationPool"` even though the contract was removed in `9da0ecf5`. The address holds whatever happened to be there from the previous Anvil deploy — calling it would revert or worse, return garbage data.

**Fix.** Re-run `yarn deploy --network localhost` to regenerate `31337.json` cleanly. Add a CI check that grep-asserts the deployment file contains no entry whose name is not present in `packages/foundry/contracts/`.

### STALE-2 — `packages/ponder/.env.example:20,36` still document `PONDER_PARTICIPATION_POOL_ADDRESS` / `_START_BLOCK`

**Severity:** High (operator copy-paste lands on dead vars)

**Files / lines:** `packages/ponder/.env.example:20`, `:36`. `ponder.config.ts` doesn't read either variable any more (verified via grep).

**Fix.** Delete both lines from `packages/ponder/.env.example`. Same cleanup applies to `scripts/dev-stack.mjs` — the agent flagged a `PONDER_PARTICIPATION_POOL_ADDRESS` entry in the `ponderLocalDeploymentEnvKeys` array that should be removed.

### CLAIM-2 — `/api/legacy-claim/[address]` has no rate limiting; address enumeration is trivial

**Severity:** High (information disclosure once manifest is populated)

**Files / lines:** `packages/nextjs/app/api/legacy-claim/[address]/route.ts:1-17` (verified):
```ts
export async function GET(_request: NextRequest, context: ...) {
  const { address } = await context.params;
  const result = lookupLegacyClaim(address);
  if (!result) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
```
No `checkRateLimit` call, no auth gate. Eligible addresses return `{status: "eligible", allocation, proof}`; ineligible return `{status: "not_eligible"}` — distinguishable by an attacker.

**Symptom on testnet (once manifest populated).** An attacker can brute-force the address space (or the public lists of known wallets) and enumerate the entire eligible set + each allocation. The eligible-set is privacy-sensitive (it identifies legacy contributors).

**Fix.** Add `checkRateLimit(request, { limit: 10, windowMs: 60_000 })` keyed by IP. Or, better: require a signed challenge (SIWE) tied to the queried address before returning the proof, so only the eligible wallet can fetch its own proof.

### CLAIM-3 — `useLegacyClaim` hook doesn't enforce the wallet is on a supported chain

**Severity:** High (UX: silent failure)

**Files / lines:** `packages/nextjs/hooks/useLegacyClaim.ts:17-112` — no `useTargetNetwork()` / `useChainId()` check. If a user connects on chainId 11155111 (Ethereum Sepolia) or 1 (mainnet), `useScaffoldReadContract` returns `undefined` and the page stalls on "Loading…" forever with no actionable error.

**Fix.** Inside the hook, read the connected chain, compare to the supported deployments (currently `[480, 4801, 31337]`), and surface `error: "Please switch to <network name>"` for mismatches. The same pattern is used elsewhere (`useRateLoopSwitchNetwork`) — wire it in.

### DEPLOY-2 — Keeper `.env.example` doesn't document `METRICS_AUTH_TOKEN` or guide `CHAIN_ID`

**Severity:** High (security regression + common operator error)

**Files / lines:** `packages/keeper/.env.example` — no `METRICS_AUTH_TOKEN` entry; `CHAIN_ID=` is documented as blank with no list of supported values.

**Context.** The KEEPER-2 fix from the prior PR (`8e0e6f57`) made `startMetricsServer` *refuse* to bind to a non-loopback address without a token. If an operator sets `METRICS_BIND_ADDRESS=0.0.0.0` (a normal Docker pattern) without setting `METRICS_AUTH_TOKEN`, the keeper now refuses to start — which is the right outcome — but the operator won't know what to set unless `.env.example` mentions it.

**Fix.** Add to `packages/keeper/.env.example`:
```
# Required when METRICS_BIND_ADDRESS is non-loopback (>=16 chars, opaque random).
METRICS_AUTH_TOKEN=

# Supported: 31337 (Hardhat local), 4801 (World Chain Sepolia), 480 (World Chain mainnet).
CHAIN_ID=
```

### DEPLOY-3 — `packages/ponder/.env.example` has blank `PONDER_RPC_URL_4801` / `PONDER_RPC_URL_480` with no hint

**Severity:** High (Ponder won't boot on testnet)

**Files / lines:** `packages/ponder/.env.example:8-10`:
```
PONDER_RPC_URL_31337=http://127.0.0.1:8545
PONDER_RPC_URL_4801=
PONDER_RPC_URL_480=
```

**Symptom on testnet.** Operator sets `PONDER_NETWORK=worldchainSepolia` but leaves `PONDER_RPC_URL_4801` blank → ponder.config.ts throws "Missing PONDER_RPC_URL_4801". The error doesn't suggest a default. Worse: even if filled with the public Alchemy RPC, the **free-tier 10-block `eth_getLogs` range cap** (research agent's item #10) will stall Ponder for hours on the initial backfill.

**Fix.** Document the testnet RPC URL options in `.env.example`, and put an inline warning that the free public Alchemy endpoint is *not* suitable for a Ponder backfill — recommend Alchemy Pay-as-You-Go, Goldsky, Tenderly, or QuickNode. For local testing, the comment should say "set this to your own World Chain Sepolia archive RPC; do not point at `worldchain-sepolia.g.alchemy.com/public` for indexing."

---

## Medium findings

### WORLDID-1 — `WORLD_CHAIN_SEPOLIA_WORLD_ID_ROUTER` is hardcoded; verify against the live Address Book before deploy

**Severity:** Medium (deployment-time governance risk)

**Files / lines:** `packages/foundry/script/Deploy.s.sol:42-43`:
```
address internal constant WORLD_CHAIN_SEPOLIA_WORLD_ID_ROUTER = 0x57f928158C3EE7CDad1e4D8642503c4D0201f611;
```

**Context.** The research agent flagged that `docs.world.org/world-id/reference/address-book` is the authoritative source. Two common traps: (a) using the **Ethereum Sepolia** router (`0x469449f251692E0779667583026b5A1E99512157`) on L2 by mistake (different chain), and (b) the WorldID app/action setup on testnet uses separate staging credentials that must match.

**Fix.** Before the testnet deploy:
- Open `docs.world.org/world-id/reference/address-book` and pin the current World Chain Sepolia router address into `Deploy.s.sol` (if it differs from `0x57f928…`).
- Verify the testnet WorldID action (`NEXT_PUBLIC_WORLD_ID_ACTION`) is registered in the testnet Developer Portal with the staging signal.
- Add a deploy-script assertion: `require(worldIdRouterAddress.code.length > 0, "World ID router has no code");` to catch typos at deploy time.

### USDC-1 — `WORLD_CHAIN_SEPOLIA_USDC` is correct; no fix needed (positive verification)

**Severity:** Informational (verified sound)

**Files / lines:** `packages/foundry/script/Deploy.s.sol:41`: `address internal constant WORLD_CHAIN_SEPOLIA_USDC = 0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88;` matches the address documented at [docs.world.org/world-chain/tokens/usdc](https://docs.world.org/world-chain/tokens/usdc) (per the research agent). Sepolia USDC is a **mintable test token**, not bridged Circle USDC, so faucet flow differs from mainnet — document this in the testnet runbook.

### INDEX-1 — `ProtocolConfig` is not indexed by Ponder

**Severity:** Medium (governance audit gap)

**Files / lines:** `packages/ponder/ponder.config.ts` — no `ProtocolConfig` entry (verified by grep). `packages/contracts/src/abis/index.ts:11` exports `ProtocolConfigAbi` but no indexer file under `packages/ponder/src/ProtocolConfig.ts` exists.

**Symptom on testnet.** Governance changes (`setConfig`, `setRoundConfigBounds`, `setDrandConfig`, `setSlashConfig`) emit events that are not captured in the indexer. Any "audit history of parameter changes" UI is impossible until this is added.

**Fix.** Add a `ProtocolConfig` entry to `ponder.config.ts` (pattern as for other contracts), plus `packages/ponder/src/ProtocolConfig.ts` with handlers for each Updated event, and a `protocol_config_change_log` table in `ponder.schema.ts`. Low-priority for testnet launch (the contract still works); high-priority for governance observability.

### E2E-1 — Smoke test `brand link can reopen landing page` — recommend pre-dismissing `TestnetNoticeBanner` in test setup

**Severity:** Medium (false-failure on CI; pre-existing on main)

**Files / lines:** `packages/nextjs/e2e/tests/smoke.spec.ts:48-50` waits for `h1` "Level Up Your Agent" within 15 s. The agent's hypothesis: the new `TestnetNoticeBanner` (sticky top bar with `bg-black`) interferes with the visibility check after navigation. The agent recommends:
```ts
await page.evaluate(() =>
  window.localStorage.setItem('rateloop:testnet-notice-dismissed', 'true'));
```
before the brand-link click. Failing that, the previously-flaky test of "winning voter claims participation reward, double claim reverts" (referenced in PR #22's CI logs at `reward-claim.spec.ts:264`) is **already self-resolving** on main — the participation-pool test was deleted in commit `c826b771` and the current line 264 is the unrelated `processUnrevealedVotes reverts when nothing to process` (verified).

**Fix.** Pre-dismiss the banner in the smoke test's `beforeEach` or in a shared `setupWallet` helper.

### E2E-2 — `scripts/dev-stack.mjs` still references `PONDER_PARTICIPATION_POOL_ADDRESS`

**Severity:** Medium (config pollution; surfaces as a warning, not a failure)

**Files / lines:** per the E2E agent, `scripts/dev-stack.mjs:57` lists `PONDER_PARTICIPATION_POOL_ADDRESS` in `ponderLocalDeploymentEnvKeys`. Same cleanup as STALE-2.

### MAINNET-1 — `TestnetNoticeBanner` shows on every chain (future-mainnet concern)

**Severity:** Low → Medium when mainnet ships

**Files / lines:** `packages/nextjs/components/TestnetNoticeBanner.tsx:8-60` and its mount points in `ScaffoldEthAppWithProviders.tsx` and `PublicShell.tsx`. The banner's only dismiss is a `localStorage` flag; there is no chain-id gate.

**Status today.** The project is intentionally testnet-only, so the banner is correct everywhere it currently runs. **Once mainnet is added** (chainId 480), the banner must gate on the active chainId. Add a `useTargetNetwork()` check like `if (!isTestnetChain) return null;`.

---

## Low / Informational (incl. positive verifications)

### POS-1 — `foundry.toml` pins `evm_version = 'cancun'`

Cross-checked against the research agent's pitfall #1 (PUSH0 / unsupported opcode on OP-stack). World Chain supports Cancun. ✓ Sound.

### POS-2 — `pragma ^0.8.34` on all 115 contract files; storage-layout JSONs in `packages/foundry/scripts/expected-storage-layouts/` cover all 8 upgradeable contracts (ContentRegistry, FeedbackBonusEscrow, FrontendRegistry, ProfileRegistry, ProtocolConfig, QuestionRewardPoolEscrow, RoundRewardDistributor, RoundVotingEngine) ✓

### POS-3 — Participation-pool removal is clean from source

Grep across all `.sol`, `.ts`, `.tsx` (excluding `.next/`, `node_modules/`, build broadcasts, and historical audit reports) returns **zero** runtime references to the removed contract. The only stale references are the configuration/example artifacts noted in STALE-1, STALE-2, E2E-2.

### POS-4 — WS-1 + WS-2 (signing-intent token strip + calldata display) hold up under the codex follow-up

The `useState(() => readToken(searchParams))` pattern at `BrowserSigningPage.tsx:172` is correct; token survives `replaceState`. The calldata selector + hex render at `:454-484` is rendering as designed.

### POS-5 — Role-renunciation pattern is correct for non-deployer admins

The Contracts agent flagged "missing PAUSER_ROLE renunciation on RoundVotingEngine, FeedbackBonusEscrow, QuestionRewardPoolEscrow" as Critical — **false positive**, verified. All three contracts grant PAUSER_ROLE to the `admin` parameter, which `Deploy.s.sol` always passes as `governance` (not `deployer`). The only contract that needs explicit `renounceRole(PAUSER_ROLE)` is `ContentRegistry`, because it uniquely takes BOTH `_admin` and `_governance` and grants PAUSER_ROLE to both. That renunciation IS present (`Deploy.s.sol:331`).

### LOW-1 — `RaterRegistry.SEEDER_ROLE` provides a clean testnet path

`Deploy.s.sol:337` correctly renounces SEEDER_ROLE from the deployer, leaving it with governance. For testnet seeding without real WorldID proofs, governance can re-grant `SEEDER_ROLE` to a test EOA, call `seedHumanCredential(...)` for each test account, and then revoke. Document this in the testnet runbook.

### LOW-2 — `ProtocolConfig` defaults: `minVoters=3, maxVoters=200, slashConfig.minSlashSettledRounds=2`

Not bugs; conservative production defaults that are too tight for a 2–3-account testnet smoke test. Operations team should call `protocolConfig.setConfig(20 minutes, 20 minutes, 1, 10)` and `setSlashConfig(2500, 1, 0, 200e6)` post-deploy to enable rapid iteration with a small voter cohort.

### LOW-3 — Allocation unit ambiguity in `LegacyClaimEntry.allocation`

`packages/nextjs/lib/legacy-claim/manifest.ts:3` types `allocation: string` with no docstring on the unit. LREP has 6 decimals; the contract expects raw `uint256` wei. Add a doccomment ("// Raw uint256 in 6-decimal wei. 1 LREP = 1_000_000.") to avoid a 10^6× off-by-decimals bug when the manifest is finally populated.

### LOW-4 — Tests missing for legacy-claim happy paths

`packages/nextjs/lib/legacy-claim/lookup.test.ts` covers normalize / invalid / not-published; `packages/nextjs/app/api/legacy-claim/route.test.ts` covers invalid + unpublished. **Missing:** eligible-address path, not_eligible distinguishable-response path, double-query caching, large-allocation values. Add these before the on-chain root is set.

---

## Verified false positives (recorded so future passes don't re-flag)

- **"Missing PAUSER_ROLE renunciation on RoundVotingEngine / FeedbackBonusEscrow / QuestionRewardPoolEscrow"** — all three grant PAUSER_ROLE to the `admin` parameter, which is `governance` (not `deployer`) in every call site in `Deploy.s.sol`. The deployer never holds PAUSER_ROLE on these contracts. See POS-5.
- **"NEXT_PUBLIC_PONDER_URL missing from .env.example"** — already present at `packages/nextjs/.env.example:103`; `utils/env/public.ts:113-118` throws in production if unset. No fix needed.

---

## Cross-cutting research artifact (2025–2026 OP-stack / World Chain pitfalls)

(From the web-research agent — verbatim summary; every item the team should grep for or check before / during the testnet deploy.)

| # | Pitfall | Check / action |
|---|---|---|
| 1 | PUSH0 / EVM version | `foundry.toml` `evm_version = "cancun"`. ✓ Already set. |
| 2 | WorldID Router address per chain | Pin against the live `docs.world.org/world-id/reference/address-book` at deploy time (WORLDID-1). |
| 3 | USDC is a test token on 4801 | Address verified; mint via official Sepolia USDC faucet, not bridged from Ethereum (USDC-1). |
| 4 | OP-stack block.timestamp, not block.number | grep `* 7200`, `blocksPerDay`, `/ 12` — none found in `packages/foundry/contracts` (confirmed). |
| 5 | `blockhash` / `block.prevrandao` randomness | grep — none used for value-bearing logic (confirmed). |
| 6 | drand chain-hash mismatch mainnet vs testnet | **DRAND-1 above.** Critical. |
| 7 | Foundry gas estimation under-prices L1 data fee | When `forge script` hangs on testnet broadcast, pass `--gas-estimate-multiplier 200`. |
| 8 | Contract verification: Worldscan v2 OR Blockscout (append `/api?`) | Document the verify command in the runbook for both options. |
| 9 | Faucet rate limits — budget for funded accounts | Fund one treasury EOA + `cast send` to test wallets; don't try to faucet 6 fresh addresses. |
| 10 | Alchemy free RPC has 10-block `eth_getLogs` cap | Don't point Ponder at the free public RPC (DEPLOY-3). |
| 11 | OZ v5 TransparentUpgradeableProxy auto-creates ProxyAdmin | `Deploy.s.sol` already uses v5 constructor signature `(impl, governance, initData)`. Confirmed sound. |
| 12 | WalletConnect Project ID + origin allowlist | Add `https://*.vercel.app` + production domain in WalletConnect Cloud before any Vercel preview testnet test. |
| 13 | Vercel preview env vars must be set per-env | `NEXT_PUBLIC_TARGET_NETWORKS=4801` (and matching RPCs) must be set in Vercel Preview *and* Development envs, not just Production. |
| 14 | Thirdweb Pay requires `testMode: true` on Sepolia | Audit the Thirdweb `PayUIOptions` initialization for `testMode`. |
| 15 | PBH (Priority Blockspace for Humans) reorders mempool | Tests that depend on strict FIFO ordering will flake on World Chain. |

---

## Pre-testnet deploy checklist

1. [ ] **DRAND-1** — Update `Deploy.s.sol` to call `setDrandConfig(testnetChainHash, testnetGenesisTime, testnetPeriod)` on chainId 4801. Bump the encrypter library / keeper to use the same testnet chain hash.
2. [ ] **WORLDID-1** — Pin the testnet WorldID router from `docs.world.org` into `Deploy.s.sol:42-43`. Add `worldIdRouterAddress.code.length > 0` assertion.
3. [ ] **STALE-1 / STALE-2 / E2E-2** — Regenerate `packages/foundry/deployments/31337.json`; delete the `PONDER_PARTICIPATION_POOL_ADDRESS` / `_START_BLOCK` lines from `packages/ponder/.env.example` and `scripts/dev-stack.mjs`.
4. [ ] **DEPLOY-2 / DEPLOY-3** — Add `METRICS_AUTH_TOKEN`, `CHAIN_ID` hint, `PONDER_RPC_URL_4801` / `_480` documentation to the relevant `.env.example` files.
5. [ ] **CLAIM-1** — Generate legacy-contributor merkle tree off-chain; populate `manifest.ts`; on-chain call `setLegacyContributorRoot(...)` post-deploy. Smoke-test one eligible address end-to-end.
6. [ ] **CLAIM-2** — Add IP-based rate limit to `/api/legacy-claim/[address]` (or require signed-challenge from the queried wallet). Test enumeration is gated.
7. [ ] **CLAIM-3** — Add `useTargetNetwork()` chain check to `useLegacyClaim.ts`; UI surfaces "Please switch to <network>" for mismatches.
8. [ ] **CLAIM tests** — Backfill happy-path tests in `lookup.test.ts` and `route.test.ts` (LOW-4).
9. [ ] **E2E-1** — Pre-dismiss `TestnetNoticeBanner` in smoke test setup.
10. [ ] **DEPLOY-1** — Run `DEPLOY_TARGET_NETWORK=worldchainSepolia yarn deploy` once steps 1–7 are in place. Commit `packages/foundry/deployments/4801.json` and the updated `deployedContracts.ts`. Verify on Worldscan and Blockscout.
11. [ ] **Operational settings** — Post-deploy, governance calls `protocolConfig.setConfig(20 minutes, 20 minutes, 1, 10)` and `setSlashConfig(...)` to relax round/slash thresholds for testnet iteration (LOW-2).
12. [ ] **WalletConnect / Vercel env setup** — Add Vercel preview `NEXT_PUBLIC_TARGET_NETWORKS=4801`, configure WalletConnect Cloud origin allowlist for `*.vercel.app`.
13. [ ] **Funding** — Bridge one treasury EOA from Ethereum Sepolia → World Chain Sepolia; `cast send` to 6 test wallets to bypass faucet rate limits.
14. [ ] **Vulnerability** — Resolve / triage the open Dependabot moderate vulnerability (`https://github.com/Noc2/RateLoop/security/dependabot/36`) that GitHub flags on every push. Either bump the affected package or document an accepted-risk note.

---

## Method note

Read-only audit. Six parallel scope-focused agents on `claude-testnet-readiness` source plus one web-research agent for 2025–2026 OP-stack / World Chain testnet pitfalls. Each candidate finding was manually re-verified against current source before inclusion; two agent claims were rejected as false positives and documented above. No source modifications made on this branch.

The smart-contract audit reports under `packages/foundry/audit-report-claude-*.md` predate the ParticipationPool removal and the legacy-claim flow addition — they reference architecture that no longer exists. Don't use them as a reference for the current contract surface; use the current sources.
