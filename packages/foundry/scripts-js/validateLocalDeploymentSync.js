import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function normalizeAddress(value) {
  return typeof value === "string" && ADDRESS_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildDeploymentNameToAddress(deployments) {
  const byName = new Map();
  const candidates = [deployments, deployments?.["31337"]].filter(Boolean);

  for (const candidate of candidates) {
    for (const [key, value] of Object.entries(candidate)) {
      const addressKey = normalizeAddress(key);
      if (addressKey && typeof value === "string") {
        byName.set(value, addressKey);
        continue;
      }

      if (typeof key !== "string") continue;
      const directAddress = normalizeAddress(value);
      if (directAddress) {
        byName.set(key, directAddress);
        continue;
      }

      if (value && typeof value === "object") {
        const objectAddress = normalizeAddress(value.address);
        if (objectAddress) byName.set(key, objectAddress);
      }
    }
  }

  return byName;
}

export function extractGeneratedChainBlock(source, chainId) {
  const chainPattern = new RegExp(`(^|\\n)\\s*${chainId}\\s*:\\s*{`);
  const match = chainPattern.exec(source);
  if (!match) return undefined;

  let index = match.index + match[0].lastIndexOf("{");
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(match.index + match[0].lastIndexOf("{"), index + 1);
    }
  }

  return undefined;
}

export function readGeneratedAddress(source, chainId, contractName) {
  const chainBlock = extractGeneratedChainBlock(source, chainId);
  if (!chainBlock) return undefined;

  const contractPattern = new RegExp(
    `(^|\\n)\\s*${escapeRegExp(contractName)}\\s*:\\s*{\\s*address\\s*:\\s*"(${ADDRESS_PATTERN.source.slice(
      1,
      -1,
    )})"`,
  );
  const match = contractPattern.exec(chainBlock);
  return normalizeAddress(match?.[2]);
}

export function findDeploymentMismatches({
  deploymentJson,
  deployedContractsSource,
  chainId,
  contractNames,
}) {
  const artifactAddresses = buildDeploymentNameToAddress(deploymentJson);
  const mismatches = [];

  for (const contractName of contractNames) {
    const artifactAddress = artifactAddresses.get(contractName);
    const generatedAddress = readGeneratedAddress(
      deployedContractsSource,
      chainId,
      contractName,
    );
    if (artifactAddress === generatedAddress) continue;
    if (!artifactAddress && !generatedAddress) continue;

    mismatches.push({
      contractName,
      artifactAddress,
      generatedAddress,
    });
  }

  return mismatches;
}

function main() {
  const [deploymentJsonPath, deployedContractsPath, chainIdArg, ...contractNames] =
    process.argv.slice(2);
  const chainId = Number.parseInt(chainIdArg ?? "", 10);
  if (
    !deploymentJsonPath ||
    !deployedContractsPath ||
    !Number.isSafeInteger(chainId) ||
    contractNames.length === 0
  ) {
    console.error(
      "Usage: node scripts-js/validateLocalDeploymentSync.js <deployment-json> <deployedContracts.ts> <chain-id> <contract> [contract...]",
    );
    process.exit(2);
  }

  const deploymentJson = JSON.parse(readFileSync(deploymentJsonPath, "utf8"));
  const deployedContractsSource = readFileSync(deployedContractsPath, "utf8");
  const mismatches = findDeploymentMismatches({
    deploymentJson,
    deployedContractsSource,
    chainId,
    contractNames,
  });

  if (mismatches.length === 0) return;

  console.error(
    "ERROR: Local deployment artifact is stale relative to packages/contracts/src/deployedContracts.ts.",
  );
  for (const mismatch of mismatches) {
    const artifactAddress = mismatch.artifactAddress ?? "missing";
    const generatedAddress = mismatch.generatedAddress ?? "missing";
    console.error(
      `  ${mismatch.contractName}: ${artifactAddress} in deployment artifact, ${generatedAddress} in generated contracts`,
    );
  }
  console.error(
    "Refresh the local deployment artifacts before running the seed script.",
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
