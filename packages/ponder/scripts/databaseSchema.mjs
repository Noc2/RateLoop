import { createHash } from "node:crypto";
import { PONDER_NETWORK_CHAIN_IDS } from "../src/protocol-deployment.ts";

export const DEFAULT_PONDER_DATABASE_SCHEMA = "rateloop_ponder";
export const LEGACY_PONDER_DATABASE_SCHEMA = "ponder";

const SCHEMA_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_PONDER_DATABASE_SCHEMA_LENGTH = 45;
const RAILWAY_DATABASE_SCHEMA_PREFIX = "railway_";
const PROTOCOL_DEPLOYMENT_DATABASE_SCHEMA_PREFIX = "rateloop_deployment_";
/** Shared static schemas that collide with Ponder app identity after upgrades. */
const DEPRECATED_STATIC_RAILWAY_SCHEMAS = new Set(["rateloop_ponder_worldchain_canary"]);
const DEFAULT_PONDER_DATABASE_SCHEMA_BY_NETWORK = {
  hardhat: "rateloop_ponder_hardhat",
  baseSepolia: "rateloop_ponder_base_sepolia",
  base: "rateloop_ponder_base",
  worldchainSepolia: "rateloop_ponder_worldchain_sepolia",
  worldchain: "rateloop_ponder_worldchain",
};
function readEnv(env, key) {
  const value = env[key]?.trim();
  return value ? value : undefined;
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

function resolveChainId(env) {
  const ponderNetwork = readEnv(env, "PONDER_NETWORK");
  const networkChainId = PONDER_NETWORK_CHAIN_IDS[ponderNetwork];
  const explicitChainId = Number.parseInt(readEnv(env, "PONDER_CHAIN_ID") ?? "", 10);
  if (Number.isSafeInteger(explicitChainId) && explicitChainId > 0) {
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

export function protocolDeploymentKeyFromEnv(env = process.env) {
  const explicitKey = readEnv(env, "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY")
    ?? readEnv(env, "RATELOOP_PROTOCOL_DEPLOYMENT_KEY");
  if (explicitKey) return explicitKey.toLowerCase();

  const chainId = resolveChainId(env);
  const contentRegistryAddress = normalizeAddress(readEnv(env, "PONDER_CONTENT_REGISTRY_ADDRESS"));
  const feedbackRegistryAddress = normalizeAddress(readEnv(env, "PONDER_FEEDBACK_REGISTRY_ADDRESS"));
  if (!chainId || !contentRegistryAddress || !feedbackRegistryAddress) return undefined;

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

function isDeprecatedStaticRailwaySchema(schema) {
  return schema !== undefined && DEPRECATED_STATIC_RAILWAY_SCHEMAS.has(schema);
}

export function resolvePonderDatabaseSchema(env = process.env) {
  const rateloopSchema = readEnv(env, "RATELOOP_PONDER_DATABASE_SCHEMA");
  const databaseSchema = readEnv(env, "DATABASE_SCHEMA");
  const protocolDeploymentKey = protocolDeploymentKeyFromEnv(env);
  const protocolDeploymentSchema = schemaFromProtocolDeploymentKey(protocolDeploymentKey);
  const railwaySchema = schemaFromRailwayDeploymentId(readEnv(env, "RAILWAY_DEPLOYMENT_ID"));
  const defaultSchema = resolveDefaultPonderDatabaseSchema(env);
  const canReplaceDeprecatedStaticSchema = railwaySchema !== undefined || protocolDeploymentSchema !== undefined;
  const ignoredDeprecatedStaticSchema =
    canReplaceDeprecatedStaticSchema &&
    (isDeprecatedStaticRailwaySchema(rateloopSchema) || isDeprecatedStaticRailwaySchema(databaseSchema));
  const effectiveRateloopSchema =
    canReplaceDeprecatedStaticSchema && isDeprecatedStaticRailwaySchema(rateloopSchema) ? undefined : rateloopSchema;
  const effectiveDatabaseSchema =
    canReplaceDeprecatedStaticSchema && isDeprecatedStaticRailwaySchema(databaseSchema) ? undefined : databaseSchema;
  const isLegacyDatabaseSchema =
    effectiveRateloopSchema === undefined && effectiveDatabaseSchema === LEGACY_PONDER_DATABASE_SCHEMA;
  const schema =
    effectiveRateloopSchema ??
    (isLegacyDatabaseSchema ? undefined : effectiveDatabaseSchema) ??
    railwaySchema ??
    protocolDeploymentSchema ??
    defaultSchema;

  if (!SCHEMA_NAME_PATTERN.test(schema)) {
    throw new Error(
      `Invalid Ponder database schema "${schema}". Use letters, numbers, and underscores, starting with a letter or underscore.`,
    );
  }

  return {
    schema,
    source:
      effectiveRateloopSchema !== undefined
        ? "RATELOOP_PONDER_DATABASE_SCHEMA"
        : effectiveDatabaseSchema !== undefined && !isLegacyDatabaseSchema
          ? "DATABASE_SCHEMA"
          : railwaySchema !== undefined
            ? "RAILWAY_DEPLOYMENT_ID"
            : protocolDeploymentSchema !== undefined
              ? "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY"
              : "default",
    ignoredLegacyDatabaseSchema: isLegacyDatabaseSchema,
    ignoredDeprecatedStaticSchema,
  };
}

export function hasSchemaFlag(args) {
  return args.some((arg) => arg === "--schema" || arg.startsWith("--schema="));
}

export function buildPonderStartArgs(args, env = process.env) {
  if (hasSchemaFlag(args)) {
    return {
      args: ["start", ...args],
      env,
      schemaInfo: null,
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
