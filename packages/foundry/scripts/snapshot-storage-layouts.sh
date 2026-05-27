#!/usr/bin/env bash
# Regenerate the storage-layout snapshots under `scripts/expected-storage-layouts/`. Run this
# whenever you intentionally change the storage layout of an upgradeable contract — the result
# must then be committed alongside the contract change so `check-storage-layouts.sh` accepts it.
#
# Companion to `check-storage-layouts.sh`. M-Crosscutting-1 from audit-claude-2026-05-20.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_DIR="$ROOT_DIR/scripts/expected-storage-layouts"
CANONICALIZE_SCRIPT="$ROOT_DIR/scripts/storage-layout-canonicalize.py"
mkdir -p "$EXPECTED_DIR"

CONTRACTS=(
  "ContentRegistry"
  "FeedbackBonusEscrow"
  "FeedbackRegistry"
  "FrontendRegistry"
  "ProfileRegistry"
  "ProtocolConfig"
  "QuestionRewardPoolEscrow"
  "RaterRegistry"
  "RoundRewardDistributor"
  "RoundVotingEngine"
)

for contract in "${CONTRACTS[@]}"; do
  echo "Snapshotting $contract"
  forge inspect "contracts/$contract.sol:$contract" storageLayout --json \
    | python3 "$CANONICALIZE_SCRIPT" > "$EXPECTED_DIR/$contract.json"
done

echo "Updated snapshots under $EXPECTED_DIR. Commit them alongside the contract change."
