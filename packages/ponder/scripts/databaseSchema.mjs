import { createHash } from "node:crypto";
import { PONDER_NETWORK_CHAIN_IDS } from "../src/protocol-deployment.ts";

export const DEFAULT_PONDER_DATABASE_SCHEMA = "rateloop_ponder";
export const LEGACY_PONDER_DATABASE_SCHEMA = "ponder";

const SCHEMA_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_PONDER_DATABASE_SCHEMA_LENGTH = 45;
const RAILWAY_DATABASE_SCHEMA_PREFIX = "railway_";
const PROTOCOL_DEPLOYMENT_DATABASE_SCHEMA_PREFIX = "rateloop_deployment_";
export const LIVE_SCHEMA_OVERRIDE_FLAG = "RATELOOP_PONDER_ALLOW_LIVE_SCHEMA_OVERRIDE";
const DEFAULT_PONDER_DATABASE_SCHEMA_BY_NETWORK = {
  hardhat: "rateloop_ponder_hardhat",
  base: "rateloop_ponder_base",
};
const LIVE_PONDER_NETWORKS = new Set(["base"]);
const DECIMAL_UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;
function readEnv(env, key) {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function isTruthyEnv(value) {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function resolveDefaultPonderDatabaseSchema(env) {
  const ponderNetwork = readEnv(env, "PONDER_NETWORK");
  return DEFAULT_PONDER_DATABASE_SCHEMA_BY_NETWORK[ponderNetwork] ?? DEFAULT_PONDER_DATABASE_SCHEMA;
}

function normalizeAddress(value) {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^0x[0-9a-f]{40}$/.test(normalized) && !/^0x0{40}$/.test(normalized)
    ? normalized
    : undefined;
}

function parseStrictPositiveInteger(value) {
  if (!DECIMAL_UNSIGNED_INTEGER_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolvePonderChainId(env) {
  const ponderNetwork = readEnv(env, "PONDER_NETWORK");
  const networkChainId = PONDER_NETWORK_CHAIN_IDS[ponderNetwork];
  const explicitChainIdRaw = readEnv(env, "PONDER_CHAIN_ID");
  if (explicitChainIdRaw !== undefined) {
    const explicitChainId = parseStrictPositiveInteger(explicitChainIdRaw);
    if (explicitChainId === null) {
      throw new Error("PONDER_CHAIN_ID must be a positive integer.");
    }
    if (networkChainId !== undefined && explicitChainId !== networkChainId) {
      throw new Error(
        `PONDER_CHAIN_ID ${explicitChainId} does not match PONDER_NETWORK ${ponderNetwork} (${networkChainId}).`,
      );
    }
    if (ponderNetwork !== undefined && networkChainId === undefined) return undefined;
    return explicitChainId;
  }

  return networkChainId;
}

export function buildProtocolDeploymentKey({ chainId, contentRegistryAddress, feedbackRegistryAddress }) {
  return [
    String(chainId),
    contentRegistryAddress.toLowerCase(),
    feedbackRegistryAddress.toLowerCase(),
  ].join(":");
}

function canDeriveProtocolDeploymentKeyFromEnvAddresses(env, chainId) {
  const ponderNetwork = readEnv(env, "PONDER_NETWORK");
  return ponderNetwork === "hardhat" || (ponderNetwork === undefined && chainId === PONDER_NETWORK_CHAIN_IDS.hardhat);
}

export function protocolDeploymentKeyFromEnv(env = process.env) {
  const explicitKey = readEnv(env, "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY")
    ?? readEnv(env, "RATELOOP_PROTOCOL_DEPLOYMENT_KEY");
  if (explicitKey) return explicitKey.toLowerCase();

  const chainId = resolvePonderChainId(env);
  const contentRegistryAddress = normalizeAddress(readEnv(env, "PONDER_CONTENT_REGISTRY_ADDRESS"));
  const feedbackRegistryAddress = normalizeAddress(readEnv(env, "PONDER_FEEDBACK_REGISTRY_ADDRESS"));
  if (
    !chainId ||
    !contentRegistryAddress ||
    !feedbackRegistryAddress ||
    !canDeriveProtocolDeploymentKeyFromEnvAddresses(env, chainId)
  ) {
    return undefined;
  }

  return buildProtocolDeploymentKey({
    chainId,
    contentRegistryAddress,
    feedbackRegistryAddress,
  });
}

export function schemaFromProtocolDeploymentKey(deploymentKey) {
  const value = deploymentKey?.trim().toLowerCase();
  if (!value) return undefined;

  const hash = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${PROTOCOL_DEPLOYMENT_DATABASE_SCHEMA_PREFIX}${hash}`;
}

export function schemaFromRailwayDeploymentId(deploymentId) {
  const value = deploymentId?.trim();
  if (!value) return undefined;

  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  if (!slug) return undefined;

  const prefixed = `${RAILWAY_DATABASE_SCHEMA_PREFIX}${slug}`;
  if (prefixed.length <= MAX_PONDER_DATABASE_SCHEMA_LENGTH) return prefixed;

  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
  const availableSlugLength =
    MAX_PONDER_DATABASE_SCHEMA_LENGTH - RAILWAY_DATABASE_SCHEMA_PREFIX.length - hash.length - 1;
  const shortenedSlug = slug.slice(0, Math.max(1, availableSlugLength)).replace(/_+$/g, "");

  return `${RAILWAY_DATABASE_SCHEMA_PREFIX}${shortenedSlug || "deployment"}_${hash}`;
}

function staticSchemaNetwork(schema) {
  if (schema === undefined) return undefined;
  return Object.entries(DEFAULT_PONDER_DATABASE_SCHEMA_BY_NETWORK).find(([, value]) => value === schema)?.[0];
}

function assertLiveSchemaOverrideSafe({ env, schema, source }) {
  const ponderNetwork = readEnv(env, "PONDER_NETWORK");
  if (!LIVE_PONDER_NETWORKS.has(ponderNetwork) || isTruthyEnv(readEnv(env, LIVE_SCHEMA_OVERRIDE_FLAG))) return;

  const schemaNetwork = staticSchemaNetwork(schema);
  if (schemaNetwork !== undefined && schemaNetwork !== ponderNetwork) {
    throw new Error(
      `${source}=${schema} is a static ${schemaNetwork} Ponder schema, but PONDER_NETWORK=${ponderNetwork}. ` +
        `Remove the stale schema override or set ${LIVE_SCHEMA_OVERRIDE_FLAG}=true only for a deliberate recovery override.`,
    );
  }
}

function assertValidPonderSchemaName(schema) {
  if (!SCHEMA_NAME_PATTERN.test(schema)) {
    throw new Error(
      `Invalid Ponder database schema "${schema}". Use letters, numbers, and underscores, starting with a letter or underscore.`,
    );
  }
}

export function resolvePonderDatabaseSchema(env = process.env) {
  const rateloopSchema = readEnv(env, "RATELOOP_PONDER_DATABASE_SCHEMA");
  const databaseSchema = readEnv(env, "DATABASE_SCHEMA");
  const protocolDeploymentKey = protocolDeploymentKeyFromEnv(env);
  const protocolDeploymentSchema = schemaFromProtocolDeploymentKey(protocolDeploymentKey);
  const railwaySchema = schemaFromRailwayDeploymentId(readEnv(env, "RAILWAY_DEPLOYMENT_ID"));
  const defaultSchema = resolveDefaultPonderDatabaseSchema(env);
  const ponderNetwork = readEnv(env, "PONDER_NETWORK");
  const liveProtocolSchemaPreferred =
    LIVE_PONDER_NETWORKS.has(ponderNetwork) &&
    protocolDeploymentSchema !== undefined &&
    !isTruthyEnv(readEnv(env, LIVE_SCHEMA_OVERRIDE_FLAG));
  const isLegacyDatabaseSchema =
    rateloopSchema === undefined && databaseSchema === LEGACY_PONDER_DATABASE_SCHEMA;
  const ignoredLiveSchemaOverride =
    liveProtocolSchemaPreferred &&
    (rateloopSchema !== undefined || (databaseSchema !== undefined && !isLegacyDatabaseSchema));

  if (!liveProtocolSchemaPreferred) {
    assertLiveSchemaOverrideSafe({
      env,
      schema: rateloopSchema,
      source: "RATELOOP_PONDER_DATABASE_SCHEMA",
    });
    if (!isLegacyDatabaseSchema) {
      assertLiveSchemaOverrideSafe({
        env,
        schema: databaseSchema,
        source: "DATABASE_SCHEMA",
      });
    }
  }

  const schema =
    (liveProtocolSchemaPreferred ? undefined : rateloopSchema) ??
    (liveProtocolSchemaPreferred || isLegacyDatabaseSchema ? undefined : databaseSchema) ??
    protocolDeploymentSchema ??
    railwaySchema ??
    defaultSchema;

  assertValidPonderSchemaName(schema);

  return {
    schema,
    source:
      liveProtocolSchemaPreferred
        ? "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY"
        : rateloopSchema !== undefined
        ? "RATELOOP_PONDER_DATABASE_SCHEMA"
        : databaseSchema !== undefined && !isLegacyDatabaseSchema
          ? "DATABASE_SCHEMA"
          : protocolDeploymentSchema !== undefined
            ? "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY"
            : railwaySchema !== undefined
              ? "RAILWAY_DEPLOYMENT_ID"
              : "default",
    ignoredLegacyDatabaseSchema: isLegacyDatabaseSchema,
    ignoredLiveSchemaOverride,
  };
}

export function hasSchemaFlag(args) {
  return args.some((arg) => arg === "--schema" || arg.startsWith("--schema="));
}

function readExplicitSchemaFlag(args) {
  const schemas = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--schema") {
      const schema = args[index + 1]?.trim();
      if (!schema || schema.startsWith("--")) {
        throw new Error("--schema requires a non-empty schema name.");
      }
      schemas.push(schema);
      index += 1;
      continue;
    }
    if (arg.startsWith("--schema=")) {
      const schema = arg.slice("--schema=".length).trim();
      if (!schema) {
        throw new Error("--schema requires a non-empty schema name.");
      }
      schemas.push(schema);
    }
  }

  if (schemas.length > 1) {
    throw new Error("Multiple --schema arguments are ambiguous. Pass exactly one schema.");
  }

  return schemas[0];
}

function shouldRequireProtocolSchemaForExplicitCli(env, resolvedSchemaInfo) {
  const ponderNetwork = readEnv(env, "PONDER_NETWORK");
  return (
    LIVE_PONDER_NETWORKS.has(ponderNetwork) &&
    resolvedSchemaInfo.source === "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY" &&
    !isTruthyEnv(readEnv(env, LIVE_SCHEMA_OVERRIDE_FLAG))
  );
}

export function buildPonderStartArgs(args, env = process.env) {
  const explicitSchema = readExplicitSchemaFlag(args);
  if (explicitSchema !== undefined) {
    assertValidPonderSchemaName(explicitSchema);
    const resolvedSchemaInfo = resolvePonderDatabaseSchema(env);
    if (
      shouldRequireProtocolSchemaForExplicitCli(env, resolvedSchemaInfo) &&
      explicitSchema !== resolvedSchemaInfo.schema
    ) {
      throw new Error(
        `--schema=${explicitSchema} does not match live protocol deployment schema ${resolvedSchemaInfo.schema}. ` +
          `Remove the stale schema flag or set ${LIVE_SCHEMA_OVERRIDE_FLAG}=true only for a deliberate recovery override.`,
      );
    }

    return {
      args: ["start", ...args],
      env: {
        ...env,
        DATABASE_SCHEMA: explicitSchema,
      },
      schemaInfo: {
        ...resolvedSchemaInfo,
        expectedSchema: resolvedSchemaInfo.schema,
        schema: explicitSchema,
        source: "--schema",
      },
    };
  }

  const schemaInfo = resolvePonderDatabaseSchema(env);

  return {
    args: ["start", "--schema", schemaInfo.schema, ...args],
    env: {
      ...env,
      DATABASE_SCHEMA: schemaInfo.schema,
    },
    schemaInfo,
  };
}
