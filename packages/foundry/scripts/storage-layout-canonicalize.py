#!/usr/bin/env python3
"""Canonicalize Forge storageLayout JSON for stable snapshot diffs."""

import json
import re
import sys


def canon_type(type_id: str) -> str:
    return re.sub(r"\)(?:\d+)(?:_storage)?", ")", type_id).replace("_storage", "")


def canon_member(member: dict) -> dict:
    return {
        "slot": int(member["slot"]),
        "offset": member["offset"],
        "label": member["label"],
        "type": canon_type(member["type"]),
    }


def canon_type_entry(type_id: str, entry: dict) -> dict:
    canonical = {
        "id": canon_type(type_id),
        "encoding": entry.get("encoding"),
        "label": entry.get("label"),
        "numberOfBytes": entry.get("numberOfBytes"),
    }

    if "base" in entry:
        canonical["base"] = canon_type(entry["base"])
    if "key" in entry:
        canonical["key"] = canon_type(entry["key"])
    if "value" in entry:
        canonical["value"] = canon_type(entry["value"])
    if "members" in entry:
        canonical["members"] = sorted(
            [canon_member(member) for member in entry["members"]],
            key=lambda item: (item["slot"], item["offset"], item["label"]),
        )

    return canonical


def main() -> None:
    layout = json.loads(sys.stdin.read())
    canonical = {
        "storage": sorted(
            [canon_member(entry) for entry in layout["storage"]],
            key=lambda item: (item["slot"], item["offset"], item["label"]),
        ),
        "types": sorted(
            [canon_type_entry(type_id, entry) for type_id, entry in layout.get("types", {}).items()],
            key=lambda item: item["id"],
        ),
    }
    print(json.dumps(canonical, indent=2))


if __name__ == "__main__":
    main()
