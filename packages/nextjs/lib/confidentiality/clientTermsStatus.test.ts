import assert from "node:assert/strict";
import test from "node:test";
import { fetchConfidentialityTermsStatus } from "~~/lib/confidentiality/clientTermsStatus";

test("fetchConfidentialityTermsStatus preserves deployment scope", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];

  globalThis.fetch = async (input, init) => {
    requests.push({ input, init });
    return new Response(JSON.stringify({ accepted: true, hasSession: true }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };

  try {
    const status = await fetchConfidentialityTermsStatus("0x000000000000000000000000000000000000c0de", 42n, {
      chainId: 31337,
      contentRegistryAddress: "0x1111111111111111111111111111111111111111",
      deploymentKey: "31337:0x1111111111111111111111111111111111111111",
    });

    assert.deepEqual(status, { accepted: true, hasSession: true });
    assert.equal(requests.length, 1);
    const requestUrl = new URL(String(requests[0]!.input), "https://rateloop.test");
    assert.equal(requestUrl.pathname, "/api/confidentiality/terms");
    assert.equal(requestUrl.searchParams.get("chainId"), "31337");
    assert.equal(requestUrl.searchParams.get("contentRegistryAddress"), "0x1111111111111111111111111111111111111111");
    assert.equal(requestUrl.searchParams.get("deploymentKey"), "31337:0x1111111111111111111111111111111111111111");
    assert.equal(requests[0]!.init?.credentials, "include");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
