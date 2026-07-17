import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeDeployData } from "viem";

export const EIP170_RUNTIME_CODE_SIZE_LIMIT = 24_576;
export const EIP3860_INITCODE_SIZE_LIMIT = 49_152;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const foundryRoot = join(scriptDirectory, "..");
const placeholderAddress = "0x0000000000000000000000000000000000000001";

export const TOKENLESS_DEPLOYMENT_CONTRACTS = [
  {
    label: "TokenlessTestUSDC",
    artifact: "MockERC20",
    args: ["RateLoop Tokenless Test USDC", "tUSDC", 6],
  },
  {
    label: "CredentialIssuer",
    artifact: "CredentialIssuer",
    args: [placeholderAddress, placeholderAddress, 86_400n],
  },
  {
    label: "TokenlessPanel",
    artifact: "TokenlessPanel",
    args: [placeholderAddress, placeholderAddress],
  },
  {
    label: "TokenlessFeedbackBonus",
    artifact: "TokenlessFeedbackBonus",
    args: [placeholderAddress, placeholderAddress],
  },
  {
    label: "X402PanelSubmitter",
    artifact: "X402PanelSubmitter",
    args: [placeholderAddress, placeholderAddress],
  },
];

function byteLength(bytecode, label) {
  if (
    typeof bytecode !== "string" ||
    !/^0x[0-9a-f]*$/i.test(bytecode) ||
    bytecode.length <= 2 ||
    bytecode.length % 2 !== 0
  ) {
    throw new Error(`${label} must be non-empty, even-length hex bytecode.`);
  }
  return (bytecode.length - 2) / 2;
}

function hasLinkReferences(linkReferences) {
  return Object.values(linkReferences ?? {}).some((source) =>
    Object.values(source ?? {}).some((references) => references.length > 0)
  );
}

export function measureDeploymentSize({
  label,
  abi,
  bytecode,
  deployedBytecode,
  args = [],
  linkReferences = {},
}) {
  if (!Array.isArray(abi)) {
    throw new Error(`${label} artifact ABI must be an array.`);
  }
  if (hasLinkReferences(linkReferences)) {
    throw new Error(`${label} has unresolved library link references.`);
  }

  const initcode = encodeDeployData({ abi, bytecode, args });
  return {
    label,
    runtimeSize: byteLength(deployedBytecode, `${label} runtime bytecode`),
    initcodeSize: byteLength(initcode, `${label} initcode`),
  };
}

export function assertWithinDeploymentSizeLimits(
  report,
  {
    runtimeLimit = EIP170_RUNTIME_CODE_SIZE_LIMIT,
    initcodeLimit = EIP3860_INITCODE_SIZE_LIMIT,
  } = {}
) {
  const violations = [];
  for (const contract of report) {
    if (contract.runtimeSize > runtimeLimit) {
      violations.push(
        `${contract.label} runtime is ${contract.runtimeSize} bytes; EIP-170 allows ${runtimeLimit}.`
      );
    }
    if (contract.initcodeSize > initcodeLimit) {
      violations.push(
        `${contract.label} initcode is ${contract.initcodeSize} bytes; EIP-3860 allows ${initcodeLimit}.`
      );
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Tokenless deployment blocked by contract size limits:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`
    );
  }
  return report;
}

export function inspectTokenlessDeploymentSizes({
  artifactRoot = foundryRoot,
  contracts = TOKENLESS_DEPLOYMENT_CONTRACTS,
} = {}) {
  return contracts.map((contract) => {
    const artifactPath = join(
      artifactRoot,
      "out",
      `${contract.artifact}.sol`,
      `${contract.artifact}.json`
    );
    if (!existsSync(artifactPath)) {
      throw new Error(
        `Missing compiled artifact for ${contract.label}: ${artifactPath}. Run the deploy-profile build first.`
      );
    }
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    return measureDeploymentSize({
      label: contract.label,
      abi: artifact.abi,
      bytecode: artifact.bytecode?.object,
      deployedBytecode: artifact.deployedBytecode?.object,
      args: contract.args,
      linkReferences: artifact.bytecode?.linkReferences,
    });
  });
}

export function formatDeploymentSizeReport(report) {
  const rows = [
    "Contract                 Runtime (B)  Runtime margin  Initcode (B)  Initcode margin",
  ];
  for (const contract of report) {
    rows.push(
      [
        contract.label.padEnd(24),
        String(contract.runtimeSize).padStart(11),
        String(EIP170_RUNTIME_CODE_SIZE_LIMIT - contract.runtimeSize).padStart(15),
        String(contract.initcodeSize).padStart(13),
        String(EIP3860_INITCODE_SIZE_LIMIT - contract.initcodeSize).padStart(16),
      ].join("  ")
    );
  }
  return rows.join("\n");
}

async function main() {
  const report = inspectTokenlessDeploymentSizes();
  console.log("Tokenless deployment size gate (constructor arguments included)");
  console.log(formatDeploymentSizeReport(report));
  assertWithinDeploymentSizeLimits(report);
  console.log("All tokenless deployment contracts satisfy EIP-170 and EIP-3860.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(
      `[check-tokenless-contract-sizes] ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = 1;
  }
}
