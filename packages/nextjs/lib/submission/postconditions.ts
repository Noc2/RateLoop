import { ContentRegistryAbi } from "@rateloop/contracts/abis";
import type { Address, PublicClient } from "viem";

type ReadContractClient = Pick<PublicClient, "readContract">;

function readNextContentId(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

export async function hasQuestionSubmittedPostcondition(params: {
  client: ReadContractClient;
  contentRegistryAddress: Address;
  expectedNextContentId: bigint;
}) {
  const nextContentId = readNextContentId(
    await params.client.readContract({
      address: params.contentRegistryAddress,
      abi: ContentRegistryAbi,
      functionName: "nextContentId",
    } as never),
  );
  return nextContentId !== null && nextContentId >= params.expectedNextContentId;
}
