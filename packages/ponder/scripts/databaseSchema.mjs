import { createHash } from "node:crypto";

const SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function schemaFromTokenlessDeploymentKey(deploymentKey) {
  const key = deploymentKey?.trim().toLowerCase();
  if (!key?.startsWith("tokenless-v1:")) throw new Error("A tokenless-v1 deployment key is required.");
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `rateloop_tokenless_${digest}`;
}

export function resolvePonderDatabaseSchema(env = process.env) {
  const deploymentKey = env.RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY?.trim();
  if (!deploymentKey) throw new Error("RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY is required.");
  const expected = schemaFromTokenlessDeploymentKey(deploymentKey);
  const override = env.RATELOOP_PONDER_DATABASE_SCHEMA?.trim() || env.DATABASE_SCHEMA?.trim();
  if (override && env.RATELOOP_PONDER_ALLOW_SCHEMA_OVERRIDE !== "true" && override !== expected) {
    throw new Error(`Database schema override must match tokenless deployment schema ${expected}.`);
  }
  const schema = override ?? expected;
  if (!SCHEMA_PATTERN.test(schema)) throw new Error("Invalid Ponder database schema name.");
  return schema;
}
