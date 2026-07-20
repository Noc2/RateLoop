import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./EvidenceWorkspacePanel.tsx", import.meta.url), "utf8");

test("the evidence workspace keeps verification and export state explicit", () => {
  assert.match(source, /Decision records and exports/);
  assert.match(source, /Export packet/);
  assert.doesNotMatch(source, /No decision packet yet|A packet appears after/);
  assert.match(source, /evidence:verify/);
  assert.match(source, /audit:verify/);
  assert.match(source, /Transparency receipt recorded/);
  assert.match(source, /Anchor pending/);
  assert.match(source, /No receipt recorded/);
  assert.match(source, /Current and retired keys remain visible/);
  assert.match(source, /Download trusted SPKI pin/);
  assert.match(source, /format=spki&keyId=/);
  assert.match(source, /--key-id '\$\{trustedKey\.keyId\}'/);
  assert.doesNotMatch(source, /--public-key '\$\{packet\.signing\.publicKey\}'/);
  assert.match(source, /Do not verify it using its embedded key/);
  assert.match(source, /attestation:verify/);
  assert.match(source, /--signer-public-key.*--signer-key-id.*--rekor-public-key.*--tsa-ca.*--tsa-chain/s);
  assert.match(source, /independent trust process/);
  assert.match(source, /Download attestation witness/);
  assert.match(source, /Anchor details restricted/);
  assert.match(source, /Receipt details restricted/);
  assert.match(source, /anchorLabel\(attestation, canManage\)/);
});

test("workspace compliance controls expose only browser-safe endpoints", () => {
  assert.match(source, /\/audit\/export/);
  assert.match(source, /\/assurance\/coverage\/export/);
  assert.match(source, /\/assurance\/metrics\/grafana/);
  assert.match(source, /minimumRetentionMonths/);
  assert.doesNotMatch(source, /TOKENLESS_|PRIVATE_KEY|secretRef|credentialRef/);
});
