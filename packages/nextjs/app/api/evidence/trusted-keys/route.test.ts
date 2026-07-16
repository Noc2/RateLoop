import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const workspaceHistory = readFileSync(
  new URL("../../account/workspaces/[workspaceId]/assurance/trusted-keys/route.ts", import.meta.url),
  "utf8",
);
const historyService = readFileSync(
  new URL("../../../../lib/tokenless/evidenceSigningKeys.ts", import.meta.url),
  "utf8",
);

test("the public trust anchor contains only configured verification keys", () => {
  assert.match(route, /projectHumanReviewGateTrustedKeyHistory/);
  assert.match(route, /Cache-Control.*public/);
  assert.doesNotMatch(route, /requireBrowserSession|workspaceId/);
  assert.match(workspaceHistory, /listWorkspaceEvidenceSigningKeys/);
  assert.match(historyService, /untrustedPacketKeyCount: packetById\.size/);
  assert.match(historyService, /publicKeySpki: encodeEd25519SpkiDerBase64url\(key\.publicKeyJwk\)/);
  assert.match(workspaceHistory, /format !== "spki" \|\| !keyId/);
  assert.match(workspaceHistory, /history\.keys\.find\(key => key\.keyId === keyId\)/);
  assert.match(workspaceHistory, /Content-Disposition/);
  assert.match(workspaceHistory, /X-RateLoop-Evidence-Key-Id/);
  assert.doesNotMatch(historyService, /packetById\.values\(\)[\s\S]*status: "retired"/);
});
