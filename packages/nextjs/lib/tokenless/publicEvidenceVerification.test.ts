import {
  canonicalizeEvidenceValue,
  computeEvidenceAggregation,
  evidenceMerkleRoot,
  evidenceSigningKeyId,
  sha256EvidenceValue,
} from "../../scripts/assurance-evidence-core.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PUBLIC_EVIDENCE_PACKET_BYTES,
  PUBLIC_EVIDENCE_TRUSTED_KEYS_PATH,
  parsePublicEvidencePacketJson,
  verifyPublicEvidencePacket,
} from "~~/lib/tokenless/publicEvidenceVerification";

async function signedPacket() {
  const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = Buffer.from(await crypto.subtle.exportKey("spki", keyPair.publicKey)).toString("base64url");
  const keyId = await evidenceSigningKeyId(publicKey, "Ed25519");
  const recomputation = {
    reviewerSources: [
      {
        source: "customer_invited",
        targetReviewerCount: 1,
        assignedReviewerCount: 1,
        paidReviewerCount: 0,
        respondingReviewerCount: 1,
        completeJudgmentSetReviewerCount: 1,
      },
    ],
    cases: [
      {
        caseId: "case-1",
        overall: {
          targetReviewerCount: 1,
          assignedReviewerCount: 1,
          validReviewerCount: 1,
          candidate: 1,
          baseline: 0,
          tie: 0,
          invalidJudgmentCount: 0,
          pendingJudgmentCount: 0,
        },
        sourceCounts: [
          {
            source: "customer_invited",
            targetReviewerCount: 1,
            assignedReviewerCount: 1,
            validReviewerCount: 1,
            candidate: 1,
            baseline: 0,
            tie: 0,
            invalidJudgmentCount: 0,
            pendingJudgmentCount: 0,
          },
        ],
      },
    ],
    caseLeaves: [await sha256EvidenceValue(["case-1", "content"])],
    responseLeaves: [await sha256EvidenceValue(["case-1", "review"])],
  };
  const passRule = { minimumValidResponses: 1, thresholdBps: 5_000 };
  const payload = {
    schemaVersion: "rateloop.human-assurance.evidence.v2",
    roots: {
      caseRoot: await evidenceMerkleRoot(recomputation.caseLeaves),
      responseRoot: await evidenceMerkleRoot(recomputation.responseLeaves),
    },
    recomputation,
    aggregation: computeEvidenceAggregation(recomputation, 1, passRule),
  };
  const signing = { algorithm: "Ed25519", keyId, publicKey };
  const signedDocument = { payload, signing };
  return {
    ...signedDocument,
    packetDigest: await sha256EvidenceValue(signedDocument),
    signature: Buffer.from(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        keyPair.privateKey,
        new TextEncoder().encode(canonicalizeEvidenceValue(signedDocument)),
      ),
    ).toString("base64url"),
  };
}

function trustAnchor(packet: Awaited<ReturnType<typeof signedPacket>>) {
  return {
    schemaVersion: "rateloop.evidence-public-trusted-keys.v1",
    keys: [
      {
        algorithm: packet.signing.algorithm,
        keyId: packet.signing.keyId,
        publicKeySpki: packet.signing.publicKey,
        status: "retired",
        uses: ["decision_packet"],
      },
    ],
  };
}

test("the public verifier binds every browser check to the shared isomorphic core and a public key", async () => {
  const packet = await signedPacket();
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const result = await verifyPublicEvidencePacket(packet, {
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      return Response.json(trustAnchor(packet));
    },
  });

  assert.equal(result.valid, true);
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
  const packet = await signedPacket();
  const altered = structuredClone(packet);
  altered.payload.roots.caseRoot = `sha256:${"0".repeat(64)}`;
  const alteredResult = await verifyPublicEvidencePacket(altered, {
    fetchImpl: async () => Response.json(trustAnchor(packet)),
  });
  assert.equal(alteredResult.valid, false);
  assert.equal(alteredResult.checks.find(check => check.id === "case_root")?.status, "fail");
  assert.equal(alteredResult.checks.find(check => check.id === "signature")?.status, "fail");

  await assert.rejects(
    verifyPublicEvidencePacket(packet, {
      fetchImpl: async () =>
        Response.json({
          ...trustAnchor(packet),
          keys: trustAnchor(packet).keys.map(key => ({ ...key, uses: ["human_review_gate"] })),
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
