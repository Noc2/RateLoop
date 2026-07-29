import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DETERMINISTIC_DECISION_BOUNDARY,
  DETERMINISTIC_DECISION_BOUNDARY_VERSION,
  type SeparatelyLicensedInferenceModule,
} from "~~/lib/tokenless/deterministicDecisionBoundary";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

const PRODUCTION_SOURCE_ROOTS = [
  "packages/nextjs/app",
  "packages/nextjs/components",
  "packages/nextjs/lib",
  "packages/nextjs/scripts",
  "packages/agents/src",
  "packages/contracts/src",
  "packages/keeper/src",
  "packages/node-utils/src",
  "packages/ponder/src",
  "packages/promo-video/src",
  "packages/sdk/src",
  "packages/foundry/scripts-js",
  "scripts",
] as const;

const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const FORBIDDEN_INFERENCE_PACKAGES = new Set([
  "ai",
  "cohere-ai",
  "groq-sdk",
  "langchain",
  "llamaindex",
  "mistralai",
  "ollama",
  "openai",
  "replicate",
  "together-ai",
  "@anthropic-ai/sdk",
  "@aws-sdk/client-bedrock-runtime",
  "@azure-rest/ai-inference",
  "@azure/openai",
  "@google-cloud/vertexai",
  "@google/generative-ai",
  "@google/genai",
  "@huggingface/inference",
  "@huggingface/transformers",
  "@mlc-ai/web-llm",
  "@xenova/transformers",
  "onnxruntime-node",
  "onnxruntime-web",
  "transformers.js",
]);
const FORBIDDEN_INFERENCE_PACKAGE_PREFIXES = ["@ai-sdk/", "@langchain/", "@llamaindex/", "@tensorflow/"] as const;

const FORBIDDEN_REMOTE_MODEL_ENDPOINTS = [
  /api\.openai\.com/iu,
  /api\.anthropic\.com/iu,
  /generativelanguage\.googleapis\.com/iu,
  /aiplatform\.googleapis\.com/iu,
  /bedrock-runtime\.[a-z0-9-]+\.amazonaws\.com/iu,
  /api\.mistral\.ai/iu,
  /api\.cohere\.com/iu,
  /api-inference\.huggingface\.co/iu,
  /api\.replicate\.com/iu,
  /api\.together\.xyz/iu,
  /api\.groq\.com/iu,
  /localhost:11434/iu,
  /\/v1\/(?:chat\/completions|responses|embeddings)\b/iu,
  /:generateContent\b/iu,
  /\/invoke-model\b/iu,
] as const;

const FORBIDDEN_MODEL_CONFIGURATION = [
  /\bOPENAI_API_KEY\b/u,
  /\bANTHROPIC_API_KEY\b/u,
  /\bAZURE_OPENAI_(?:API_KEY|ENDPOINT)\b/u,
  /\bBEDROCK_(?:MODEL_ID|REGION)\b/u,
  /\bGOOGLE_GENERATIVE_AI_API_KEY\b/u,
  /\bGEMINI_API_KEY\b/u,
  /\bMISTRAL_API_KEY\b/u,
  /\bCOHERE_API_KEY\b/u,
  /\bGROQ_API_KEY\b/u,
  /\bOLLAMA_HOST\b/u,
  /\bREPLICATE_API_TOKEN\b/u,
  /\bTOGETHER_API_KEY\b/u,
  /\b(?:INFERENCE|LLM|MODEL)_(?:API_KEY|BASE_URL|ENDPOINT)\b/u,
] as const;

const FORBIDDEN_MODEL_CALLS = [
  /\.chat\.completions\.create\s*\(/u,
  /\b(?:llm|model)(?:Inference|Judge|Score|Triage)\s*\(/u,
] as const;

function repositoryPath(path: string) {
  return resolve(REPOSITORY_ROOT, path);
}

function relativePath(path: string) {
  return relative(REPOSITORY_ROOT, path).split(sep).join("/");
}

function extension(path: string) {
  const match = /(\.[^.]+)$/u.exec(path);
  return match?.[1] ?? "";
}

function productionFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const entry = statSync(path);
    if (entry.isDirectory()) {
      if (name === "dist" || name === "node_modules") continue;
      result.push(...productionFiles(path));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(extension(name)) && !/\.(?:e2e|interaction|property|test)\.[cm]?[jt]sx?$/u.test(name)) {
      result.push(path);
    }
  }
  return result;
}

function importedModuleSpecifiers(source: string) {
  const specifiers = new Set<string>();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/gu,
    /\bimport\s*["']([^"']+)["']/gu,
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]!);
  }
  return [...specifiers];
}

function isInferencePackage(specifier: string) {
  return (
    [...FORBIDDEN_INFERENCE_PACKAGES].some(
      inferencePackage => specifier === inferencePackage || specifier.startsWith(`${inferencePackage}/`),
    ) || FORBIDDEN_INFERENCE_PACKAGE_PREFIXES.some(prefix => specifier.startsWith(prefix))
  );
}

function allPackageManifests() {
  const manifests = [repositoryPath("package.json")];
  const packagesRoot = repositoryPath("packages");
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = join(packagesRoot, entry.name, "package.json");
    if (existsSync(manifest)) manifests.push(manifest);
  }
  return manifests;
}

function packageDependencies(manifestPath: string) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const dependencies = new Map<string, string>();
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const entries = manifest[section];
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
    for (const [dependency, version] of Object.entries(entries)) {
      dependencies.set(dependency, typeof version === "string" ? version : "");
    }
  }
  return [...dependencies].map(([name, version]) => ({ name, version }));
}

function npmAliasTarget(version: string) {
  if (!version.startsWith("npm:")) return null;
  const target = version.slice(4);
  if (target.startsWith("@")) {
    const scopeSeparator = target.indexOf("/");
    if (scopeSeparator === -1) return null;
    const versionSeparator = target.indexOf("@", scopeSeparator);
    return versionSeparator === -1 ? target : target.slice(0, versionSeparator);
  }
  const versionSeparator = target.indexOf("@");
  return versionSeparator === -1 ? target : target.slice(0, versionSeparator);
}

function assertSeparateInferenceBoundary(inferenceModule: SeparatelyLicensedInferenceModule) {
  assert.equal(inferenceModule.enabledByDefault, false, `${inferenceModule.sourceRoot} must stay off by default`);
  assert.equal(
    inferenceModule.licenseMode,
    "separate_contract_required",
    `${inferenceModule.sourceRoot} must require a separate contract`,
  );
  assert.match(inferenceModule.sourceRoot, /^packages\/[a-z0-9._-]+$/u);
  assert.equal(
    dirname(inferenceModule.manifestPath),
    inferenceModule.sourceRoot,
    `${inferenceModule.sourceRoot} must own its dependency manifest`,
  );
  assert.match(inferenceModule.activationEnvironmentVariable, /^[A-Z][A-Z0-9_]*_ENABLED$/u);

  for (const path of [
    inferenceModule.assessmentDocumentPath,
    inferenceModule.boundarySourcePath,
    inferenceModule.defaultConfigurationPath,
    inferenceModule.manifestPath,
    inferenceModule.sourceRoot,
  ]) {
    assert.ok(existsSync(repositoryPath(path)), `missing separate inference boundary artifact: ${path}`);
  }
  assert.ok(
    DETERMINISTIC_DECISION_BOUNDARY.coreModules.every(
      core => !core.path.startsWith(`${inferenceModule.sourceRoot}/`) && core.path !== inferenceModule.sourceRoot,
    ),
    `${inferenceModule.sourceRoot} must not contain a deterministic core decision module`,
  );

  const boundary = readFileSync(repositoryPath(inferenceModule.boundarySourcePath), "utf8");
  assert.match(boundary, /\bINFERENCE_MODULE_ENABLED_BY_DEFAULT\s*=\s*false\b/u);
  assert.match(boundary, /\bINFERENCE_MODULE_REQUIRES_SEPARATE_LICENSE\s*=\s*true\b/u);
  assert.match(boundary, new RegExp(`\\b${inferenceModule.activationEnvironmentVariable}\\b`, "u"));

  const configuration = readFileSync(repositoryPath(inferenceModule.defaultConfigurationPath), "utf8");
  assert.match(configuration, new RegExp(`^${inferenceModule.activationEnvironmentVariable}=false$`, "mu"));

  const assessment = readFileSync(repositoryPath(inferenceModule.assessmentDocumentPath), "utf8");
  assert.match(assessment, /Article 3\(1\)/iu);
  assert.match(assessment, /high-risk/iu);
}

test("reviewer scoring, routing, and triage stay bound to declared deterministic implementations", () => {
  assert.equal(DETERMINISTIC_DECISION_BOUNDARY.schemaVersion, DETERMINISTIC_DECISION_BOUNDARY_VERSION);
  assert.equal(DETERMINISTIC_DECISION_BOUNDARY.coreInferenceMode, "forbidden");
  assert.deepEqual(
    new Set(DETERMINISTIC_DECISION_BOUNDARY.coreModules.map(module => module.role)),
    new Set(["reviewer_scoring", "routing", "triage"]),
  );
  assert.equal(
    new Set(DETERMINISTIC_DECISION_BOUNDARY.coreModules.map(module => module.path)).size,
    DETERMINISTIC_DECISION_BOUNDARY.coreModules.length,
  );

  for (const decisionModule of DETERMINISTIC_DECISION_BOUNDARY.coreModules) {
    const path = repositoryPath(decisionModule.path);
    assert.ok(existsSync(path), `missing deterministic decision module: ${decisionModule.path}`);
    const source = readFileSync(path, "utf8");
    for (const marker of decisionModule.requiredSourceMarkers) {
      assert.ok(source.includes(marker), `${decisionModule.path} lost deterministic source marker: ${marker}`);
    }
  }
});

test("production code cannot add an inference SDK, remote model call, or model credential to the core", () => {
  for (const inferenceModule of DETERMINISTIC_DECISION_BOUNDARY.separatelyLicensedInferenceModules) {
    assertSeparateInferenceBoundary(inferenceModule);
  }
  const licensedRoots = DETERMINISTIC_DECISION_BOUNDARY.separatelyLicensedInferenceModules.map(module =>
    repositoryPath(module.sourceRoot),
  );
  const files = PRODUCTION_SOURCE_ROOTS.flatMap(root => productionFiles(repositoryPath(root))).filter(
    path => !licensedRoots.some(root => path === root || path.startsWith(`${root}${sep}`)),
  );
  assert.ok(files.length > 100, "the deterministic inference gate did not discover the production source tree");

  for (const path of files) {
    const source = readFileSync(path, "utf8");
    const displayPath = relativePath(path);
    for (const specifier of importedModuleSpecifiers(source)) {
      assert.equal(
        isInferencePackage(specifier),
        false,
        `${displayPath} imports inference package ${specifier}; core inference is forbidden`,
      );
    }
    for (const pattern of FORBIDDEN_REMOTE_MODEL_ENDPOINTS) {
      assert.doesNotMatch(source, pattern, `${displayPath} contains a remote model endpoint`);
    }
    for (const pattern of FORBIDDEN_MODEL_CONFIGURATION) {
      assert.doesNotMatch(source, pattern, `${displayPath} contains a model credential or endpoint setting`);
    }
    for (const pattern of FORBIDDEN_MODEL_CALLS) {
      assert.doesNotMatch(source, pattern, `${displayPath} contains a model inference call`);
    }
  }
});

test("workspace manifests cannot make inference dependencies available to deterministic core code", () => {
  const licensedManifests = new Set(
    DETERMINISTIC_DECISION_BOUNDARY.separatelyLicensedInferenceModules.map(module =>
      repositoryPath(module.manifestPath),
    ),
  );
  for (const manifest of allPackageManifests()) {
    for (const dependency of packageDependencies(manifest)) {
      const aliasTarget = npmAliasTarget(dependency.version);
      if (!isInferencePackage(dependency.name) && (!aliasTarget || !isInferencePackage(aliasTarget))) continue;
      assert.ok(
        licensedManifests.has(manifest),
        `${relativePath(manifest)} declares inference dependency ${aliasTarget ?? dependency.name} without a separate licensed boundary`,
      );
    }
  }
});
