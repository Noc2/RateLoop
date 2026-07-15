import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "config/tokenless-eu-deployment.json");
const vercelConfigPath = path.join(root, "packages/nextjs/vercel.json");
const railwayConfigPaths = [
  path.join(root, "packages/keeper/railway.toml"),
  path.join(root, "packages/ponder/railway.toml"),
];

export const TOKENLESS_EU_MANIFEST_SCHEMA = "rateloop-eu-deployment-v1";
export const TOKENLESS_HOME_REGION = "eu";
export const TOKENLESS_VERCEL_REGION = "fra1";
export const TOKENLESS_RAILWAY_REGION = "europe-west4-drams3a";
export const TOKENLESS_VERCEL_PROJECT_ID = "prj_H6C2pfWKEAupFroHbLfzhquaNCLm";
const EXPECTED_RESOURCE_REGIONS = Object.freeze({
  webCompute: TOKENLESS_VERCEL_REGION,
  railwayProject: TOKENLESS_RAILWAY_REGION,
  postgres: TOKENLESS_RAILWAY_REGION,
  objectStorage: TOKENLESS_VERCEL_REGION,
  kms: TOKENLESS_HOME_REGION,
  keeperWorker: TOKENLESS_RAILWAY_REGION,
  ponderWorker: TOKENLESS_RAILWAY_REGION,
  logs: TOKENLESS_HOME_REGION,
  backups: TOKENLESS_HOME_REGION,
  auth: TOKENLESS_HOME_REGION,
  supportAccess: TOKENLESS_HOME_REGION,
});
const REQUIRED_PROCESSORS = Object.freeze([
  "email",
  "billing",
  "analytics",
  "rpc",
]);

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

export function validateTokenlessEuDeployment({
  env = process.env,
  sandbox = value(env, "TOKENLESS_SANDBOX_MODE").toLowerCase() === "true",
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
    manifest.mode !== "verified-eu"
  ) {
    errors.push(
      "EU deployment manifest must describe only the tokenless EU deployment line.",
    );
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
  for (const [index, toml] of railwayConfigs.entries()) {
    const regions = configuredRailwayRegions(toml);
    if (
      regions.length !== 1 ||
      regions[0].region !== TOKENLESS_RAILWAY_REGION ||
      regions[0].replicas < 1
    ) {
      errors.push(
        `Railway service ${index + 1} must run only in ${TOKENLESS_RAILWAY_REGION}.`,
      );
    }
  }
  if (sandbox) return errors;

  if (value(env, "TOKENLESS_DATA_PLANE_MODE") !== "verified-eu") {
    errors.push(
      "TOKENLESS_DATA_PLANE_MODE must be verified-eu outside the explicit sandbox.",
    );
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
        `${resource.resourceIdEnv} must identify the verified EU ${name} resource.`,
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
    if (value(env, resource.regionEnv) !== resource.region) {
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
  const sandbox = process.argv.includes("--sandbox");
  const errors = validateTokenlessEuDeployment({ sandbox });
  if (errors.length > 0)
    throw new Error(
      `Tokenless EU deployment validation refused:\n- ${errors.join("\n- ")}`,
    );
  console.log(
    sandbox
      ? "Tokenless sandbox static EU controls passed."
      : "Tokenless verified EU deployment passed.",
  );
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
