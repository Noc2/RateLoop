import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readDistFile(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("built local signer dist", () => {
  it("includes the Feedback Bonus confirmation flow in shipped JavaScript", () => {
    for (const path of [
      "../../dist/esm/localSigner.js",
      "../../dist/cjs/localSigner.js",
    ]) {
      const builtLocalSigner = readDistFile(path);

      expect(builtLocalSigner).toContain("confirmFeedbackBonusTransactions");
      expect(builtLocalSigner).toContain('plan: "feedback_bonus"');
      expect(builtLocalSigner).toContain("feedbackBonusConfirmed");
      expect(builtLocalSigner).toContain("feedbackBonusTransactions");
    }
  });

  it("includes the Feedback Bonus confirmation surface in shipped types", () => {
    const builtLocalSignerTypes = readDistFile("../../dist/esm/localSigner.d.ts");

    expect(builtLocalSignerTypes).toContain(
      'Partial<Pick<RateLoopAgentClient, "confirmFeedbackBonusTransactions">>',
    );
    expect(builtLocalSignerTypes).toContain("feedbackBonusConfirmed?");
    expect(builtLocalSignerTypes).toContain("feedbackBonusTransactions?");
  });
});
