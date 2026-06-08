import {
  UNSUPPORTED_QUESTION_SUBMISSION_DEPLOYMENT_ERROR,
  assertContentRegistryQuestionSubmissionSelector,
} from "./questionSubmissionSelectorSupport";
import assert from "node:assert/strict";
import test from "node:test";

const REGISTRY_ADDRESS = "0x1111111111111111111111111111111111111111" as const;

test("single question selector probe accepts the expected validation revert", async () => {
  const probedData: `0x${string}`[] = [];

  await assertContentRegistryQuestionSubmissionSelector(
    {
      call: async ({ data }) => {
        probedData.push(data);
        throw { shortMessage: "Context or media required" };
      },
    },
    REGISTRY_ADDRESS,
    "single",
  );

  assert.equal(probedData[0]?.slice(0, 10), "0x339aaa84");
});

test("bundle selector probe accepts the expected validation revert", async () => {
  const probedData: `0x${string}`[] = [];

  await assertContentRegistryQuestionSubmissionSelector(
    {
      call: async ({ data }) => {
        probedData.push(data);
        throw { shortMessage: "No questions" };
      },
    },
    REGISTRY_ADDRESS,
    "bundle",
  );

  assert.equal(probedData[0]?.slice(0, 10), "0x4bef7869");
});

test("selector probe rejects deployments with an empty unknown revert", async () => {
  await assert.rejects(
    () =>
      assertContentRegistryQuestionSubmissionSelector(
        {
          call: async () => {
            throw { shortMessage: "Execution reverted for an unknown reason." };
          },
        },
        REGISTRY_ADDRESS,
        "single",
      ),
    new Error(UNSUPPORTED_QUESTION_SUBMISSION_DEPLOYMENT_ERROR),
  );
});

test("selector probe skips when a public client is unavailable", async () => {
  await assertContentRegistryQuestionSubmissionSelector(undefined, REGISTRY_ADDRESS, "single");
});
