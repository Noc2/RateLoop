import { getVisualViewportBottom, resolveMobileDockReservedSpace } from "./mobileDockReservedSpace";
import assert from "node:assert/strict";
import test from "node:test";

test("getVisualViewportBottom includes the visual viewport offset", () => {
  assert.equal(
    getVisualViewportBottom({
      innerHeight: 844,
      visualViewport: { height: 650, offsetTop: 48 },
    }),
    698,
  );
});

test("getVisualViewportBottom falls back to innerHeight without visual viewport metrics", () => {
  assert.equal(getVisualViewportBottom({ innerHeight: 844, visualViewport: null }), 844);
});

test("resolveMobileDockReservedSpace uses the visual viewport bottom edge", () => {
  assert.equal(
    resolveMobileDockReservedSpace({
      dockTop: 560,
      minimumReservedSpace: 152,
      viewportBottom: 698,
    }),
    152,
  );
  assert.equal(
    resolveMobileDockReservedSpace({
      dockTop: 500,
      minimumReservedSpace: 152,
      viewportBottom: 698,
    }),
    198,
  );
});
