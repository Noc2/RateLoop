import {
  appendFeedbackBonusPoolCreationRecoveryHash,
  appendFeedbackBonusRecoveryHash,
  isFeedbackBonusPoolCreationCall,
  readFeedbackBonusRecoveryStorageValue,
  serializeFeedbackBonusRecoveryStorageValue,
} from "./feedbackBonusRecovery";
import assert from "node:assert/strict";
import test from "node:test";

const VALID_HASH = `0x${"1".repeat(64)}`;
const SECOND_HASH = `0x${"2".repeat(64)}`;

test("Feedback Bonus recovery records only valid pool creation transaction hashes", () => {
  assert.equal(isFeedbackBonusPoolCreationCall({ functionName: "createFeedbackBonusPoolWithAsset" }), true);
  assert.equal(isFeedbackBonusPoolCreationCall({ phase: "create_feedback_bonus_pool" }), true);
  assert.equal(isFeedbackBonusPoolCreationCall({ id: "create-feedback-bonus-pool" }), true);
  assert.equal(isFeedbackBonusPoolCreationCall({ functionName: "approve" }), false);

  assert.deepEqual(
    appendFeedbackBonusPoolCreationRecoveryHash({
      call: { functionName: "approve" },
      hash: VALID_HASH,
      hashes: [],
    }),
    [],
  );
  assert.deepEqual(
    appendFeedbackBonusPoolCreationRecoveryHash({
      call: { phase: "create_feedback_bonus_pool" },
      hash: "0xnot-a-transaction-hash",
      hashes: [],
    }),
    [],
  );
  assert.deepEqual(
    appendFeedbackBonusPoolCreationRecoveryHash({
      call: { phase: "create_feedback_bonus_pool" },
      hash: VALID_HASH,
      hashes: [],
    }),
    [VALID_HASH],
  );
});

test("Feedback Bonus recovery de-duplicates hashes and persists operation-scoped storage", () => {
  assert.deepEqual(appendFeedbackBonusRecoveryHash([VALID_HASH], VALID_HASH), [VALID_HASH]);
  assert.deepEqual(appendFeedbackBonusRecoveryHash([VALID_HASH], SECOND_HASH), [VALID_HASH, SECOND_HASH]);

  const serialized = serializeFeedbackBonusRecoveryStorageValue({
    hashes: [VALID_HASH, "0xinvalid", SECOND_HASH],
    operationKey: "operation-1",
  });
  assert.ok(serialized);
  assert.deepEqual(readFeedbackBonusRecoveryStorageValue(serialized, "operation-1"), [VALID_HASH, SECOND_HASH]);
  assert.deepEqual(readFeedbackBonusRecoveryStorageValue(serialized, "operation-2"), []);
  assert.equal(
    serializeFeedbackBonusRecoveryStorageValue({
      hashes: [VALID_HASH],
      operationKey: null,
    }),
    null,
  );
});
