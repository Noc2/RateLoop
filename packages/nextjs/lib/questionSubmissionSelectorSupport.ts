import { ContentRegistryAbi } from "@rateloop/contracts/abis";
import { encodeFunctionData } from "viem";

type SelectorProbePublicClient = {
  call: (args: { to: `0x${string}`; data: `0x${string}` }) => Promise<unknown>;
};

type QuestionSubmissionSelectorKind = "single" | "bundle";

export const UNSUPPORTED_QUESTION_SUBMISSION_DEPLOYMENT_ERROR =
  "This ContentRegistry deployment does not support question submissions. Ask the operator to upgrade it or point the app at a compatible deployment.";

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;

export function getSubmissionErrorMessage(error: unknown): string {
  return (
    (error as { shortMessage?: string; message?: string } | undefined)?.shortMessage ??
    (error as { shortMessage?: string; message?: string } | undefined)?.message ??
    ""
  );
}

export function isUnknownEmptyRevertError(error: unknown): boolean {
  const message = getSubmissionErrorMessage(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("execution reverted for an unknown reason") ||
    message.includes('data: "0x"') ||
    message.includes("data: 0x") ||
    message.includes("EvmError: Revert") ||
    normalized.trim() === "execution reverted"
  );
}

function buildQuestionSubmissionSelectorProbeData(kind: QuestionSubmissionSelectorKind): `0x${string}` {
  if (kind === "bundle") {
    return encodeFunctionData({
      abi: ContentRegistryAbi,
      functionName: "submitQuestionBundleWithRewardAndRoundConfig",
      args: [
        [],
        {
          asset: 0,
          amount: 0n,
          requiredVoters: 0n,
          requiredSettledRounds: 0n,
          bountyStartBy: 0n,
          bountyWindowSeconds: 0n,
          feedbackWindowSeconds: 0n,
          bountyEligibility: 0,
        },
        {
          epochDuration: 60,
          maxDuration: 60,
          minVoters: 3,
          maxVoters: 3,
        },
      ],
    });
  }

  return encodeFunctionData({
    abi: ContentRegistryAbi,
    functionName: "submitQuestionWithRewardAndRoundConfig",
    args: [
      "",
      [],
      "",
      "",
      "",
      0n,
      { detailsUrl: "", detailsHash: ZERO_BYTES32 },
      ZERO_BYTES32,
      {
        asset: 0,
        amount: 0n,
        requiredVoters: 0n,
        requiredSettledRounds: 0n,
        bountyStartBy: 0n,
        bountyWindowSeconds: 0n,
        feedbackWindowSeconds: 0n,
        bountyEligibility: 0,
      },
      {
        epochDuration: 60,
        maxDuration: 60,
        minVoters: 3,
        maxVoters: 3,
      },
      { questionMetadataHash: ZERO_BYTES32, resultSpecHash: ZERO_BYTES32 },
    ],
  });
}

function isExpectedSelectorProbeRevert(kind: QuestionSubmissionSelectorKind, message: string): boolean {
  if (kind === "bundle") return message.includes("No questions");
  return message.includes("Context or media required");
}

export async function assertContentRegistryQuestionSubmissionSelector(
  publicClient: SelectorProbePublicClient | undefined,
  registryAddress: `0x${string}`,
  kind: QuestionSubmissionSelectorKind,
) {
  if (!publicClient) return;

  try {
    await publicClient.call({
      to: registryAddress,
      data: buildQuestionSubmissionSelectorProbeData(kind),
    });
  } catch (error) {
    const message = getSubmissionErrorMessage(error);
    if (isExpectedSelectorProbeRevert(kind, message)) return;
    if (isUnknownEmptyRevertError(error)) {
      throw new Error(UNSUPPORTED_QUESTION_SUBMISSION_DEPLOYMENT_ERROR);
    }
  }
}
