import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("keeper startup order", () => {
  it("does not bind the metrics listener before all fail-closed validation passes", () => {
    const source = readFileSync(
      new URL("../index.ts", import.meta.url),
      "utf8",
    );
    const metricsListener = source.indexOf(
      "const metricsServer = startMetricsServer(",
    );

    expect(metricsListener).toBeGreaterThan(
      source.indexOf("await validateKeeperSigner()"),
    );
    expect(metricsListener).toBeGreaterThan(
      source.indexOf("await validateKeeperConnectivity(publicClient)"),
    );
    expect(metricsListener).toBeGreaterThan(
      source.indexOf("await validateTokenlessKeeperDeployment(clients, config)"),
    );
  });
});
