import assert from "node:assert/strict";
import { test } from "node:test";
import { createS3CompatibleWormRuntime } from "~~/lib/tokenless/assuranceWormS3";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const CREDENTIAL_REFERENCE = `sec_${"1".repeat(48)}`;
const spec = {
  label: "S3 archive",
  endpointOrigin: "https://s3.example.test",
  bucketName: "regulated-archive",
  keyPrefix: "assurance",
  region: "eu-central-1",
  credentialReference: CREDENTIAL_REFERENCE,
  retentionDays: 365,
};

test("S3 adapter signs preflight and locked PUT requests without exposing resolved credentials", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const checksumBase64 = Buffer.from("11".repeat(32), "hex").toString("base64");
  const fetch = async (target: string | URL, init: RequestInit = {}) => {
    const url = String(target);
    requests.push({ url, init });
    if (url.endsWith("?versioning=")) {
      return new Response("<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>", {
        status: 200,
      });
    }
    if (url.endsWith("?object-lock=")) {
      return new Response(
        "<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention><Mode>COMPLIANCE</Mode><Days>730</Days></DefaultRetention></Rule></ObjectLockConfiguration>",
        { status: 200 },
      );
    }
    if (init.method === "PUT") {
      return new Response("", { status: 200, headers: { "x-amz-version-id": "version-1" } });
    }
    return new Response(null, {
      status: 200,
      headers: {
        etag: '"etag-1"',
        "x-amz-version-id": "version-1",
        "x-amz-checksum-sha256": checksumBase64,
        "x-amz-object-lock-mode": "COMPLIANCE",
        "x-amz-object-lock-retain-until-date": "2027-07-16T12:00:00.000Z",
      },
    });
  };
  const runtime = createS3CompatibleWormRuntime({
    async resolveCredential(reference) {
      assert.equal(reference, CREDENTIAL_REFERENCE);
      return { accessKeyId: "ACCESSKEYEXAMPLE", secretAccessKey: "a-secret-value-that-stays-in-the-resolver" };
    },
    fetch,
    now: () => NOW,
  });
  const preflight = await runtime.inspectDestination(spec);
  assert.equal(preflight.versioning, "Enabled");
  assert.equal(preflight.objectLockEnabled, true);
  assert.deepEqual(preflight.defaultRetention, { mode: "COMPLIANCE", days: 730 });

  const receipt = await runtime.putLockedObject({
    spec,
    objectKey: "assurance/workspace/report.json",
    body: Buffer.from("{}"),
    checksumSha256: `sha256:${"11".repeat(32)}`,
    checksumSha256Base64: checksumBase64,
    retentionUntil: "2027-07-16T12:00:00.000Z",
    idempotencyKey: `worm:${"2".repeat(64)}`,
  });
  assert.equal(receipt.objectVersionId, "version-1");
  assert.equal(receipt.checksumSha256, `sha256:${"11".repeat(32)}`);
  assert.equal(receipt.objectLockMode, "COMPLIANCE");
  assert.equal(requests.length, 4);
  for (const request of requests) {
    const headers = request.init.headers as Record<string, string>;
    assert.match(headers.authorization, /^AWS4-HMAC-SHA256 /u);
    assert.doesNotMatch(JSON.stringify(request), /a-secret-value-that-stays-in-the-resolver/u);
  }
  const putHeaders = requests[2]!.init.headers as Record<string, string>;
  assert.equal(putHeaders["x-amz-object-lock-mode"], "COMPLIANCE");
  assert.equal(putHeaders["x-amz-object-lock-retain-until-date"], "2027-07-16T12:00:00.000Z");
  assert.equal(putHeaders["x-amz-meta-rateloop-idempotency"], `worm:${"2".repeat(64)}`);
  assert.equal(requests[3]!.init.method, "HEAD");
  assert.match(requests[3]!.url, /\?versionId=version-1$/u);
  assert.equal((requests[3]!.init.headers as Record<string, string>)["x-amz-checksum-mode"], "ENABLED");
});
