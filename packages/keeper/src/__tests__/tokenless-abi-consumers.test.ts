import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Abi } from "viem";
import {
  adapterHealthAbi,
  feedbackBonusHealthAbi,
  panelHealthAbi,
} from "../../../ponder/src/deployment-health.js";
import {
  TokenlessFeedbackBonusAbi,
  TokenlessPanelAbi,
  TokenlessX402PanelSubmitterAbi,
} from "../tokenless-abi.js";

function generatedAbi(relativePath: string): Abi {
  const source = readFileSync(
    new URL(`../../../contracts/src/tokenless/abis/${relativePath}`, import.meta.url),
    "utf8",
  );
  const start = source.indexOf("[");
  const end = source.lastIndexOf("] as const;");
  if (start < 0 || end < start) {
    throw new Error(`${relativePath} does not contain a generated ABI array.`);
  }
  return JSON.parse(source.slice(start, end + 1)) as Abi;
}

function parameter(value: Record<string, unknown>): Record<string, unknown> {
  return {
    name: value.name ?? "",
    type: value.type,
    ...(value.indexed === true ? { indexed: true } : {}),
    ...(Array.isArray(value.components)
      ? { components: value.components.map(component => parameter(component as Record<string, unknown>)) }
      : {}),
  };
}

function fingerprint(value: Abi[number]) {
  const item = value as unknown as Record<string, unknown>;
  return JSON.stringify({
    type: item.type,
    name: item.name,
    inputs: Array.isArray(item.inputs) ? item.inputs.map(input => parameter(input as Record<string, unknown>)) : [],
    ...(Array.isArray(item.outputs)
      ? { outputs: item.outputs.map(output => parameter(output as Record<string, unknown>)) }
      : {}),
    ...(item.stateMutability === undefined ? {} : { stateMutability: item.stateMutability }),
    ...(item.anonymous === true ? { anonymous: true } : {}),
  });
}

function signatures(abi: Abi) {
  return new Set(abi.map(fingerprint));
}

function expectSubset(label: string, consumer: Abi, canonical: Abi) {
  const canonicalSignatures = signatures(canonical);
  for (const item of consumer) {
    const signature = fingerprint(item);
    expect(canonicalSignatures.has(signature), `${label} drifted at ${item.type} ${"name" in item ? item.name : ""}`).toBe(
      true,
    );
  }
}

describe("tokenless ABI consumers", () => {
  const panel = generatedAbi("TokenlessPanelAbi.ts");
  const feedbackBonus = generatedAbi("TokenlessFeedbackBonusAbi.ts");
  const submitter = generatedAbi("X402PanelSubmitterAbi.ts");

  it("binds keeper and Ponder subsets to the generated canonical ABIs", () => {
    expectSubset("keeper TokenlessPanel", TokenlessPanelAbi, panel);
    expectSubset("keeper TokenlessFeedbackBonus", TokenlessFeedbackBonusAbi, feedbackBonus);
    expectSubset("keeper X402PanelSubmitter", TokenlessX402PanelSubmitterAbi, submitter);
    expectSubset("Ponder TokenlessPanel health", panelHealthAbi, panel);
    expectSubset("Ponder TokenlessFeedbackBonus health", feedbackBonusHealthAbi, feedbackBonus);
    expectSubset("Ponder X402PanelSubmitter health", adapterHealthAbi, submitter);
  });
});
