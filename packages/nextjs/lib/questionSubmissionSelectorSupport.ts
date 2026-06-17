import { ContentRegistryAbi } from "@rateloop/contracts/abis";
import { type Abi, encodeFunctionData } from "viem";

type SelectorProbePublicClient = {
  call: (args: { to: `0x${string}`; data: `0x${string}` }) => Promise<unknown>;
  getBytecode?: (args: { address: `0x${string}` }) => Promise<`0x${string}` | undefined>;
  getStorageAt?: (args: { address: `0x${string}`; slot: `0x${string}` }) => Promise<`0x${string}` | undefined>;
};

type QuestionSubmissionSelectorKind = "single" | "bundle";

export const UNSUPPORTED_QUESTION_SUBMISSION_DEPLOYMENT_ERROR =
  "This ContentRegistry deployment does not support question submissions. Ask the operator to upgrade it or point the app at a compatible deployment.";

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;
const PUBLIC_CONFIDENTIALITY_CONFIG = {
  gated: false,
  bondAsset: 0,
  bondAmount: 0n,
  flags: 0,
} as const;
const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const ZERO_ADDRESS = `0x${"0".repeat(40)}` as `0x${string}`;
const ContentRegistrySubmitQuestionWithConfidentialityAbi = ContentRegistryAbi.filter(
  item =>
    item.type === "function" && item.name === "submitQuestionWithRewardAndRoundConfig" && item.inputs.length === 12,
) as Abi;

export function getSubmissionErrorMessage(error: unknown): string {
  return (
    (error as { shortMessage?: string; message?: string } | undefined)?.shortMessage ??
    (error as { shortMessage?: string; message?: string } | undefined)?.message ??
    ""
  );
}

function isUnknownEmptyRevertError(error: unknown): boolean {
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
    abi: ContentRegistrySubmitQuestionWithConfidentialityAbi,
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
      PUBLIC_CONFIDENTIALITY_CONFIG,
    ],
  });
}

function isExpectedSelectorProbeRevert(kind: QuestionSubmissionSelectorKind, message: string): boolean {
  if (kind === "bundle") return message.includes("No questions");
  return message.includes("Context or media required");
}

function bytecodeContainsSelector(bytecode: `0x${string}` | undefined, selector: `0x${string}`): boolean {
  return Boolean(bytecode && bytecode.toLowerCase().includes(selector.slice(2).toLowerCase()));
}

function selectorFromData(data: `0x${string}`): `0x${string}` {
  return data.slice(0, 10) as `0x${string}`;
}

function addressFromEip1967Slot(value: `0x${string}` | undefined): `0x${string}` | null {
  if (!value || value.length < 42) return null;

  const address = `0x${value.slice(-40)}`.toLowerCase() as `0x${string}`;
  return address === ZERO_ADDRESS ? null : address;
}

async function registryOrImplementationContainsSelector(
  publicClient: SelectorProbePublicClient,
  registryAddress: `0x${string}`,
  selector: `0x${string}`,
): Promise<boolean | null> {
  if (!publicClient.getBytecode) return null;

  try {
    const registryBytecode = await publicClient.getBytecode({ address: registryAddress });
    if (bytecodeContainsSelector(registryBytecode, selector)) return true;

    if (!publicClient.getStorageAt) return false;

    const implementationSlot = await publicClient.getStorageAt({
      address: registryAddress,
      slot: EIP1967_IMPLEMENTATION_SLOT,
    });
    const implementationAddress = addressFromEip1967Slot(implementationSlot);
    if (!implementationAddress) return false;

    const implementationBytecode = await publicClient.getBytecode({ address: implementationAddress });
    return bytecodeContainsSelector(implementationBytecode, selector);
  } catch {
    return null;
  }
}

export async function assertContentRegistryQuestionSubmissionSelector(
  publicClient: SelectorProbePublicClient | undefined,
  registryAddress: `0x${string}`,
  kind: QuestionSubmissionSelectorKind,
) {
  if (!publicClient) return;

  const probeData = buildQuestionSubmissionSelectorProbeData(kind);
  try {
    await publicClient.call({
      to: registryAddress,
      data: probeData,
    });
  } catch (error) {
    const message = getSubmissionErrorMessage(error);
    if (isExpectedSelectorProbeRevert(kind, message)) return;
    if (isUnknownEmptyRevertError(error)) {
      const selectorSupport = await registryOrImplementationContainsSelector(
        publicClient,
        registryAddress,
        selectorFromData(probeData),
      );
      if (selectorSupport !== false) return;

      throw new Error(UNSUPPORTED_QUESTION_SUBMISSION_DEPLOYMENT_ERROR);
    }
  }
}
