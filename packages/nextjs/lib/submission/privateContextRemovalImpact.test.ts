import assert from "node:assert/strict";
import test from "node:test";
import {
  getPrivateContextRemovalImpact,
  hasPrivateContextRemovalImpact,
} from "~~/lib/submission/privateContextRemovalImpact";

test("private context removal impact ignores empty public context fields", () => {
  assert.deepEqual(getPrivateContextRemovalImpact({ contextUrl: " ", imageUrls: ["", "  "], videoUrl: "" }), []);
  assert.equal(hasPrivateContextRemovalImpact({ contextUrl: "", videoUrl: "" }), false);
});

test("private context removal impact reports public context URLs and video URLs", () => {
  assert.deepEqual(
    getPrivateContextRemovalImpact({
      contextUrl: " https://example.com/context ",
      videoUrl: " https://youtube.com/watch?v=abc ",
    }),
    [
      {
        kind: "contextUrl",
        label: "Context Source",
        value: "https://example.com/context",
      },
      {
        kind: "videoUrl",
        label: "Video URL",
        value: "https://youtube.com/watch?v=abc",
      },
    ],
  );
});

test("private context removal impact summarizes uploaded image context", () => {
  assert.deepEqual(
    getPrivateContextRemovalImpact({
      imageUrls: [
        "https://rateloop.ai/api/attachments/images/one",
        " ",
        "https://rateloop.ai/api/attachments/images/two",
      ],
    }),
    [
      {
        kind: "imageUrls",
        label: "Uploaded images",
        value: "2 uploaded images",
      },
    ],
  );
  assert.equal(hasPrivateContextRemovalImpact({ imageUrls: ["https://rateloop.ai/api/attachments/images/one"] }), true);
});
