import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TOKENLESS_BASE_SEPOLIA_CHAIN_ID,
  TOKENLESS_DEPLOYMENT_SCHEMA,
  validateTokenlessDeploymentArtifact,
} from "./tokenlessDeployment.js";
import { compiledBeaconVerifierRuntimeCodeHash } from "./exportTokenlessDeploymentFromBroadcast.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const foundryRoot = join(scriptDirectory, "..");
const workspaceRoot = join(foundryRoot, "..", "..");

const ABI_EXPORT_NAMES = {
  CredentialIssuer: "CredentialIssuerAbi",
  TokenlessFeedbackBonus: "TokenlessFeedbackBonusAbi",
  TokenlessPanel: "TokenlessPanelAbi",
  TestUSDC: "TokenlessTestUSDCAbi",
  X402PanelSubmitter: "X402PanelSubmitterAbi",
};
const SOURCE_ABI_CONTRACTS = [
  ["CredentialIssuer", { artifact: "CredentialIssuer" }],
  ["TokenlessFeedbackBonus", { artifact: "TokenlessFeedbackBonus" }],
  ["TokenlessPanel", { artifact: "TokenlessPanel" }],
  ["TestUSDC", { artifact: "MockERC20" }],
  ["X402PanelSubmitter", { artifact: "X402PanelSubmitter" }],
];

function generatedHeader() {
  return `/**\n * Generated from ${TOKENLESS_DEPLOYMENT_SCHEMA}.\n * Do not edit manually.\n */\n`;
}

function readCompiledAbi(root, contract) {
  const artifactPath = join(
    root,
    "out",
    `${contract.artifact}.sol`,
    `${contract.artifact}.json`,
  );
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Missing compiled artifact for ${contract.artifact}: ${artifactPath}. Run forge build first.`,
    );
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`Compiled artifact ${artifactPath} has no ABI array.`);
  }
  return artifact.abi;
}

export function buildTokenlessSourceAbiFiles({ abiLoader }) {
  const files = new Map();
  for (const [contractName, contract] of SOURCE_ABI_CONTRACTS) {
    const abi = abiLoader(contractName, contract);
    if (!Array.isArray(abi)) {
      throw new Error(`${contractName} ABI loader did not return an array.`);
    }
    const exportName = ABI_EXPORT_NAMES[contractName];
    files.set(
      `abis/${exportName}.ts`,
      `${generatedHeader()}export const ${exportName} = ${JSON.stringify(
        abi,
        null,
        2,
      )} as const;\n`,
    );
  }
  return files;
}

function writeGeneratedFiles(outputDirectory, files) {
  mkdirSync(outputDirectory, { recursive: true });
  for (const [relativePath, source] of files) {
    const target = join(outputDirectory, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source, "utf8");
  }
}

export function generateTokenlessSourceAbis({
  outputDirectory = join(
    workspaceRoot,
    "packages",
    "contracts",
    "src",
    "tokenless",
  ),
  compiledArtifactRoot = foundryRoot,
} = {}) {
  const files = buildTokenlessSourceAbiFiles({
    abiLoader: (_contractName, contract) =>
      readCompiledAbi(compiledArtifactRoot, contract),
  });
  writeGeneratedFiles(outputDirectory, files);
  return { files: [...files.keys()], outputDirectory };
}

export function buildTokenlessGeneratedSources(
  deploymentArtifact,
  { abiLoader },
) {
  const deployment = validateTokenlessDeploymentArtifact(deploymentArtifact);
  const files = new Map();
  const exportLines = [];

  for (const [contractName, contract] of Object.entries(deployment.contracts)) {
    const exportName = ABI_EXPORT_NAMES[contractName];
    if (!exportName) {
      throw new Error(`No tokenless ABI export name for ${contractName}.`);
    }
    const abi = abiLoader(contractName, contract);
    if (!Array.isArray(abi)) {
      throw new Error(`${contractName} ABI loader did not return an array.`);
    }
    files.set(
      `abis/${exportName}.ts`,
      `${generatedHeader()}export const ${exportName} = ${JSON.stringify(
        abi,
        null,
        2,
      )} as const;\n`,
    );
    exportLines.push(`export { ${exportName} } from "./abis/${exportName}";`);
  }

  files.set(
    "deployedContracts.ts",
    `${generatedHeader()}export const tokenlessDeploymentSchema = ${JSON.stringify(
      deployment.schemaVersion,
    )} as const;\n\nexport const tokenlessDeploymentStatus = ${JSON.stringify(
      {
        schemaVersion: deployment.schemaVersion,
        status: "released",
        chainId: deployment.chainId,
        deploymentKey: deployment.deploymentKey,
      },
      null,
      2,
    )} as const;\n\nexport const tokenlessDeployedContracts = ${JSON.stringify(
      { [deployment.chainId]: deployment },
      null,
      2,
    )} as const;\n`,
  );
  files.set(
    "index.ts",
    `${generatedHeader()}${exportLines.join(
      "\n",
    )}\nexport { tokenlessDeployedContracts, tokenlessDeploymentSchema, tokenlessDeploymentStatus } from "./deployedContracts";\nexport { tokenlessHistoricalDeployments, tokenlessHistoricalDeploymentSchema } from "./historicalDeployments";\n`,
  );

  return files;
}

export function generateTokenlessArtifacts({
  deploymentPath = join(
    foundryRoot,
    "deployments",
    "tokenless-v4",
    `${TOKENLESS_BASE_SEPOLIA_CHAIN_ID}.json`,
  ),
  outputDirectory = join(
    workspaceRoot,
    "packages",
    "contracts",
    "src",
    "tokenless",
  ),
  compiledArtifactRoot = foundryRoot,
} = {}) {
  if (!existsSync(deploymentPath)) {
    throw new Error(`Missing tokenless deployment artifact ${deploymentPath}.`);
  }
  const deployment = validateTokenlessDeploymentArtifact(
    JSON.parse(readFileSync(deploymentPath, "utf8")),
    {
      requireRuntimeCodeEvidence: true,
      expectedBeaconVerifierRuntimeCodeHash:
        compiledBeaconVerifierRuntimeCodeHash(compiledArtifactRoot),
    },
  );
  const files = buildTokenlessGeneratedSources(deployment, {
    abiLoader: (_contractName, contract) =>
      readCompiledAbi(compiledArtifactRoot, contract),
  });

  mkdirSync(outputDirectory, { recursive: true });
  const optionalAdapterPath = join(
    outputDirectory,
    "abis",
    "X402PanelSubmitterAbi.ts",
  );
  if (!deployment.contracts?.X402PanelSubmitter) {
    rmSync(optionalAdapterPath, { force: true });
  }
  writeGeneratedFiles(outputDirectory, files);
  return { files: [...files.keys()], outputDirectory };
}

async function main() {
  const args = process.argv.slice(2);
  const sourceOnly = args.length === 1 && args[0] === "--source-abis-only";
  if (args.length > (sourceOnly ? 1 : 0)) {
    throw new Error(
      "Usage: generateTokenlessArtifacts.js [--source-abis-only]",
    );
  }
  const result = sourceOnly
    ? generateTokenlessSourceAbis()
    : generateTokenlessArtifacts();
  console.log(
    `Generated ${result.files.length} tokenless ${
      sourceOnly ? "source ABIs" : "contract artifacts"
    } under ${result.outputDirectory}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(
      `[generate-tokenless-artifacts] ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}
