import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readDistFile(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("built local signer dist", () => {
  it("does not include a standalone Feedback Bonus confirmation flow in shipped JavaScript", () => {
    for (const path of [
      "../../dist/esm/localSigner.js",
      "../../dist/cjs/localSigner.js",
    ]) {
      const builtLocalSigner = readDistFile(path);

      expect(builtLocalSigner).not.toContain("confirmFeedbackBonusTransactions");
      expect(builtLocalSigner).not.toContain('plan: "feedback_bonus"');
      expect(builtLocalSigner).not.toContain("feedbackBonusConfirmed");
      expect(builtLocalSigner).not.toContain("feedbackBonusTransactions");
    }
  });

  it("does not include a standalone Feedback Bonus confirmation surface in shipped types", () => {
    const builtLocalSignerTypes = readDistFile("../../dist/esm/localSigner.d.ts");

    expect(builtLocalSignerTypes).not.toContain("confirmFeedbackBonusTransactions");
    expect(builtLocalSignerTypes).not.toContain("feedbackBonusConfirmed?");
    expect(builtLocalSignerTypes).not.toContain("feedbackBonusTransactions?");
  });
});
