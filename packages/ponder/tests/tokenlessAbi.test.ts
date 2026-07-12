import { describe, expect, it } from "vitest";
import { tokenlessPanelAbi } from "../src/tokenlessAbi";

describe("tokenless panel indexing ABI", () => {
  it("includes the complete pull-credit evidence surface", () => {
    const events = new Set(
      tokenlessPanelAbi
        .filter((entry) => entry.type === "event")
        .map((entry) => entry.name),
    );
    const functions = new Set(
      tokenlessPanelAbi
        .filter((entry) => entry.type === "function")
        .map((entry) => entry.name),
    );

    expect(events).toContain("CreditAccrued");
    expect(events).toContain("CreditWithdrawn");
    expect(functions).toContain("withdrawableCredit");
  });
});
