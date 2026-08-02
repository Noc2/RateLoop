import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "config/tokenless-eu-deployment.json");
const vercelConfigPath = path.join(root, "packages/nextjs/vercel.json");

export const TOKENLESS_RAILWAY_SERVICE_CONFIGS = Object.freeze([
  Object.freeze({
    serviceName: "tokenless-keeper",
    configFile: "/packages/keeper/railway.toml",
    dockerfilePath: "packages/keeper/Dockerfile",
    healthcheckPath: "/ready",
    healthcheckTimeout: 120,
    startCommand: "yarn start:built-dist",
  }),
  Object.freeze({
    serviceName: "tokenless-ponder",
    configFile: "/packages/ponder/railway.toml",
    dockerfilePath: "packages/ponder/Dockerfile",
    healthcheckPath: "/health/tokenless",
    healthcheckTimeout: 1800,
    startCommand: "yarn start",
  }),
]);
const railwayConfigPaths = TOKENLESS_RAILWAY_SERVICE_CONFIGS.map((service) =>
  path.join(root, service.configFile.slice(1)),
);

export const TOKENLESS_EU_MANIFEST_SCHEMA = "rateloop-processing-region-v2";
export const TOKENLESS_HOME_REGION = "eu";
export const TOKENLESS_VERCEL_REGION = "fra1";
export const TOKENLESS_RAILWAY_REGION = "europe-west4-drams3a";
export const TOKENLESS_VERCEL_PROJECT_ID = "prj_H6C2pfWKEAupFroHbLfzhquaNCLm";
const EXPECTED_RESOURCE_REGIONS = Object.freeze({
  webCompute: TOKENLESS_VERCEL_REGION,
  postgres: TOKENLESS_RAILWAY_REGION,
  objectStorage: TOKENLESS_VERCEL_REGION,
  keeperWorker: TOKENLESS_RAILWAY_REGION,
  ponderWorker: TOKENLESS_RAILWAY_REGION,
  logs: TOKENLESS_HOME_REGION,
  auth: TOKENLESS_HOME_REGION,
});
const REQUIRED_RESOURCES = Object.freeze([
  "webCompute",
  "railwayProject",
  "postgres",
  "objectStorage",
  "platformSecrets",
  "keeperWorker",
  "ponderWorker",
  "logs",
  "backups",
  "auth",
]);
const REQUIRED_PROCESSORS = Object.freeze(["email", "billing", "rpc"]);

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export const tokenlessEuDeploymentManifest = Object.freeze(
  readJson(manifestPath),
);

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalManifestContent(
  manifest = tokenlessEuDeploymentManifest,
) {
  const { integrity: _integrity, ...content } = manifest;
  return canonicalize(content);
}

export function manifestDigest(manifest = tokenlessEuDeploymentManifest) {
  return createHash("sha256")
    .update(canonicalManifestContent(manifest))
    .digest("hex");
}

function value(env, name) {
  return env[name]?.trim() || "";
}

function safeResourceId(raw) {
  return (
    raw.length >= 6 &&
    !/(?:placeholder|example|legacy|rate-loop-nextjs|rateloop\.ai|us-east|iad1)/iu.test(
      raw,
    )
  );
}

function configuredRailwayRegions(toml) {
  const block =
    toml.match(/\[deploy\.multiRegionConfig\]([\s\S]*?)(?:\n\[|$)/u)?.[1] ?? "";
  return [
    ...block.matchAll(
      /^\s*"([a-z0-9-]+)"\s*=\s*\{\s*numReplicas\s*=\s*([1-9]\d*)\s*\}\s*$/gmu,
    ),
  ].map((match) => ({ region: match[1], replicas: Number(match[2]) }));
}

function configuredTomlString(toml, key) {
  return (
    toml.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"\\s*$`, "mu"))?.[1] ??
    ""
  );
}

function configuredTomlInteger(toml, key) {
  const raw = toml.match(
    new RegExp(`^\\s*${key}\\s*=\\s*([1-9]\\d*)\\s*$`, "mu"),
  )?.[1];
  return raw ? Number(raw) : 0;
}

export function validateTokenlessEuDeployment({
  env = process.env,
  manifest = tokenlessEuDeploymentManifest,
  vercelConfig = readJson(vercelConfigPath),
  railwayConfigs = railwayConfigPaths.map((file) => readFileSync(file, "utf8")),
} = {}) {
  const errors = [];
  if (manifest.schemaVersion !== TOKENLESS_EU_MANIFEST_SCHEMA) {
    errors.push(
      `EU deployment manifest schema must be ${TOKENLESS_EU_MANIFEST_SCHEMA}.`,
    );
  }
  if (
    manifest.deploymentLine !== "tokenless" ||
    manifest.homeRegion !== TOKENLESS_HOME_REGION ||
    manifest.mode !== "eu-processing-region"
  ) {
    errors.push(
      "Processing-region manifest must describe only the tokenless EU processing line.",
    );
  }
  if (
    manifest.claimBoundary?.transferSafeguard !==
      "standard-contractual-clauses" ||
    manifest.claimBoundary?.validation !== "signed-static-configuration-only" ||
    manifest.claimBoundary?.providerStateQueried !== false ||
    !Array.isArray(manifest.claimBoundary?.excluded) ||
    !manifest.claimBoundary.excluded.some((value) =>
      /control-plane/iu.test(value),
    ) ||
    !manifest.claimBoundary.excluded.some((value) => /backups/iu.test(value))
  ) {
    errors.push(
      "Processing-region manifest must disclose control-plane and backup exclusions, SCC safeguards, and its static-validation boundary.",
    );
  }
  if (manifest.resources?.supportAccess) {
    errors.push(
      "Processing-region manifest must not claim unimplemented support-access controls.",
    );
  }
  if (manifest.externalProcessors?.analytics) {
    errors.push(
      "Processing-region manifest must not inventory an analytics processor that is not used.",
    );
  }
  for (const resource of REQUIRED_RESOURCES) {
    if (!manifest.resources?.[resource]?.resourceIdEnv) {
      errors.push(
        `Processing-region manifest must inventory the ${resource} resource.`,
      );
    }
  }
  for (const [name, expectedRegion] of Object.entries(
    EXPECTED_RESOURCE_REGIONS,
  )) {
    if (manifest.resources?.[name]?.region !== expectedRegion) {
      errors.push(
        `EU deployment manifest ${name} region must be ${expectedRegion}.`,
      );
    }
  }
  for (const processor of REQUIRED_PROCESSORS) {
    if (!manifest.externalProcessors?.[processor]?.evidenceEnv) {
      errors.push(
        `EU deployment manifest must inventory the ${processor} processor.`,
      );
    }
  }
  if (
    manifest.publicChainExceptions?.length !== 1 ||
    manifest.publicChainExceptions[0]?.network !== "base-sepolia" ||
    manifest.publicChainExceptions[0]?.erasable !== false ||
    manifest.publicChainExceptions[0]?.customerContentAllowed !== false
  ) {
    errors.push(
      "EU deployment manifest must retain the exact Base Sepolia public-chain exception.",
    );
  }
  const digest = manifestDigest(manifest);
  if (
    manifest.integrity?.algorithm !== "SHA-256" ||
    manifest.integrity?.canonicalContentSha256 !== digest
  ) {
    errors.push(
      "EU deployment manifest integrity digest does not match its canonical content.",
    );
  }
  if (
    manifest.signature?.algorithm !== "Ed25519" ||
    manifest.signature?.publicKeyEnv !==
      "TOKENLESS_EU_MANIFEST_SIGNING_PUBLIC_KEY" ||
    manifest.signature?.signatureEnv !== "TOKENLESS_EU_MANIFEST_SIGNATURE"
  ) {
    errors.push(
      "EU deployment manifest must declare the approved Ed25519 signature boundary.",
    );
  }

  const vercelRegions = vercelConfig?.regions;
  if (
    !Array.isArray(vercelRegions) ||
    vercelRegions.length !== 1 ||
    vercelRegions[0] !== TOKENLESS_VERCEL_REGION
  ) {
    errors.push(
      `Vercel functions must be pinned only to ${TOKENLESS_VERCEL_REGION}.`,
    );
  }
  for (const [index, service] of TOKENLESS_RAILWAY_SERVICE_CONFIGS.entries()) {
    const toml = railwayConfigs[index] ?? "";
    const regions = configuredRailwayRegions(toml);
    if (
      regions.length !== 1 ||
      regions[0].region !== TOKENLESS_RAILWAY_REGION ||
      regions[0].replicas < 1
    ) {
      errors.push(
        `Railway ${service.serviceName} must run only in ${TOKENLESS_RAILWAY_REGION}.`,
      );
    }
    if (
      configuredTomlString(toml, "builder") !== "DOCKERFILE" ||
      configuredTomlString(toml, "dockerfilePath") !== service.dockerfilePath
    ) {
      errors.push(
        `Railway ${service.serviceName} must build from ${service.dockerfilePath} via ${service.configFile}.`,
      );
    }
    if (
      configuredTomlString(toml, "startCommand") !== service.startCommand ||
      configuredTomlString(toml, "healthcheckPath") !==
        service.healthcheckPath ||
      configuredTomlInteger(toml, "healthcheckTimeout") !==
        service.healthcheckTimeout
    ) {
      errors.push(
        `Railway ${service.serviceName} must retain its checked start command and ${service.healthcheckPath} health check.`,
      );
    }
  }
  if (value(env, "TOKENLESS_DATA_PLANE_MODE") !== "eu-processing-region") {
    errors.push("TOKENLESS_DATA_PLANE_MODE must be eu-processing-region.");
  }
  if (value(env, "TOKENLESS_HOME_REGION") !== TOKENLESS_HOME_REGION) {
    errors.push(`TOKENLESS_HOME_REGION must be ${TOKENLESS_HOME_REGION}.`);
  }
  if (value(env, "TOKENLESS_EU_MANIFEST_SHA256") !== digest) {
    errors.push(
      "TOKENLESS_EU_MANIFEST_SHA256 must match the checked deployment manifest.",
    );
  }

  for (const [name, resource] of Object.entries(manifest.resources ?? {})) {
    const resourceId = value(env, resource.resourceIdEnv);
    if (!safeResourceId(resourceId)) {
      errors.push(
        `${resource.resourceIdEnv} must identify the configured ${name} resource.`,
      );
    }
    if (
      resource.expectedResourceId &&
      resourceId !== resource.expectedResourceId
    ) {
      errors.push(
        `${resource.resourceIdEnv} must match the isolated tokenless resource.`,
      );
    }
    if (
      resource.regionEnv &&
      value(env, resource.regionEnv) !== resource.region
    ) {
      errors.push(`${resource.regionEnv} must be ${resource.region}.`);
    }
    if (
      resource.accessEnv &&
      value(env, resource.accessEnv) !== resource.expectedAccess
    ) {
      errors.push(`${resource.accessEnv} must be ${resource.expectedAccess}.`);
    }
    if (
      resource.providerEnv &&
      (!Array.isArray(resource.allowedProviders) ||
        !resource.allowedProviders.includes(value(env, resource.providerEnv)))
    ) {
      errors.push(
        `${resource.providerEnv} must select an approved managed provider.`,
      );
    }
  }
  for (const [name, processor] of Object.entries(
    manifest.externalProcessors ?? {},
  )) {
    if (!safeResourceId(value(env, processor.evidenceEnv))) {
      errors.push(
        `${processor.evidenceEnv} must identify approved ${name} processor evidence.`,
      );
    }
    if (
      processor.deliveryRegionEnv &&
      value(env, processor.deliveryRegionEnv) !== processor.deliveryRegion
    ) {
      errors.push(
        `${processor.deliveryRegionEnv} must be ${processor.deliveryRegion}.`,
      );
    }
  }

  try {
    const publicKeyRaw = value(env, manifest.signature.publicKeyEnv).replaceAll(
      "\\n",
      "\n",
    );
    const publicKey = publicKeyRaw.includes("BEGIN PUBLIC KEY")
      ? createPublicKey(publicKeyRaw)
      : createPublicKey({
          key: Buffer.from(publicKeyRaw, "base64url"),
          format: "der",
          type: "spki",
        });
    const signature = Buffer.from(
      value(env, manifest.signature.signatureEnv),
      "base64url",
    );
    if (
      publicKey.asymmetricKeyType !== "ed25519" ||
      !verify(null, Buffer.from(digest, "hex"), publicKey, signature)
    ) {
      throw new Error("invalid signature");
    }
  } catch {
    errors.push(
      "TOKENLESS_EU_MANIFEST_SIGNATURE must verify the manifest digest with the approved Ed25519 key.",
    );
  }
  return errors;
}

function main() {
  const errors = validateTokenlessEuDeployment();
  if (errors.length > 0)
    throw new Error(
      `Tokenless EU deployment validation refused:\n- ${errors.join("\n- ")}`,
    );
  console.log("Tokenless EU processing-region configuration passed.");
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Tokenless EU deployment validation failed.",
    );
    process.exitCode = 1;
  }
}
