import {
  UNSUPPORTED_QUESTION_SUBMISSION_DEPLOYMENT_ERROR,
  assertContentRegistryQuestionSubmissionSelector,
} from "./questionSubmissionSelectorSupport";
import assert from "node:assert/strict";
import test from "node:test";

const REGISTRY_ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const IMPLEMENTATION_ADDRESS = "0x2222222222222222222222222222222222222222" as const;

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

test("selector probe accepts stripped revert strings when the selector is in registry bytecode", async () => {
  await assertContentRegistryQuestionSubmissionSelector(
    {
      call: async () => {
        throw { shortMessage: "execution reverted" };
      },
      getBytecode: async () => "0x6000339aaa8455",
    },
    REGISTRY_ADDRESS,
    "single",
  );
});

test("selector probe accepts stripped revert strings when the selector is in an EIP-1967 implementation", async () => {
  const bytecodeAddresses: `0x${string}`[] = [];

  await assertContentRegistryQuestionSubmissionSelector(
    {
      call: async () => {
        throw { shortMessage: "execution reverted" };
      },
      getBytecode: async ({ address }) => {
        bytecodeAddresses.push(address);
        return address === IMPLEMENTATION_ADDRESS ? "0x60004bef786955" : "0x6000";
      },
      getStorageAt: async () => `0x${"0".repeat(24)}${IMPLEMENTATION_ADDRESS.slice(2)}`,
    },
    REGISTRY_ADDRESS,
    "bundle",
  );

  assert.deepEqual(bytecodeAddresses, [REGISTRY_ADDRESS, IMPLEMENTATION_ADDRESS]);
});

test("selector probe treats stripped revert strings as inconclusive when bytecode is unavailable", async () => {
  await assertContentRegistryQuestionSubmissionSelector(
    {
      call: async () => {
        throw { shortMessage: "execution reverted" };
      },
    },
    REGISTRY_ADDRESS,
    "single",
  );
});

test("selector probe rejects deployments with an empty unknown revert and missing selector", async () => {
  await assert.rejects(
    () =>
      assertContentRegistryQuestionSubmissionSelector(
        {
          call: async () => {
            throw { shortMessage: "Execution reverted for an unknown reason." };
          },
          getBytecode: async () => "0x6000",
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
