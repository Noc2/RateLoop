#!/usr/bin/env bash
# M-Crosscutting-1: Snapshot-test the storage layout of every
# TransparentUpgradeableProxy-backed contract. Any change to the order, type, or label of state
# variables breaks the check — forcing the author to either justify the change as an
# intentional layout shift (and re-snapshot via `make snapshot-storage-layouts`) or revert.
#
# This is the cheap on-chain analog of OZ Upgrades' `validateUpgrade`; it doesn't compare
# against an on-chain implementation, just against a checked-in snapshot. If the snapshot is
# out of date when CI runs, fix the snapshot in the same commit that intentionally changes
# the layout.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_DIR="$ROOT_DIR/scripts/expected-storage-layouts"

if [ ! -d "$EXPECTED_DIR" ]; then
  echo "::error::Expected storage-layout snapshots directory missing: $EXPECTED_DIR"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to check storage layouts" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to canonicalize storage layouts" >&2
  exit 1
fi

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

mismatch=0
for contract in "${CONTRACTS[@]}"; do
  expected="$EXPECTED_DIR/$contract.json"
  if [ ! -f "$expected" ]; then
    echo "::error file=$expected,title=Missing storage layout snapshot::Run 'make snapshot-storage-layouts' to regenerate"
    mismatch=$((mismatch + 1))
    continue
  fi

  current=$(
    forge inspect "contracts/$contract.sol:$contract" storageLayout --json 2>/dev/null \
      | python3 -c "
import sys, json, re
d = json.loads(sys.stdin.read())
# Codex P2 (PR #20 review): preserve the full type identifier, not just the prefix before '('.
# Stripping at the first '(' lost nested mapping/array value-type info, so a layout change
# that swapped the value type of a mapping (e.g., t_mapping(uint256,uint256) →
# t_mapping(uint256,bool)) would slip past the snapshot. We instead remove only the
# compile-specific suffixes — solc-generated contract/struct IDs and the '_storage'
# location marker — keeping everything else verbatim. Suffix shape examples:
#   t_contract(IERC20)24457        → t_contract(IERC20)
#   t_struct(Round)17549_storage   → t_struct(Round)
#   t_mapping(uint256,uint256)     → unchanged
TYPE_ID_SUFFIX = re.compile(r'(?:\))(?:\d+)(?:_storage)?')
def canon_type(t):
    return re.sub(r'\)(?:\d+)(?:_storage)?', ')', t).replace('_storage', '')
canonical = sorted(
    [
        {'slot': int(e['slot']), 'offset': e['offset'], 'label': e['label'], 'type': canon_type(e['type'])}
        for e in d['storage']
    ],
    key=lambda r: (r['slot'], r['offset']),
)
print(json.dumps(canonical, indent=2))
"
  )

  if ! diff -u "$expected" <(echo "$current") > /tmp/storage-diff-$$.txt; then
    echo "::error file=$expected,title=Storage layout drift detected in $contract"
    cat /tmp/storage-diff-$$.txt
    rm -f /tmp/storage-diff-$$.txt
    echo
    echo "If this shift is intentional (e.g., a deliberate upgrade-aware change), run:"
    echo "  cd packages/foundry && make snapshot-storage-layouts"
    echo "and commit the resulting JSON. Otherwise revert the layout change."
    mismatch=$((mismatch + 1))
  else
    rm -f /tmp/storage-diff-$$.txt
    echo "  ✓ $contract"
  fi
done

if [ "$mismatch" -gt 0 ]; then
  echo "Found $mismatch storage layout mismatch(es)." >&2
  exit 1
fi

echo "All checked storage layouts match the pinned snapshots."
