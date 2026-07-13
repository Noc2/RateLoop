#!/usr/bin/env node
import { verifyEvidenceExport } from "./assurance-evidence-core.mjs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function verifyEvidenceFile(path, trust) {
  const packet = JSON.parse(await readFile(path, "utf8"));
  return verifyEvidenceExport(packet, trust);
}

async function publicKeyPin(value) {
  if (!value) return undefined;
  try {
    return (await readFile(value, "utf8")).trim();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return value;
    throw error;
  }
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const publicKeyArgument = argumentValue(args, "--public-key");
  const keyIdArgument = argumentValue(args, "--key-id");
  const optionValues = new Set([publicKeyArgument, keyIdArgument].filter(Boolean));
  const path = args.find(value => !value.startsWith("--") && !optionValues.has(value));
  if (!path) {
    throw new Error(
      "Usage: verify-assurance-evidence.mjs <packet.json> --public-key <base64url-or-file> [--key-id <fingerprint>]",
    );
  }
  const result = await verifyEvidenceFile(path, {
    expectedPublicKey: await publicKeyPin(publicKeyArgument),
    expectedKeyId: keyIdArgument,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Evidence verification failed."}\n`);
    process.exitCode = 1;
  });
}
