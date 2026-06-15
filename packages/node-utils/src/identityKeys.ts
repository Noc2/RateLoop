import { encodePacked, keccak256 } from "viem";

export function addressIdentityKey(account: `0x${string}`) {
  return keccak256(
    encodePacked(
      ["string", "address"],
      ["rateloop.address-identity-v1", account],
    ),
  );
}
