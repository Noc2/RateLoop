import { sha256 } from "@noble/hashes/sha256";

const UTF8 = new TextEncoder();

export class Rfc8785CanonicalizationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "Rfc8785CanonicalizationError";
  }
}

function assertUnicodeScalarString(value: string, location: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Rfc8785CanonicalizationError(
          `${location} contains a lone high surrogate.`,
        );
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Rfc8785CanonicalizationError(
        `${location} contains a lone low surrogate.`,
      );
    }
  }
}

function serializeString(value: string, location: string) {
  assertUnicodeScalarString(value, location);
  return JSON.stringify(value);
}

function serialize(
  value: unknown,
  seen: Set<object>,
  location: string,
): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return serializeString(value, location);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Rfc8785CanonicalizationError(
        `${location} contains a non-finite number.`,
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Rfc8785CanonicalizationError(
      `${location} contains a value that is not valid I-JSON.`,
    );
  }
  if (seen.has(value)) {
    throw new Rfc8785CanonicalizationError(
      `${location} contains a cyclic reference.`,
    );
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new Rfc8785CanonicalizationError(
            `${location} contains a sparse array.`,
          );
        }
        entries.push(serialize(value[index], seen, `${location}[${index}]`));
      }
      return `[${entries.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Rfc8785CanonicalizationError(
        `${location} contains a non-JSON object.`,
      );
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Rfc8785CanonicalizationError(
        `${location} contains a symbol property.`,
      );
    }

    const properties = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(properties).sort();
    const entries = keys.map((key) => {
      const property = properties[key];
      if (!property?.enumerable || !("value" in property)) {
        throw new Rfc8785CanonicalizationError(
          `${location} contains a non-JSON property.`,
        );
      }
      const encodedKey = serializeString(key, `${location} property name`);
      return `${encodedKey}:${serialize(property.value, seen, `${location}.${key}`)}`;
    });
    return `{${entries.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

/** Canonicalizes an I-JSON value according to RFC 8785 (JCS). */
export function canonicalizeRfc8785(value: unknown): string {
  return serialize(value, new Set(), "value");
}

/** Returns the lowercase SHA-256 digest of UTF-8 text or bytes. */
export function sha256Hex(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? UTF8.encode(value) : value;
  return Array.from(sha256(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Canonicalizes an I-JSON value and returns its prefixed SHA-256 digest. */
export function sha256Rfc8785(value: unknown): `sha256:${string}` {
  return `sha256:${sha256Hex(canonicalizeRfc8785(value))}`;
}
