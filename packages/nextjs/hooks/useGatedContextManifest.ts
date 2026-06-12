"use client";

import { useQuery } from "@tanstack/react-query";

export type GatedContextManifest = {
  contentId: string;
  details: Array<{
    id: string;
    sha256: `0x${string}` | null;
    url: string;
  }>;
  images: Array<{
    id: string;
    mediaIndex: number;
    mediaType: "image";
    sha256: `0x${string}` | null;
    url: string;
  }>;
};

type UseGatedContextManifestParams = {
  contentId: bigint;
  enabled?: boolean;
  walletAddress?: string;
};

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || "Private context is not available.";
}

export function useGatedContextManifest({ contentId, enabled = true, walletAddress }: UseGatedContextManifestParams) {
  const contentIdParam = contentId.toString();
  const normalizedWalletAddress = walletAddress?.trim().toLowerCase();

  return useQuery({
    queryKey: ["gatedContextManifest", contentIdParam, normalizedWalletAddress ?? ""],
    queryFn: async (): Promise<GatedContextManifest> => {
      if (!walletAddress) throw new Error("Wallet address required.");

      const params = new URLSearchParams({
        address: walletAddress,
        contentId: contentIdParam,
      });
      const response = await fetch(`/api/confidentiality/context?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return response.json();
    },
    enabled: enabled && Boolean(walletAddress),
    retry: false,
    staleTime: 60_000,
  });
}
