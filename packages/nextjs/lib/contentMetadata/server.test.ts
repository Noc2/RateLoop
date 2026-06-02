import { __setUrlSafetyDnsResolversForTests } from "../../utils/urlSafety";
import { __setContentMetadataFetchForTests, resolveContentMetadata } from "./server";
import assert from "node:assert/strict";
import { afterEach } from "node:test";
import test from "node:test";

afterEach(() => {
  __setContentMetadataFetchForTests(null);
  __setUrlSafetyDnsResolversForTests(null);
});

test("resolveContentMetadata returns uploaded image URLs without fetching metadata", async () => {
  const uploadedImageUrl = "https://www.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp";

  assert.deepEqual(await resolveContentMetadata(uploadedImageUrl), {
    thumbnailUrl: uploadedImageUrl,
  });
});

test("resolveContentMetadata does not follow redirects when fetching page metadata", async () => {
  let observedRedirect: RequestRedirect | undefined;
  __setContentMetadataFetchForTests(async (_input, init) => {
    observedRedirect = init?.redirect;
    return new Response(null, {
      headers: {
        location: "https://169.254.169.254/latest/meta-data/",
      },
      status: 302,
      statusText: "Found",
    });
  });

  assert.deepEqual(await resolveContentMetadata("https://example.com/article"), {
    thumbnailUrl: null,
  });
  assert.equal(observedRedirect, "manual");
});

test("resolveContentMetadata uses the public HTTPS fetch guard for generic pages", async () => {
  let observedUrl = "";
  let observedMaxBytes: number | undefined;
  __setUrlSafetyDnsResolversForTests({
    resolve4: async hostname => (hostname === "example.com" ? ["93.184.216.34"] : []),
  });
  __setContentMetadataFetchForTests(async (input, init) => {
    observedUrl = input;
    observedMaxBytes = init?.maxResponseBytes;
    return new Response('<meta property="og:image" content="https://example.com/image.png">', {
      headers: {
        "content-type": "text/html",
      },
      status: 200,
    });
  });

  assert.deepEqual(await resolveContentMetadata("https://example.com/article"), {
    thumbnailUrl: "https://example.com/image.png",
  });
  assert.equal(observedUrl, "https://example.com/article");
  assert.equal(observedMaxBytes, 256_000);
});

test("resolveContentMetadata rejects extracted private-host thumbnail URLs", async () => {
  __setContentMetadataFetchForTests(
    async () =>
      new Response('<meta property="og:image" content="https://169.254.169.254/latest/meta-data/">', {
        headers: {
          "content-type": "text/html",
        },
        status: 200,
      }),
  );

  assert.deepEqual(await resolveContentMetadata("https://example.com/article"), {
    thumbnailUrl: null,
  });
});
