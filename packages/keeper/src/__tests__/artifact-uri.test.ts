import { describe, expect, it } from "vitest";

import { resolveAllowedArtifactUri } from "../artifact-uri.js";

describe("resolveAllowedArtifactUri", () => {
  it("accepts data URIs without an allowlist", () => {
    expect(resolveAllowedArtifactUri("data:application/json;base64,e30=", "")).toBe(
      "data:application/json;base64,e30=",
    );
  });

  it("accepts HTTPS artifact URLs under an allowed prefix", () => {
    expect(
      resolveAllowedArtifactUri(
        "https://artifacts.example.test/rateloop/0xabc.json",
        "https://artifacts.example.test/rateloop",
      ),
    ).toBe("https://artifacts.example.test/rateloop/0xabc.json");
  });

  it("accepts explicitly allowlisted loopback HTTP artifact URLs", () => {
    expect(
      resolveAllowedArtifactUri(
        "http://127.0.0.1:9091/correlation-artifacts/0xabc.json",
        "http://127.0.0.1:9091/correlation-artifacts",
      ),
    ).toBe("http://127.0.0.1:9091/correlation-artifacts/0xabc.json");
  });

  it("rejects loopback HTTP artifact URLs outside the allowed prefix", () => {
    expect(
      resolveAllowedArtifactUri(
        "http://127.0.0.1:9091/private/0xabc.json",
        "http://127.0.0.1:9091/correlation-artifacts",
      ),
    ).toBeNull();
  });

  it("rejects remote HTTP artifact URLs even when listed", () => {
    expect(
      resolveAllowedArtifactUri(
        "http://artifacts.example.test/rateloop/0xabc.json",
        "http://artifacts.example.test/rateloop",
      ),
    ).toBeNull();
  });
});
