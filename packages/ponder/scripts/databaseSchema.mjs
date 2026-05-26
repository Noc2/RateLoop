import { createHash } from "node:crypto";

export const DEFAULT_PONDER_DATABASE_SCHEMA = "rateloop_ponder";
export const LEGACY_PONDER_DATABASE_SCHEMA = "ponder";

const SCHEMA_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_PONDER_DATABASE_SCHEMA_LENGTH = 45;
const RAILWAY_DATABASE_SCHEMA_PREFIX = "railway_";
const DEFAULT_PONDER_DATABASE_SCHEMA_BY_NETWORK = {
  hardhat: "rateloop_ponder_hardhat",
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

export function resolvePonderDatabaseSchema(env = process.env) {
  const rateloopSchema = readEnv(env, "RATELOOP_PONDER_DATABASE_SCHEMA");
  const databaseSchema = readEnv(env, "DATABASE_SCHEMA");
  const railwaySchema = schemaFromRailwayDeploymentId(readEnv(env, "RAILWAY_DEPLOYMENT_ID"));
  const defaultSchema = resolveDefaultPonderDatabaseSchema(env);
  const isLegacyDatabaseSchema =
    rateloopSchema === undefined && databaseSchema === LEGACY_PONDER_DATABASE_SCHEMA;
  const schema =
    rateloopSchema ??
    (isLegacyDatabaseSchema ? undefined : databaseSchema) ??
    railwaySchema ??
    defaultSchema;

  if (!SCHEMA_NAME_PATTERN.test(schema)) {
    throw new Error(
      `Invalid Ponder database schema "${schema}". Use letters, numbers, and underscores, starting with a letter or underscore.`,
    );
  }

  return {
    schema,
    source:
      rateloopSchema !== undefined
        ? "RATELOOP_PONDER_DATABASE_SCHEMA"
        : databaseSchema !== undefined && !isLegacyDatabaseSchema
          ? "DATABASE_SCHEMA"
          : railwaySchema !== undefined
            ? "RAILWAY_DEPLOYMENT_ID"
          : "default",
    ignoredLegacyDatabaseSchema: isLegacyDatabaseSchema,
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
