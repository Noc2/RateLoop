import { POST } from "./route";
import { hashSignal } from "@worldcoin/idkit/hashing";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalAction = env.NEXT_PUBLIC_WORLD_ID_ACTION;
const originalEndpoint = env.WORLD_ID_VERIFY_ENDPOINT;
const originalRpId = env.WORLD_ID_RP_ID;
const originalFetch = globalThis.fetch;

const TEST_SIGNAL = "0x63cada40e8acf7a1d47229af5be35b78b16035fa";

function makeWorldIdResult(signal = TEST_SIGNAL) {
  return {
    protocol_version: "4.0",
    nonce: "0x1234",
    action: "rateloop-test",
    environment: "production",
    responses: [
      {
        identifier: "proof_of_human",
        signal_hash: hashSignal(signal),
        proof: ["0x01", "0x02", "0x03", "0x04", "0x05"],
        nullifier: "0xabcdef",
        issuer_schema_id: 1,
        expires_at_min: 1_800_000_000,
      },
    ],
  };
}

function makeRequest(body: unknown) {
  return new Request("https://rateloop.xyz/api/world-id/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  if (originalAction === undefined) delete env.NEXT_PUBLIC_WORLD_ID_ACTION;
  else env.NEXT_PUBLIC_WORLD_ID_ACTION = originalAction;

  if (originalEndpoint === undefined) delete env.WORLD_ID_VERIFY_ENDPOINT;
  else env.WORLD_ID_VERIFY_ENDPOINT = originalEndpoint;

  if (originalRpId === undefined) delete env.WORLD_ID_RP_ID;
  else env.WORLD_ID_RP_ID = originalRpId;

  globalThis.fetch = originalFetch;
});

test("World ID verify route forwards v4 uniqueness proofs to Developer Portal verification", async () => {
  env.NEXT_PUBLIC_WORLD_ID_ACTION = "rateloop-test";
  env.WORLD_ID_RP_ID = "rp_test";
  env.WORLD_ID_VERIFY_ENDPOINT = "https://developer.example/api/v4/verify";

  let capturedUrl = "";
  let capturedBody: unknown;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body));
    return Response.json({ success: true, nullifier: "0xverified" });
  };

  const idkitResponse = makeWorldIdResult();
  const response = await POST(makeRequest({ idkitResponse, signal: TEST_SIGNAL }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(capturedUrl, "https://developer.example/api/v4/verify/rp_test");
  assert.deepEqual(capturedBody, idkitResponse);
  assert.deepEqual(body, {
    nullifier: "0xverified",
    success: true,
    verifiedAt: body.verifiedAt,
  });
  assert.match(body.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("World ID verify route rejects proofs for a different wallet signal", async () => {
  env.NEXT_PUBLIC_WORLD_ID_ACTION = "rateloop-test";
  env.WORLD_ID_RP_ID = "rp_test";

  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({ success: true });
  };

  const response = await POST(makeRequest({ idkitResponse: makeWorldIdResult("other-signal"), signal: TEST_SIGNAL }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(fetchCalled, false);
  assert.equal(body.error, "World ID signal does not match this request.");
});

test("World ID verify route rejects legacy proofs", async () => {
  env.NEXT_PUBLIC_WORLD_ID_ACTION = "rateloop-test";
  env.WORLD_ID_RP_ID = "rp_test";

  const response = await POST(
    makeRequest({
      protocol_version: "3.0",
      nonce: "0x1234",
      action: "rateloop-test",
      environment: "production",
      responses: [],
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "RateLoop requires a World ID v4 uniqueness proof." });
});
