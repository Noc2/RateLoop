import { describe, expect, it } from "vitest";

import { buildPonderUrl } from "../ponder-url.js";

describe("buildPonderUrl", () => {
  it("appends paths to origin-only Ponder base URLs", () => {
    expect(buildPonderUrl("https://ponder.example.test", "/keeper/work").toString()).toBe(
      "https://ponder.example.test/keeper/work",
    );
  });

  it("preserves path-prefixed Ponder base URLs", () => {
    expect(buildPonderUrl("https://ponder.example.test/ponder", "/keeper/work").toString()).toBe(
      "https://ponder.example.test/ponder/keeper/work",
    );
    expect(buildPonderUrl("https://ponder.example.test/ponder/", "rounds").toString()).toBe(
      "https://ponder.example.test/ponder/rounds",
    );
  });
});
