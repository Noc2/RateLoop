import type { Address } from "viem";

export interface VoteWalletContextSnapshot {
  voterAddress: Address;
  chainId: number;
}

export interface VoteWalletContextCurrent {
  address?: string;
  chainId?: number;
  targetChainId: number;
}

export type VoteWalletContextResult = { ok: true } | { ok: false; message: string };

export function assertVoteWalletContext(
  snapshot: VoteWalletContextSnapshot,
  current: VoteWalletContextCurrent,
): VoteWalletContextResult {
  if (!current.address || current.address.toLowerCase() !== snapshot.voterAddress.toLowerCase()) {
    return { ok: false, message: "Wallet changed during vote. Try again." };
  }

  const effectiveChainId = current.chainId ?? current.targetChainId;
  if (effectiveChainId !== snapshot.chainId) {
    return { ok: false, message: "Network changed during vote. Switch back and try again." };
  }

  return { ok: true };
}
