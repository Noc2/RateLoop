import {
  canonicalizeLegacyEvidenceValue,
  computeEvidenceAggregation,
  evidenceMerkleRoot,
  evidenceSigningKeyId,
  sha256EvidenceValue,
  sha256LegacyEvidenceValue,
} from "../../scripts/assurance-evidence-core.mjs";

export async function signedPublicEvidencePacket() {
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
    legacyExtension: { A: 1, a: 2, "€": 3, "💩": 4 },
    generatedAt: "2026-08-04T08:00:00.000Z",
    frozen: { suiteManifest: { rubric: { prompt: "Is the response supported by the evidence?" } } },
    roots: {
      caseRoot: await evidenceMerkleRoot(recomputation.caseLeaves),
      responseRoot: await evidenceMerkleRoot(recomputation.responseLeaves),
    },
    recomputation,
    aggregation: computeEvidenceAggregation(recomputation, 1, passRule),
  };
  const signing = { algorithm: "Ed25519", keyId, publicKey } as const;
  const signedDocument = { payload, signing };
  return {
    ...signedDocument,
    packetDigest: await sha256LegacyEvidenceValue(signedDocument),
    signature: Buffer.from(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        keyPair.privateKey,
        new TextEncoder().encode(canonicalizeLegacyEvidenceValue(signedDocument)),
      ),
    ).toString("base64url"),
  };
}

export function publicEvidenceTrustAnchor(packet: Awaited<ReturnType<typeof signedPublicEvidencePacket>>) {
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
