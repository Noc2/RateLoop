import { directPrivateReviewPanelResolution } from "./privateReviewResponses";
import assert from "node:assert/strict";
import test from "node:test";

test("a panel resolves as soon as one side holds an unassailable majority", () => {
  // Panel of three: two agreeing answers decide it, so the third seat is not waited on.
  assert.deepEqual(directPrivateReviewPanelResolution({ panelSize: 3, positive: 2, negative: 0 }), {
    panelComplete: false,
    decisiveMajority: true,
    resolved: true,
  });
  assert.deepEqual(directPrivateReviewPanelResolution({ panelSize: 3, positive: 0, negative: 2 }), {
    panelComplete: false,
    decisiveMajority: true,
    resolved: true,
  });
  assert.equal(directPrivateReviewPanelResolution({ panelSize: 5, positive: 3, negative: 1 }).resolved, true);
});

test("a panel stays open while the outstanding seats could still overturn the lead", () => {
  assert.deepEqual(directPrivateReviewPanelResolution({ panelSize: 3, positive: 1, negative: 0 }), {
    panelComplete: false,
    decisiveMajority: false,
    resolved: false,
  });
  assert.equal(directPrivateReviewPanelResolution({ panelSize: 3, positive: 1, negative: 1 }).resolved, false);
  assert.equal(directPrivateReviewPanelResolution({ panelSize: 5, positive: 2, negative: 1 }).resolved, false);
  assert.equal(directPrivateReviewPanelResolution({ panelSize: 2, positive: 1, negative: 0 }).resolved, false);
});

test("a full panel always resolves, including a tie that no majority can break", () => {
  // Two experts who disagree is genuinely inconclusive, and the caller must be told so
  // rather than shown a fabricated winner. The panel is complete, so it resolves.
  assert.deepEqual(directPrivateReviewPanelResolution({ panelSize: 2, positive: 1, negative: 1 }), {
    panelComplete: true,
    decisiveMajority: false,
    resolved: true,
  });
  assert.deepEqual(directPrivateReviewPanelResolution({ panelSize: 2, positive: 2, negative: 0 }), {
    panelComplete: true,
    decisiveMajority: true,
    resolved: true,
  });
  assert.equal(directPrivateReviewPanelResolution({ panelSize: 4, positive: 2, negative: 2 }).resolved, true);
});

test("an empty panel is unresolved, so a deadline elapses under quorum rather than deciding", () => {
  assert.equal(directPrivateReviewPanelResolution({ panelSize: 2, positive: 0, negative: 0 }).resolved, false);
  assert.equal(directPrivateReviewPanelResolution({ panelSize: 3, positive: 0, negative: 0 }).resolved, false);
});

test("a decisive side can never be overtaken by the seats still outstanding", () => {
  for (let panelSize = 2; panelSize <= 12; panelSize += 1) {
    for (let positive = 0; positive <= panelSize; positive += 1) {
      for (let negative = 0; negative <= panelSize - positive; negative += 1) {
        const { decisiveMajority } = directPrivateReviewPanelResolution({ panelSize, positive, negative });
        if (!decisiveMajority) continue;
        const leader = Math.max(positive, negative);
        // Every seat that has not answered is assumed to go to the other side.
        const bestPossibleOpponent = panelSize - leader;
        assert.ok(
          leader > bestPossibleOpponent,
          `panel ${panelSize} called at ${positive}/${negative} but ${bestPossibleOpponent} could still oppose`,
        );
      }
    }
  }
});
