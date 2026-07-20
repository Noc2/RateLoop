import { getAddress, zeroAddress } from "viem";

const SAFE_ROTATION_AUTHORITY_ABI = [
  {
    type: "function",
    name: "getOwners",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "getThreshold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const REQUIRED_POLICY =
  "Use a deployed Safe-compatible contract with at least three distinct nonzero owners and a threshold of at least two.";

function configuredAuthority(rawAuthority) {
  try {
    return getAddress(rawAuthority?.trim());
  } catch {
    throw new Error(
      `TOKENLESS_ROTATION_AUTHORITY must be a valid nonzero Base Sepolia address. ${REQUIRED_POLICY}`,
    );
  }
}

function invalidPolicy(authority, detail) {
  return new Error(`TOKENLESS_ROTATION_AUTHORITY ${authority} ${detail} ${REQUIRED_POLICY}`);
}

export async function validateTokenlessRotationAuthority({ client, authority: rawAuthority }) {
  const authority = configuredAuthority(rawAuthority);
  if (authority === zeroAddress) {
    throw invalidPolicy(authority, "cannot be the zero address.");
  }

  let bytecode;
  try {
    bytecode = await client.getBytecode({ address: authority });
  } catch (error) {
    throw new Error(
      `Could not verify TOKENLESS_ROTATION_AUTHORITY ${authority} on Base Sepolia. Check BASE_SEPOLIA_RPC_URL and try again.`,
      { cause: error },
    );
  }
  if (!bytecode || bytecode === "0x") {
    throw invalidPolicy(
      authority,
      "has no deployed bytecode on Base Sepolia and appears to be an EOA.",
    );
  }

  let owners;
  let threshold;
  try {
    [owners, threshold] = await Promise.all([
      client.readContract({
        address: authority,
        abi: SAFE_ROTATION_AUTHORITY_ABI,
        functionName: "getOwners",
      }),
      client.readContract({
        address: authority,
        abi: SAFE_ROTATION_AUTHORITY_ABI,
        functionName: "getThreshold",
      }),
    ]);
  } catch (error) {
    throw new Error(
      `TOKENLESS_ROTATION_AUTHORITY ${authority} does not expose the required Safe-compatible getOwners() and getThreshold() views. ${REQUIRED_POLICY}`,
      { cause: error },
    );
  }

  if (threshold < 2n) {
    throw invalidPolicy(authority, `has threshold ${threshold}; the minimum is two.`);
  }
  if (owners.length < 3 || threshold > BigInt(owners.length)) {
    throw invalidPolicy(
      authority,
      `has ${owners.length} owners and threshold ${threshold}; the owner set must contain at least three members and cover its threshold.`,
    );
  }

  const normalizedOwners = owners.map((owner) => getAddress(owner));
  const uniqueOwners = new Set(normalizedOwners.map((owner) => owner.toLowerCase()));
  if (normalizedOwners.some((owner) => owner === zeroAddress) || uniqueOwners.size !== owners.length) {
    throw invalidPolicy(authority, "contains a zero or duplicate owner.");
  }

  return { authority, owners: normalizedOwners, threshold };
}
