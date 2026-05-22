import { __setUrlSafetyDnsResolversForTests, isSafeUrl, resolvePublicUrlAddress } from "./urlSafety";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

afterEach(() => {
  __setUrlSafetyDnsResolversForTests(null);
});

test("isSafeUrl rejects non-public URL forms before DNS lookup", async () => {
  const urls = [
    "http://example.com",
    "https://localhost/callback",
    "https://127.0.0.1/callback",
    "https://[::1]/callback",
    "https://internal-service/callback",
    "https://metadata.local/callback",
    "https://metadata.internal/callback",
    "https://169.254.169.254/latest/meta-data/",
  ];

  for (const url of urls) {
    assert.equal(await isSafeUrl(url), false, url);
  }
});

test("isSafeUrl rejects hostnames that resolve to private or reserved addresses", async () => {
  __setUrlSafetyDnsResolversForTests({
    resolve4: async () => ["10.0.0.12"],
    resolve6: async () => [],
  });

  assert.equal(await isSafeUrl("https://example.com/callback"), false);
});

test("isSafeUrl accepts public HTTPS hostnames with public DNS answers", async () => {
  __setUrlSafetyDnsResolversForTests({
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => [],
  });

  assert.equal(await isSafeUrl("https://example.com/callback"), true);
  const resolved = await resolvePublicUrlAddress("https://example.com/callback");
  assert.equal(resolved?.address, "93.184.216.34");
  assert.equal(resolved?.family, 4);
  assert.equal(resolved?.url.toString(), "https://example.com/callback");
});

test("resolvePublicUrlAddress reuses the cached resolution to defend against DNS rebinding", async () => {
  let resolve4Calls = 0;
  let currentAnswer = ["93.184.216.34"];
  __setUrlSafetyDnsResolversForTests({
    resolve4: async () => {
      resolve4Calls += 1;
      return currentAnswer;
    },
    resolve6: async () => [],
  });

  const first = await resolvePublicUrlAddress("https://example.com/callback");
  assert.equal(first?.address, "93.184.216.34");
  assert.equal(resolve4Calls, 1);

  // Simulate an attacker flipping DNS between safety check and outbound fetch.
  currentAnswer = ["10.0.0.7"];
  const second = await resolvePublicUrlAddress("https://example.com/callback");
  assert.equal(second?.address, "93.184.216.34", "second resolution must reuse cached public IP");
  assert.equal(resolve4Calls, 1, "no additional DNS lookups within the cache TTL");
});
