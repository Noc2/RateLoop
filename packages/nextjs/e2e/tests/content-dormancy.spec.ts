import { approveLREP, markDormant, reviveContent, waitForPonderIndexed } from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import { fastForwardTime } from "../helpers/keeper";
import { getContentById, getContentList } from "../helpers/ponder-api";
import { expect, test } from "@playwright/test";

/**
 * Content dormancy lifecycle tests.
 * Triggers Ponder events: ContentDormant, ContentRevived.
 *
 * Requires a 30-day time skip via evm_increaseTime. Must run AFTER all normal
 * tests to avoid disrupting time-sensitive operations (voting, settlement).
 *
 * Account allocation:
 * - Account #0 (deployer) — calls markDormant (permissionless, but we use #0 for simplicity)
 * - Original seeded submitter — revives dormant content during the exclusive revival window
 */
test.describe("Content dormancy lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  const CONTENT_REGISTRY = CONTRACT_ADDRESSES.ContentRegistry;
  const LREP_TOKEN = CONTRACT_ADDRESSES.LoopReputation;

  // DORMANCY_PERIOD = 30 days = 2_592_000 seconds
  const DORMANCY_SECONDS = 2_592_001; // 30 days + 1 second buffer

  let dormantContentId: string | null = null;
  let dormantSubmitterAddress: string | null = null;

  test("mark content as dormant after 30-day time skip", async () => {
    test.setTimeout(120_000);

    // Find an active piece of content to mark as dormant. Long lifecycle runs
    // leave a mix of active, settled, and recently touched content in Ponder, so
    // confirm dormancy eligibility against the contract after the time skip.
    let targetContentId: string | null = null;
    let targetSubmitterAddress: string | null = null;
    let candidateContentIds: string[] = [];
    try {
      const { items } = await getContentList({ status: "0", limit: 100 });
      candidateContentIds = items
        .filter(item => item.status === 0)
        .sort((left, right) => {
          const leftSeedPriority = Number(left.id) >= 8 && Number(left.id) <= 13 ? 0 : 1;
          const rightSeedPriority = Number(right.id) >= 8 && Number(right.id) <= 13 ? 0 : 1;
          if (leftSeedPriority !== rightSeedPriority) return leftSeedPriority - rightSeedPriority;
          return Number(left.id) - Number(right.id);
        })
        .map(item => item.id);
    } catch {
      test.skip(true, "Ponder not available — cannot find content for dormancy test");
      return;
    }

    if (candidateContentIds.length === 0) {
      test.skip(true, "No active content available for dormancy test");
      return;
    }

    // Fast-forward 30+ days
    await fastForwardTime(DORMANCY_SECONDS);

    for (const candidateContentId of candidateContentIds) {
      const { content: before } = await getContentById(candidateContentId);
      if (before.status !== 0) continue;

      const success = await markDormant(BigInt(candidateContentId), ANVIL_ACCOUNTS.account0.address, CONTENT_REGISTRY);
      if (!success) continue;

      targetContentId = candidateContentId;
      targetSubmitterAddress = before.submitter;
      break;
    }

    expect(targetContentId, "No active content could be marked dormant after the dormancy time skip").toBeTruthy();
    expect(targetSubmitterAddress, "Dormancy target should keep its original submitter").toBeTruthy();
    if (!targetContentId || !targetSubmitterAddress) {
      throw new Error("Missing marked dormant content target after successful dormancy selection");
    }

    // Wait for Ponder to index the dormancy (60s — after 30-day time skip Ponder needs time)
    const indexed = await waitForPonderIndexed(async () => {
      const { content } = await getContentById(targetContentId);
      return content.status === 1; // Dormant
    }, 60_000);

    expect(indexed, "Ponder did not index dormancy within 60s — on-chain tx succeeded").toBe(true);

    dormantContentId = targetContentId;
    dormantSubmitterAddress = targetSubmitterAddress;
    const { content: after } = await getContentById(targetContentId);
    expect(after.status).toBe(1); // Dormant
  });

  test("revive dormant content and Ponder indexes revival", async () => {
    test.skip(!dormantContentId || !dormantSubmitterAddress, "No dormant content from previous test");
    test.setTimeout(60_000);

    // Approve 5 LREP (5e6) to ContentRegistry for the revival stake
    const approveSuccess = await approveLREP(CONTENT_REGISTRY, BigInt(5e6), dormantSubmitterAddress!, LREP_TOKEN);
    expect(approveSuccess).toBe(true);

    // Revive content during the submitter-only exclusive window.
    const success = await reviveContent(BigInt(dormantContentId!), dormantSubmitterAddress!, CONTENT_REGISTRY);
    expect(success).toBe(true);

    // Wait for Ponder to index the revival (60s — large time skips slow Ponder)
    const indexed = await waitForPonderIndexed(async () => {
      const { content } = await getContentById(dormantContentId!);
      return content.status === 0; // Active again
    }, 60_000);

    expect(indexed, "Ponder did not index revival within 60s — on-chain tx succeeded").toBe(true);

    const { content: after } = await getContentById(dormantContentId!);
    expect(after.status).toBe(0); // Active
  });

  test("second dormancy + revival cycle succeeds (revival #2)", async () => {
    test.skip(!dormantContentId || !dormantSubmitterAddress, "No content from previous tests");
    test.setTimeout(120_000);

    // Fast-forward another 30 days
    await fastForwardTime(DORMANCY_SECONDS);

    // Mark dormant again
    const markSuccess = await markDormant(BigInt(dormantContentId!), ANVIL_ACCOUNTS.account0.address, CONTENT_REGISTRY);
    expect(markSuccess).toBe(true);

    // Approve + revive (2nd revival)
    const approveSuccess = await approveLREP(CONTENT_REGISTRY, BigInt(5e6), dormantSubmitterAddress!, LREP_TOKEN);
    expect(approveSuccess).toBe(true);

    const reviveSuccess = await reviveContent(BigInt(dormantContentId!), dormantSubmitterAddress!, CONTENT_REGISTRY);
    expect(reviveSuccess).toBe(true);

    // Verify content is active again (60s timeout for Ponder after time skips)
    const indexed = await waitForPonderIndexed(async () => {
      const { content } = await getContentById(dormantContentId!);
      return content.status === 0;
    }, 60_000);

    expect(indexed, "Ponder did not index 2nd revival within 60s — on-chain tx succeeded").toBe(true);

    const { content } = await getContentById(dormantContentId!);
    expect(content.status).toBe(0);
  });

  test("third revival attempt is rejected (MAX_REVIVALS = 2)", async () => {
    test.skip(!dormantContentId || !dormantSubmitterAddress, "No content from previous tests");
    test.setTimeout(120_000);

    // Fast-forward another 30 days
    await fastForwardTime(DORMANCY_SECONDS);

    // Mark dormant again
    const markSuccess = await markDormant(BigInt(dormantContentId!), ANVIL_ACCOUNTS.account0.address, CONTENT_REGISTRY);
    expect(markSuccess).toBe(true);

    // Approve LREP for the revival attempt
    await approveLREP(CONTENT_REGISTRY, BigInt(5e6), dormantSubmitterAddress!, LREP_TOKEN);

    // 3rd revival should FAIL (MAX_REVIVALS = 2)
    const reviveSuccess = await reviveContent(BigInt(dormantContentId!), dormantSubmitterAddress!, CONTENT_REGISTRY);
    expect(reviveSuccess).toBe(false);
  });
});
