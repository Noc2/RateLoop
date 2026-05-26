import { __setContentMetadataFetchForTests, resolveContentMetadata } from "./server";
import assert from "node:assert/strict";
import { afterEach } from "node:test";
import test from "node:test";

afterEach(() => {
  __setContentMetadataFetchForTests(null);
});

test("resolveContentMetadata returns uploaded image URLs without fetching metadata", async () => {
  const uploadedImageUrl = "https://www.rateloop.xyz/api/attachments/images/att_abcdefghijklmnop.webp";

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
