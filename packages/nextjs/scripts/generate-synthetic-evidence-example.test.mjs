import { evidenceSigningKeyId, verifyEvidenceExport } from "./assurance-evidence-core.mjs";
import { generateSyntheticEvidenceExample } from "./generate-synthetic-evidence-example.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const EXAMPLES_DIRECTORY = fileURLToPath(new URL("../public/docs/examples", import.meta.url));
const PACKAGE_DIRECTORY = fileURLToPath(new URL("../", import.meta.url));
const PACKET_PATH = join(EXAMPLES_DIRECTORY, "synthetic-evidence-v4.json");
const PUBLIC_KEY_PATH = join(EXAMPLES_DIRECTORY, "synthetic-evidence-v4.spki.txt");
const tempDirectories = [];

after(async () => {
  await Promise.all(tempDirectories.map(directory => rm(directory, { recursive: true, force: true })));
});

async function readExample(packetPath = PACKET_PATH, publicKeyPath = PUBLIC_KEY_PATH) {
  const [packetJson, publicKey] = await Promise.all([readFile(packetPath, "utf8"), readFile(publicKeyPath, "utf8")]);
  return { packet: JSON.parse(packetJson), packetJson, publicKey: publicKey.trim() };
}

async function assertValidSyntheticExample(example) {
  assert.equal(example.packet.payload.schemaVersion, "rateloop.human-assurance.evidence.v4");
  assert.equal(example.packet.payload.privacy.classification, "synthetic");
  assert.equal(example.packet.payload.aggregation.suite.outcome, "pass");
  assert.equal(example.packet.payload.aggregation.reviewerCoverage.respondingReviewerCount, 3);
  assert.equal(example.packet.signing.algorithm, "Ed25519");
  assert.equal(example.packet.signing.publicKey, example.publicKey);
  assert.equal(example.packet.signing.keyId, await evidenceSigningKeyId(example.publicKey));
  assert.deepEqual(
    await verifyEvidenceExport(example.packet, {
      expectedPublicKey: example.publicKey,
      expectedKeyId: example.packet.signing.keyId,
    }),
    { valid: true, errors: [], packetDigest: example.packet.packetDigest },
  );
  assert.doesNotMatch(example.packetJson, /BEGIN PRIVATE KEY|privateKey|pkcs8/u);
  assert.doesNotMatch(example.packetJson, /0x[0-9a-f]{40}(?![0-9a-f])/u);
}

test("checked-in synthetic v4 evidence verifies with its separate public pin", async () => {
  const example = await readExample();
  await assertValidSyntheticExample(example);

  const verificationScript = fileURLToPath(new URL("./verify-assurance-evidence.mjs", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      verificationScript,
      "public/docs/examples/synthetic-evidence-v4.json",
      "--public-key",
      "public/docs/examples/synthetic-evidence-v4.spki.txt",
      "--key-id",
      example.packet.signing.keyId,
    ],
    { cwd: PACKAGE_DIRECTORY, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    valid: true,
    errors: [],
    packetDigest: example.packet.packetDigest,
  });
});

test("generator persists only a packet and public key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rateloop-synthetic-evidence-"));
  tempDirectories.push(directory);
  const result = await generateSyntheticEvidenceExample(directory);
  assert.deepEqual((await readdir(directory)).sort(), ["synthetic-evidence-v4.json", "synthetic-evidence-v4.spki.txt"]);
  const example = await readExample(result.packetPath, result.publicKeyPath);
  assert.equal(result.keyId, example.packet.signing.keyId);
  await assertValidSyntheticExample(example);
});
