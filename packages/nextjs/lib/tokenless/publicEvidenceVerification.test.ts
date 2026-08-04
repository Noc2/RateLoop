import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PUBLIC_EVIDENCE_PACKET_BYTES,
  PUBLIC_EVIDENCE_TRUSTED_KEYS_PATH,
  parsePublicEvidencePacketJson,
  verifyPublicEvidencePacket,
} from "~~/lib/tokenless/publicEvidenceVerification";
import {
  publicEvidenceTrustAnchor,
  signedPublicEvidencePacket,
} from "~~/lib/tokenless/publicEvidenceVerification.fixture";

test("the public verifier binds every browser check to the shared isomorphic core and a public key", async () => {
  const packet = await signedPublicEvidencePacket();
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const result = await verifyPublicEvidencePacket(packet, {
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      return Response.json(publicEvidenceTrustAnchor(packet));
    },
  });

  assert.equal(result.valid, true, JSON.stringify(result));
  assert.deepEqual(
    result.checks.map(check => [check.id, check.status]),
    [
      ["digest", "pass"],
      ["case_root", "pass"],
      ["response_root", "pass"],
      ["aggregation", "pass"],
      ["signature", "pass"],
    ],
  );
  assert.equal(result.key.status, "retired");
  assert.equal(requests[0]?.input, PUBLIC_EVIDENCE_TRUSTED_KEYS_PATH);
  assert.equal(requests[0]?.init?.credentials, "omit");
  assert.equal(requests[0]?.init?.method, undefined);
});

test("the public verifier fails altered evidence and keys not published for decision packets", async () => {
  const packet = await signedPublicEvidencePacket();
  const altered = structuredClone(packet);
  altered.payload.roots.caseRoot = `sha256:${"0".repeat(64)}`;
  const alteredResult = await verifyPublicEvidencePacket(altered, {
    fetchImpl: async () => Response.json(publicEvidenceTrustAnchor(packet)),
  });
  assert.equal(alteredResult.valid, false);
  assert.equal(alteredResult.checks.find(check => check.id === "case_root")?.status, "fail");
  assert.equal(alteredResult.checks.find(check => check.id === "signature")?.status, "fail");

  await assert.rejects(
    verifyPublicEvidencePacket(packet, {
      fetchImpl: async () =>
        Response.json({
          ...publicEvidenceTrustAnchor(packet),
          keys: publicEvidenceTrustAnchor(packet).keys.map(key => ({ ...key, uses: ["human_review_gate"] })),
        }),
    }),
    /No public decision-packet key matches/,
  );
});

test("pasted JSON is bounded by its UTF-8 byte length before parsing", () => {
  assert.deepEqual(parsePublicEvidencePacketJson('{"packet":true}'), { packet: true });
  assert.throws(
    () => parsePublicEvidencePacketJson(`"${"é".repeat(MAX_PUBLIC_EVIDENCE_PACKET_BYTES / 2)}"`),
    /2 MB or smaller/,
  );
  assert.throws(() => parsePublicEvidencePacketJson("{broken"), /not valid JSON/);
});
