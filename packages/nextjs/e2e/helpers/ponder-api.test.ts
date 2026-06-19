import { buildContentListPath } from "./ponder-api";
import assert from "node:assert/strict";
import test from "node:test";

test("buildContentListPath includes exact content-id and voteable filters", () => {
  assert.equal(
    buildContentListPath({
      contentIds: ["123", 456n],
      limit: 1,
      status: "all",
      voteable: true,
    }),
    "/content?status=all&limit=1&contentIds=123%2C456&voteable=1",
  );
});

test("buildContentListPath omits empty content-id filters", () => {
  assert.equal(buildContentListPath({ contentIds: [], limit: 5 }), "/content?limit=5");
});
