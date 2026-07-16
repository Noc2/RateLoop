#!/usr/bin/env node
import { verifyAssuranceAttestationWitnessBundle } from "./assurance-attestation-witness-core.mjs";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

async function verifyTimestamp(bundle, tsaCaPath, tsaChainPath, opensslPath = "openssl") {
  if (!bundle.rfc3161) return;
  if (!tsaCaPath) throw new Error("--tsa-ca is required when the witness contains an RFC 3161 token.");
  const directory = await mkdtemp(join(tmpdir(), "rateloop-attestation-verify-"));
  try {
    const tokenPath = join(directory, "timestamp.tsr");
    await writeFile(tokenPath, Buffer.from(bundle.rfc3161.tokenBase64, "base64"), { mode: 0o600 });
    const args = [
      "ts",
      "-verify",
      "-digest",
      bundle.rfc3161.messageImprint.digest,
      "-in",
      tokenPath,
      "-CAfile",
      tsaCaPath,
    ];
    if (tsaChainPath) args.push("-untrusted", tsaChainPath);
    await execFileAsync(opensslPath, args, { timeout: 15_000, maxBuffer: 1024 * 1024 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function verifyAssuranceAttestationFile(path, options) {
  const bundle = JSON.parse(await readFile(path, "utf8"));
  const result = verifyAssuranceAttestationWitnessBundle(bundle, {
    signerPublicKey: await readFile(options.signerPublicKeyPath),
    rekorPublicKey: await readFile(options.rekorPublicKeyPath),
    expectedSignerKeyId: options.expectedSignerKeyId,
  });
  if (!result.valid) return result;
  try {
    await verifyTimestamp(bundle, options.tsaCaPath, options.tsaChainPath, options.opensslPath);
    return result;
  } catch {
    return { valid: false, errors: ["invalid_rfc3161_timestamp"] };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const signerPublicKeyPath = argumentValue(args, "--signer-public-key");
  const rekorPublicKeyPath = argumentValue(args, "--rekor-public-key");
  const expectedSignerKeyId = argumentValue(args, "--signer-key-id");
  const tsaCaPath = argumentValue(args, "--tsa-ca");
  const tsaChainPath = argumentValue(args, "--tsa-chain");
  const opensslPath = argumentValue(args, "--openssl");
  const optionValues = new Set(
    [signerPublicKeyPath, rekorPublicKeyPath, expectedSignerKeyId, tsaCaPath, tsaChainPath, opensslPath].filter(
      Boolean,
    ),
  );
  const path = args.find(value => !value.startsWith("--") && !optionValues.has(value));
  if (!path || !signerPublicKeyPath || !rekorPublicKeyPath) {
    throw new Error(
      "Usage: verify-assurance-attestation.mjs <witness.json> --signer-public-key <pem> --rekor-public-key <pem> [--signer-key-id <id>] [--tsa-ca <pem> --tsa-chain <pem>]",
    );
  }
  const result = await verifyAssuranceAttestationFile(path, {
    signerPublicKeyPath,
    rekorPublicKeyPath,
    expectedSignerKeyId,
    tsaCaPath,
    tsaChainPath,
    opensslPath,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Attestation verification failed."}\n`);
    process.exitCode = 1;
  });
}
