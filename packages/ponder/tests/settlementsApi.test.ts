import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/api/index.ts", import.meta.url),
  "utf8",
);

it("keeps the indexed settlements feed bounded and deployment-scoped", () => {
  expect(source).toMatch(/app\.get\("\/settlements"/u);
  expect(source).toMatch(/commitKeys\.length > 100/u);
  expect(source).toMatch(/new Set\(commitKeys\)\.size !== commitKeys\.length/u);
  expect(source).toMatch(/isHash\(value\)/u);
  expect(source).toMatch(
    /eq\(tokenlessCommit\.deploymentKey, deployment\.deploymentKey\)/u,
  );
  expect(source).toMatch(
    /eq\(tokenlessRound\.deploymentKey, deployment\.deploymentKey\)/u,
  );
  expect(source).toMatch(
    /eq\(tokenlessClaim\.deploymentKey, deployment\.deploymentKey\)/u,
  );
  expect(source).toMatch(/rateloop\.indexed-settlements\.v1/u);
  expect(source).toMatch(/claimDeadline/u);
  expect(source).toMatch(/transactionHash: claim\.txHash/u);
});
