import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CURRENT_DEPLOYMENT_SURFACES = [
  new URL("../.env.example", import.meta.url),
  new URL("../.gitignore", import.meta.url),
  new URL("../Makefile", import.meta.url),
];

test("current Foundry deployment surfaces identify only tokenless-v4", () => {
  for (const file of CURRENT_DEPLOYMENT_SURFACES) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /tokenless-v4/u, file.pathname);
    assert.doesNotMatch(source, /tokenless-v[123](?![0-9])/u, file.pathname);
  }
});
