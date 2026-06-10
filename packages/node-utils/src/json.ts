import { keccak256, toBytes, type Hex } from "viem";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value), (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  );
}

export function canonicalJsonHash(value: unknown): Hex {
  return canonicalJsonStringHash(canonicalJson(value));
}

export function canonicalJsonStringHash(canonical: string): Hex {
  return keccak256(toBytes(canonical));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortJson(record[key])]),
  );
}
