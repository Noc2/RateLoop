/**
 * Conservative emulations of how third-party MCP host adapters transform JSON Schema
 * tool definitions before a model sees them.
 *
 * These are NOT vendor SDKs and do not execute any vendor code. They are deliberately
 * conservative re-implementations pinned to the documented behavior referenced by
 * docs/tokenless-mcp-cross-client-compatibility-review-2026-07.md ("Make tool schemas
 * easier for different model adapters"): the OpenAI strict function-schema subset and
 * the Gemini CLI schema sanitizer. Pinning to the documented floor means the gate can
 * report a constraint as dropped even when a newer vendor build happens to keep it;
 * it must never do the reverse. When a vendor documents broader keyword support, relax
 * the corresponding rule here in an explicit reviewed change so the CI baseline moves
 * with evidence, not silently.
 *
 * Emulated behaviors:
 *
 * - OpenAI strict function schemas (structured outputs / Agents SDK best-effort strict
 *   conversion): every object requires `additionalProperties: false` and must list all
 *   properties as `required` (optionality is lost or must be re-expressed as null
 *   unions by the caller); only a small keyword subset is guaranteed (`type`,
 *   `properties`, `required`, `additionalProperties`, `items`, `enum`, `anyOf`,
 *   definitions/refs). `oneOf` is not in the subset and is relaxed to `anyOf`;
 *   `allOf`/`if`/`then`/`else` conditional requirements are unsupported and dropped;
 *   validation keywords such as `pattern`, `format`, `minLength`, `maxLength`,
 *   `minimum`, `maximum`, `minItems`, `maxItems`, and `default` are outside the
 *   documented floor and are dropped.
 *
 * - Gemini CLI schema sanitization: the CLI documents sanitizing tool schemas to the
 *   Gemini function-declaration subset. Composition keywords (`oneOf`, `anyOf`,
 *   `allOf`) and conditional requirements are stripped, `pattern` constraints are
 *   removed, `additionalProperties: false` (closed objects) is not representable, and
 *   `["T", "null"]` type unions are re-expressed as `nullable`. Sanitized-away union
 *   arms take their nested `enum`/`required` constraints with them.
 *
 * Every transformation returns the converted schema plus an explicit accounting of
 * dropped validation constraints and semantic changes so CI can pin today's known
 * gaps exactly and fail on any regression or unrecorded improvement.
 */

export type SchemaAdapterResult = {
  converted: Record<string, unknown>;
  droppedConstraints: string[];
  semanticChanges: string[];
};

type MutableSchema = Record<string, unknown>;

/** Validation keywords outside the documented OpenAI strict-mode keyword floor. */
const OPENAI_UNSUPPORTED_KEYWORDS = [
  "default",
  "format",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "pattern",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function describeValue(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

/** Extract the `then.required` keys of an `allOf` arm that models a conditional requirement. */
function conditionalRequiredKeys(arm: unknown): string[] {
  if (!isRecord(arm) || !isRecord(arm.then)) return [];
  const required = arm.then.required;
  return Array.isArray(required) ? required.filter((key): key is string => typeof key === "string") : [];
}

/** Human-readable label for a dropped union arm, so baselines stay reviewable. */
function describeUnionArm(arm: unknown): string {
  if (isRecord(arm) && isRecord(arm.properties)) {
    const kind = arm.properties.kind;
    if (isRecord(kind)) {
      const value = kind.const ?? (Array.isArray(kind.enum) ? kind.enum[0] : undefined);
      if (typeof value === "string") return `kind=${value}`;
    }
  }
  return "unlabeled arm";
}

/**
 * Conservative emulation of the OpenAI strict function-schema conversion
 * (structured outputs / Agents SDK best-effort strict mode). Pinned to the
 * documented keyword floor described in the module comment — not vendor code.
 */
export function emulateOpenAiStrictToolSchema(inputSchema: unknown): SchemaAdapterResult {
  const droppedConstraints: string[] = [];
  const semanticChanges: string[] = [];
  const converted = openAiNode(cloneJson(inputSchema), "$", droppedConstraints, semanticChanges);
  return {
    converted: isRecord(converted) ? converted : {},
    droppedConstraints: [...droppedConstraints].sort(),
    semanticChanges: [...semanticChanges].sort(),
  };
}

function openAiNode(node: unknown, path: string, dropped: string[], semantic: string[]): unknown {
  if (!isRecord(node)) return node;
  const out: MutableSchema = { ...node };

  for (const keyword of OPENAI_UNSUPPORTED_KEYWORDS) {
    if (keyword in out) {
      dropped.push(
        `${path}: ${keyword} ${describeValue(out[keyword])} dropped (outside the strict-mode keyword floor)`,
      );
      delete out[keyword];
    }
  }

  // `const` is not in the documented strict subset; a single-value `enum` is the
  // semantically equivalent supported spelling, so the constraint itself survives.
  if ("const" in out) {
    out.enum = [out.const];
    delete out.const;
    semantic.push(`${path}: const rewritten as a single-value enum`);
  }

  if (Array.isArray(out.allOf)) {
    out.allOf.forEach((arm, index) => {
      const keys = conditionalRequiredKeys(arm);
      dropped.push(
        keys.length > 0
          ? `${path}.allOf[${index}]: conditional required [${keys.join(", ")}] dropped (if/then unsupported in strict mode)`
          : `${path}.allOf[${index}]: composition constraint dropped (allOf unsupported in strict mode)`,
      );
    });
    delete out.allOf;
  }
  for (const keyword of ["if", "then", "else"] as const) {
    if (keyword in out) {
      dropped.push(`${path}: ${keyword} conditional dropped (unsupported in strict mode)`);
      delete out[keyword];
    }
  }

  if (Array.isArray(out.oneOf)) {
    semantic.push(`${path}: oneOf relaxed to anyOf (strict mode has no exclusive union)`);
    out.anyOf = out.oneOf.map((arm, index) => openAiNode(arm, `${path}.union[${index}]`, dropped, semantic));
    delete out.oneOf;
  } else if (Array.isArray(out.anyOf)) {
    out.anyOf = out.anyOf.map((arm, index) => openAiNode(arm, `${path}.union[${index}]`, dropped, semantic));
  }

  if (isRecord(out.properties)) {
    const properties: MutableSchema = {};
    for (const [key, value] of Object.entries(out.properties)) {
      properties[key] = openAiNode(value, `${path}.${key}`, dropped, semantic);
    }
    out.properties = properties;
    const originallyRequired = new Set<unknown>(Array.isArray(node.required) ? node.required : []);
    const allKeys = Object.keys(properties).sort();
    for (const key of allKeys) {
      if (!originallyRequired.has(key)) {
        semantic.push(`${path}.${key}: optional property forced required by strict mode`);
      }
    }
    out.required = allKeys;
    if (out.additionalProperties !== false) {
      semantic.push(`${path}: additionalProperties forced to false`);
      out.additionalProperties = false;
    }
  }

  if (isRecord(out.items)) {
    out.items = openAiNode(out.items, `${path}[]`, dropped, semantic);
  }

  return out;
}

/**
 * Conservative emulation of the Gemini CLI schema sanitizer for MCP tool schemas.
 * Pinned to the documented sanitization behavior described in the module comment —
 * not vendor code.
 */
export function emulateGeminiCliToolSchema(inputSchema: unknown): SchemaAdapterResult {
  const droppedConstraints: string[] = [];
  const semanticChanges: string[] = [];
  const converted = geminiNode(cloneJson(inputSchema), "$", droppedConstraints, semanticChanges);
  return {
    converted: isRecord(converted) ? converted : {},
    droppedConstraints: [...droppedConstraints].sort(),
    semanticChanges: [...semanticChanges].sort(),
  };
}

function geminiNode(node: unknown, path: string, dropped: string[], semantic: string[]): unknown {
  if (!isRecord(node)) return node;
  const out: MutableSchema = { ...node };

  if ("pattern" in out) {
    dropped.push(`${path}: pattern ${describeValue(out.pattern)} dropped (sanitizer strips pattern constraints)`);
    delete out.pattern;
  }

  if (out.additionalProperties === false) {
    dropped.push(
      `${path}: additionalProperties:false dropped (closed-object constraint not representable after sanitization)`,
    );
    delete out.additionalProperties;
  }

  // Composition keywords are sanitized away. Dropping a union drops every nested
  // constraint inside its arms (required fields, enums, closed objects) with it.
  for (const keyword of ["oneOf", "anyOf"] as const) {
    const arms = out[keyword];
    if (Array.isArray(arms)) {
      arms.forEach((arm, index) => {
        dropped.push(`${path}.union[${index}]: ${keyword} union arm dropped (${describeUnionArm(arm)})`);
      });
      delete out[keyword];
      semantic.push(`${path}: ${keyword} union collapsed to an unconstrained object`);
      out.type = "object";
    }
  }
  if (Array.isArray(out.allOf)) {
    out.allOf.forEach((arm, index) => {
      const keys = conditionalRequiredKeys(arm);
      dropped.push(
        keys.length > 0
          ? `${path}.allOf[${index}]: conditional required [${keys.join(", ")}] dropped (if/then sanitized away)`
          : `${path}.allOf[${index}]: composition constraint dropped (allOf sanitized away)`,
      );
    });
    delete out.allOf;
  }
  for (const keyword of ["if", "then", "else"] as const) {
    if (keyword in out) {
      dropped.push(`${path}: ${keyword} conditional dropped (sanitized away)`);
      delete out[keyword];
    }
  }

  // `const` is not part of the function-declaration subset; a single-value enum is
  // the supported equivalent, so the constraint itself survives.
  if ("const" in out) {
    out.enum = [out.const];
    delete out.const;
    semantic.push(`${path}: const rewritten as a single-value enum`);
  }

  // `["T", "null"]` unions are re-expressed with `nullable: true` (no constraint loss).
  if (Array.isArray(out.type)) {
    const nonNull = out.type.filter(entry => entry !== "null");
    if (out.type.length === 2 && nonNull.length === 1 && typeof nonNull[0] === "string") {
      semantic.push(`${path}: type ${describeValue(node.type)} rewritten to nullable ${nonNull[0]}`);
      out.type = nonNull[0];
      out.nullable = true;
    }
  }

  if (isRecord(out.properties)) {
    const properties: MutableSchema = {};
    for (const [key, value] of Object.entries(out.properties)) {
      properties[key] = geminiNode(value, `${path}.${key}`, dropped, semantic);
    }
    out.properties = properties;
  }

  if (isRecord(out.items)) {
    out.items = geminiNode(out.items, `${path}[]`, dropped, semantic);
  }

  return out;
}
