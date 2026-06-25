import { afterEach, describe, expect, it } from "vitest";

import { buildPonderRequestHeaders } from "../ponder-headers.js";

describe("buildPonderRequestHeaders", () => {
  afterEach(() => {
    delete process.env.PONDER_KEEPER_WORK_TOKEN;
  });

  it("returns bearer authorization when the keeper work token is configured", () => {
    process.env.PONDER_KEEPER_WORK_TOKEN = "keeper-secret";
    expect(buildPonderRequestHeaders()).toEqual({
      authorization: "Bearer keeper-secret",
    });
  });

  it("omits authorization when the keeper work token is unset", () => {
    expect(buildPonderRequestHeaders()).toEqual({});
  });
});
