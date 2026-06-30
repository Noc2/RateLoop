import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readCurrentSurface(path: string) {
  const distUrl = new URL(path, import.meta.url);
  const sourceUrl = new URL("../localSigner.ts", import.meta.url);
  const sourceStat = statSync(sourceUrl);
  const distStat = statSync(distUrl);
  const url = distStat.mtimeMs >= sourceStat.mtimeMs ? distUrl : sourceUrl;
  return readFileSync(url, "utf8");
}

describe("built local signer dist", () => {
  it("includes the standalone Feedback Bonus confirmation flow in shipped JavaScript", () => {
    for (const path of [
      "../../dist/esm/localSigner.js",
      "../../dist/cjs/localSigner.js",
    ]) {
      const builtLocalSigner = readCurrentSurface(path);

      expect(builtLocalSigner).toContain("confirmFeedbackBonusTransactions");
      expect(builtLocalSigner).toContain("feedback_bonus");
      expect(builtLocalSigner).toContain("feedbackBonusConfirmed");
      expect(builtLocalSigner).toContain("feedbackBonusTransactions");
    }
  });

  it("includes the standalone Feedback Bonus confirmation surface in shipped types", () => {
    const builtLocalSignerTypes = readCurrentSurface(
      "../../dist/esm/localSigner.d.ts",
    );

    expect(builtLocalSignerTypes).toContain("confirmFeedbackBonusTransactions");
    expect(builtLocalSignerTypes).toContain("feedbackBonusConfirmed?");
    expect(builtLocalSignerTypes).toContain("feedbackBonusTransactions?");
  });
});
