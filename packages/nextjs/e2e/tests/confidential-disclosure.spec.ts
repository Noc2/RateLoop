import { expect, test } from "@playwright/test";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import {
  CONFIDENTIALITY_FLAG_PRIVATE_FOREVER,
  attachHostedQuestionDetails,
  submitHostedGatedQuestionDirect,
  triggerDisclosureReconcile,
  uploadGatedQuestionDetails,
  upsertQuestionConfidentialityForE2E,
} from "../helpers/confidentiality";
import { settleRoundWithVotes } from "../helpers/correlation";
import { ponderGet } from "../helpers/ponder-api";
import { waitForPonderIndexed } from "../helpers/admin-helpers";

const EPOCH_DURATION = 300;

test.describe("Confidential disclosure after settlement", () => {
  test.describe.configure({ mode: "serial" });

  test("publishes after-settlement hosted details while private-forever details stay gated", async ({ request }) => {
    test.setTimeout(420_000);

    const submitter = ANVIL_ACCOUNTS.account2;
    const uniqueId = Date.now();
    const afterText = `After-settlement private evidence ${uniqueId}`;
    const foreverText = `Private-forever evidence ${uniqueId}`;

    const [afterDetails, foreverDetails] = await Promise.all([
      uploadGatedQuestionDetails(request, submitter, afterText),
      uploadGatedQuestionDetails(request, submitter, foreverText),
    ]);

    const afterQuestion = await submitHostedGatedQuestionDirect({
      description: afterText,
      detailsHash: afterDetails.detailsHash,
      detailsUrl: afterDetails.detailsUrl,
      flags: 0,
      roundConfig: { epochDuration: EPOCH_DURATION, maxDuration: EPOCH_DURATION, minVoters: 3, maxVoters: 100 },
      submitter,
      title: `After-settlement disclosure ${uniqueId}`,
    });
    await attachHostedQuestionDetails(request, afterQuestion);
    await upsertQuestionConfidentialityForE2E({
      contentId: afterQuestion.contentId,
      detailsHash: afterQuestion.detailsHash,
      disclosurePolicy: "after_settlement",
    });

    const foreverQuestion = await submitHostedGatedQuestionDirect({
      description: foreverText,
      detailsHash: foreverDetails.detailsHash,
      detailsUrl: foreverDetails.detailsUrl,
      flags: CONFIDENTIALITY_FLAG_PRIVATE_FOREVER,
      roundConfig: { epochDuration: EPOCH_DURATION, maxDuration: EPOCH_DURATION, minVoters: 3, maxVoters: 100 },
      submitter,
      title: `Private-forever disclosure ${uniqueId}`,
    });
    await attachHostedQuestionDetails(request, foreverQuestion);
    await upsertQuestionConfidentialityForE2E({
      contentId: foreverQuestion.contentId,
      detailsHash: foreverQuestion.detailsHash,
      disclosurePolicy: "private_forever",
    });

    const beforeSettlement = await ponderGet(`/content/${afterQuestion.contentId}`);
    expect(beforeSettlement.content.description).toBe("");
    expect(beforeSettlement.content.detailsUrl).toBeNull();

    await settleRoundWithVotes(
      BigInt(afterQuestion.contentId),
      [
        { account: ANVIL_ACCOUNTS.account3, isUp: true },
        { account: ANVIL_ACCOUNTS.account4, isUp: true },
        { account: ANVIL_ACCOUNTS.account5, isUp: false },
      ],
      { epochDuration: EPOCH_DURATION },
    );
    await settleRoundWithVotes(
      BigInt(foreverQuestion.contentId),
      [
        { account: ANVIL_ACCOUNTS.account6, isUp: true },
        { account: ANVIL_ACCOUNTS.account7, isUp: true },
        { account: ANVIL_ACCOUNTS.account8, isUp: false },
      ],
      { epochDuration: EPOCH_DURATION },
    );

    const reconcile = await triggerDisclosureReconcile(request, [
      afterQuestion.contentId,
      foreverQuestion.contentId,
    ]);
    expect(reconcile.published).toBe(1);

    // Gated submissions keep hosted details URLs off-chain; Ponder proves disclosure by unredacting public text.
    const ponderDisclosed = await waitForPonderIndexed(
      async () => {
        const after = await ponderGet(`/content/${afterQuestion.contentId}`);
        return after.content.description === afterText && after.content.contextAccess === "public";
      },
      120_000,
      2_000,
      "confidential-disclosure:ponder-after-settlement-public",
    );
    expect(ponderDisclosed, "Ponder should unredact after-settlement context after settlement").toBe(true);

    const foreverStayedPrivate = await waitForPonderIndexed(
      async () => {
        const forever = await ponderGet(`/content/${foreverQuestion.contentId}`);
        return (
          forever.content.description === "" &&
          forever.content.detailsUrl === null &&
          forever.content.contextAccess === "gated"
        );
      },
      60_000,
      2_000,
      "confidential-disclosure:ponder-private-forever-gated",
    );
    expect(foreverStayedPrivate, "Ponder should keep private-forever context redacted after settlement").toBe(true);

    const publicAfterDetails = await request.get(afterQuestion.detailsUrl!);
    expect(publicAfterDetails.status()).toBe(200);
    expect(publicAfterDetails.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(publicAfterDetails.headers()["x-rateloop-view-token"]).toBeUndefined();
    expect(await publicAfterDetails.text()).toBe(afterText);

    const privateForeverDetails = await request.get(foreverQuestion.detailsUrl!);
    expect(privateForeverDetails.status()).toBe(401);
    expect(privateForeverDetails.headers()["cache-control"]).toBe("private, no-store");
    await expect(privateForeverDetails.json()).resolves.toEqual({ error: "Signed wallet session required" });

    const idempotentReconcile = await triggerDisclosureReconcile(request, [afterQuestion.contentId]);
    expect(idempotentReconcile.published).toBe(0);
  });
});
