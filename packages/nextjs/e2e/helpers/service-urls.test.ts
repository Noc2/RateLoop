import { buildE2EServiceUrl } from "./service-urls";
import assert from "node:assert/strict";
import test from "node:test";

test("buildE2EServiceUrl appends paths to origin-only service URLs", () => {
  assert.equal(
    buildE2EServiceUrl("https://ponder.example.test", "/content?limit=1"),
    "https://ponder.example.test/content?limit=1",
  );
});

test("buildE2EServiceUrl preserves path-prefixed service URLs", () => {
  assert.equal(
    buildE2EServiceUrl("https://ponder.example.test/ponder", "/content?limit=1"),
    "https://ponder.example.test/ponder/content?limit=1",
  );
  assert.equal(
    buildE2EServiceUrl("https://ponder.example.test/ponder/", "status"),
    "https://ponder.example.test/ponder/status",
  );
});

test("buildE2EServiceUrl preserves path-prefixed Keeper health URLs", () => {
  assert.equal(
    buildE2EServiceUrl("https://keeper.example.test/keeper", "/health"),
    "https://keeper.example.test/keeper/health",
  );
});
