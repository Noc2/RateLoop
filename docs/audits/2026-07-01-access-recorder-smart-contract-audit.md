# Access Recorder Smart Contract Audit - 2026-07-01

## Scope

This review covered the frontend-owned confidentiality log changes on `main`, with emphasis on:

- `FrontendRegistry.setAccessRecorder`, `clearAccessRecorder`, `authorizedAccessRecorderFrontend`, and `isAuthorizedAccessRecorder`
- `ConfidentialityEscrow.recordAccessNexus` and `publishLogRoot`
- frontend-scoped log root storage and event semantics
- storage layout snapshots and deployed bytecode sizes

## Result

No critical, high, medium, or low exploitable findings were identified in the changed access-recorder flow.

The change removes the global `ACCESS_RECORDER_ROLE` model and makes confidentiality log recording accountable to the registered frontend. An eligible frontend can use itself as recorder or assign one unregistered operational wallet. Authorization is reciprocal, per-frontend, and drops when the frontend is underbonded, exiting, slashed, deregistered, or when the assigned recorder registers as its own frontend.

## Manual Review Notes

- `FrontendRegistry.isAuthorizedAccessRecorder(frontend, recorder)` first requires the frontend to be eligible, allows the frontend address itself, then requires both mappings to agree for delegated recorders.
- `setAccessRecorder` rejects zero addresses, exiting/slashed/underbonded frontends, registered recorder wallets other than self, and recorders already assigned to another frontend.
- `register`, `_requestDeregister`, and `_slashFrontend` clear inbound/outbound access-recorder assignments, preventing stale delegated authorization after lifecycle changes.
- `ConfidentialityEscrow._requireAuthorizedAccessRecorder` rejects zero frontend addresses, requires `ProtocolConfig.frontendRegistry()` to be configured, and delegates authorization to `FrontendRegistry`.
- `publishLogRoot` stores anchors under `logRootAnchors[frontend][epochHash]`, so multiple frontend providers can publish different artifacts for the same epoch without overwriting each other.
- Existing registry/voting-engine confidentiality nexus recording remains separate from frontend access recording.

## Verification

| Check | Result |
| --- | --- |
| `yarn foundry:slither` | Passed, `0 result(s) found` across 361 contracts with 35 detectors |
| `yarn foundry:aderyn` | Completed; Aderyn reported 0 high issues and 23 low detector categories across the wider suite |
| `forge test --offline --match-path 'test/FrontendRegistry.t.sol'` | Passed, 70 tests |
| `forge test --offline --match-path 'test/ConfidentialityEscrow.t.sol'` | Passed, 32 tests |
| `forge test --offline` | Passed, 1,799 tests |
| `make check-storage-layouts` | Passed, all checked layouts match pinned snapshots |
| `make check-contract-sizes` | Passed, all checked deployed bytecode is below the EIP-170 24,576 byte limit |

Closest deploy-profile bytecode sizes:

| Contract | Deployed bytes |
| --- | ---: |
| `RoundVotingEngine` | 24,562 |
| `LaunchDistributionPool` | 24,503 |
| `ContentRegistry` | 24,146 |
| `QuestionRewardPoolEscrowBundleActionsLib` | 23,858 |
| `QuestionRewardPoolEscrow` | 23,191 |
| `ConfidentialityEscrow` | 14,235 |
| `FrontendRegistry` | 14,523 |

The plain `forge test` build still emits non-deploy-profile size warnings for some contracts and test harnesses. The deploy-profile `make check-contract-sizes` gate is the relevant deployability check and passed.

## Aderyn Low Findings Context

Aderyn's low-category report is broad repo-wide detector output. The entries touching `FrontendRegistry` and `ConfidentialityEscrow` are generic categories such as role centralization, pragma/PUSH0 warnings, numeric literals, storage gap variables, and inherited role grants. No Aderyn entry specifically flagged `setAccessRecorder`, `clearAccessRecorder`, `isAuthorizedAccessRecorder`, `recordAccessNexus`, or `publishLogRoot`.

## Residual Operational Notes

- A frontend that assigns an operational recorder remains accountable through its frontend registration and stake.
- Losing the assigned recorder key does not require governance if the frontend wallet is still available; the frontend can rotate or clear it.
- Losing the frontend wallet remains an operator custody issue because only the frontend can self-manage its recorder assignment.
