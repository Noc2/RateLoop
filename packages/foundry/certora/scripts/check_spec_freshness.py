#!/usr/bin/env python3
"""Spec-freshness guard for the Certora lane.

Fails when a contract that has Certora coverage is changed in a PR without its
spec being touched — the exact drift that left ClusterPayoutOracle.spec stale
behind three contract commits (see docs/testing/certora-round3-plan.md, Track G).

The contract -> spec(s) map is derived from the conf files themselves (no second
source of truth to keep in sync):
  - each conf's `verify` key names the spec;
  - each conf's `files` list names the verification targets. A target under
    contracts/ is a direct dependency; a target under certora/harnesses/ is
    resolved to the contracts/ files it imports, so harness-based confs
    (FrontendRegistry, FeedbackBonusEscrow, ...) are covered too.

Usage:
    check_spec_freshness.py --changed-from <git-ref>      # diff <ref>...HEAD
    check_spec_freshness.py --changed-file <path>         # newline-listed paths
    git diff --name-only BASE...HEAD | check_spec_freshness.py --changed-stdin

Escape hatch (for intentional contract-only changes that don't affect proven
properties): include the literal token [spec-ok] anywhere in the environment
variable SPEC_FRESHNESS_OVERRIDE (the workflow wires this to the PR title/body).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# Repo-root-relative location of the foundry package and the certora workspace.
FOUNDRY = "packages/foundry"
CONFS_DIR = Path(FOUNDRY) / "certora" / "confs"


def strip_jsonc(text: str) -> str:
    """Remove // line comments so the commented conf files parse as JSON."""
    out = []
    for line in text.splitlines():
        # Only strip // that is not inside a string. The confs only ever use //
        # at the start of a (possibly indented) line or after a value, never
        # inside string literals, so a simple heuristic is safe here.
        in_str = False
        result = []
        i = 0
        while i < len(line):
            ch = line[i]
            if ch == '"':
                in_str = not in_str
            if not in_str and ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
                break
            result.append(ch)
            i += 1
        out.append("".join(result))
    return "\n".join(out)


def harness_contract_deps(harness_rel: str) -> list[str]:
    """contracts/ files imported by a harness, as FOUNDRY-relative paths."""
    harness_path = Path(FOUNDRY) / harness_rel
    deps: list[str] = []
    if not harness_path.exists():
        return deps
    text = harness_path.read_text()
    for m in re.finditer(r'import\s*\{[^}]*\}\s*from\s*"([^"]+)"', text):
        target = m.group(1)
        # Harnesses live in certora/harnesses/, so ../../contracts/X.sol -> contracts/X.sol
        if "contracts/" in target:
            normalized = "contracts/" + target.split("contracts/", 1)[1]
            deps.append(normalized)
    return deps


def build_map() -> dict[str, set[str]]:
    """contract path (FOUNDRY-relative) -> set of spec paths (FOUNDRY-relative)."""
    mapping: dict[str, set[str]] = {}
    for conf in sorted(CONFS_DIR.glob("*.conf")):
        if conf.name == "base.conf":
            continue
        data = json.loads(strip_jsonc(conf.read_text()))
        verify = data.get("verify", "")
        if ":" not in verify:
            continue
        spec = verify.split(":", 1)[1]
        targets = data.get("files", [])
        deps: set[str] = set()
        for target in targets:
            if target.startswith("contracts/"):
                deps.add(target)
            elif "harnesses/" in target:
                deps.update(harness_contract_deps(target))
        for dep in deps:
            mapping.setdefault(dep, set()).add(spec)
    return mapping


def changed_files(args: argparse.Namespace) -> list[str]:
    if args.changed_stdin:
        return [l.strip() for l in sys.stdin if l.strip()]
    if args.changed_file:
        return [l.strip() for l in Path(args.changed_file).read_text().splitlines() if l.strip()]
    if args.changed_from:
        out = subprocess.run(
            ["git", "diff", "--name-only", f"{args.changed_from}...HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout
        return [l.strip() for l in out.splitlines() if l.strip()]
    raise SystemExit("one of --changed-from/--changed-file/--changed-stdin is required")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--changed-from", help="git ref; diff <ref>...HEAD for changed files")
    parser.add_argument("--changed-file", help="file containing newline-separated changed paths")
    parser.add_argument("--changed-stdin", action="store_true", help="read changed paths from stdin")
    args = parser.parse_args()

    override = os.environ.get("SPEC_FRESHNESS_OVERRIDE", "")
    if "[spec-ok]" in override:
        print("spec-freshness: [spec-ok] override present — skipping check.")
        return 0

    mapping = build_map()
    changed = set(changed_files(args))
    # Normalize conf-relative (FOUNDRY-relative) paths to repo-root-relative.
    changed_foundry = {
        c[len(FOUNDRY) + 1:] for c in changed if c.startswith(FOUNDRY + "/")
    }

    stale: list[tuple[str, list[str]]] = []
    for contract, specs in sorted(mapping.items()):
        if contract not in changed_foundry:
            continue
        if specs & changed_foundry:
            continue  # at least one covering spec was touched — OK
        stale.append((contract, sorted(specs)))

    if not stale:
        print("spec-freshness: OK — every changed covered contract had its spec reviewed.")
        return 0

    print("spec-freshness: FAIL — covered contract(s) changed without touching the spec.\n")
    for contract, specs in stale:
        spec_list = ", ".join(s.replace("certora/specs/", "") for s in specs)
        msg = f"{contract} changed but its Certora spec(s) were not: {spec_list}"
        print(f"  - {msg}")
        # GitHub Actions annotation.
        print(f"::error file={FOUNDRY}/{contract}::{msg}")
    print(
        "\nReview the spec against the contract change. If the change genuinely does "
        "not affect any proven property, add [spec-ok] to the PR title or body to bypass."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
