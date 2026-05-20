#!/usr/bin/env bash
# Regenerate the storage-layout snapshots under `scripts/expected-storage-layouts/`. Run this
# whenever you intentionally change the storage layout of an upgradeable contract — the result
# must then be committed alongside the contract change so `check-storage-layouts.sh` accepts it.
#
# Companion to `check-storage-layouts.sh`. M-Crosscutting-1 from audit-claude-2026-05-20.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_DIR="$ROOT_DIR/scripts/expected-storage-layouts"
mkdir -p "$EXPECTED_DIR"

CONTRACTS=(
  "ContentRegistry"
  "FeedbackBonusEscrow"
  "FrontendRegistry"
  "ProfileRegistry"
  "ProtocolConfig"
  "QuestionRewardPoolEscrow"
  "RoundRewardDistributor"
  "RoundVotingEngine"
)

for contract in "${CONTRACTS[@]}"; do
  echo "Snapshotting $contract"
  forge inspect "contracts/$contract.sol:$contract" storageLayout --json \
    | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
canonical = sorted(
    [
        {'slot': int(e['slot']), 'offset': e['offset'], 'label': e['label'], 'type': e['type'].split('(')[0]}
        for e in d['storage']
    ],
    key=lambda r: (r['slot'], r['offset']),
)
print(json.dumps(canonical, indent=2))
" > "$EXPECTED_DIR/$contract.json"
done

echo "Updated snapshots under $EXPECTED_DIR. Commit them alongside the contract change."
