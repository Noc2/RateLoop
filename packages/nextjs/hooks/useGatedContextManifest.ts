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
  chainId?: number | null;
  contentId: bigint;
  contentRegistryAddress?: string | null;
  deploymentKey?: string | null;
  enabled?: boolean;
  walletAddress?: string;
};

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || "Private context is not available.";
}

function appendScopeParams(
  params: URLSearchParams,
  scope: Pick<UseGatedContextManifestParams, "chainId" | "contentRegistryAddress" | "deploymentKey">,
) {
  if (typeof scope.chainId === "number" && Number.isSafeInteger(scope.chainId) && scope.chainId > 0) {
    params.set("chainId", String(scope.chainId));
  }
  if (scope.contentRegistryAddress?.trim()) {
    params.set("contentRegistryAddress", scope.contentRegistryAddress.trim());
  }
  if (scope.deploymentKey?.trim()) {
    params.set("deploymentKey", scope.deploymentKey.trim());
  }
}

export function useGatedContextManifest({
  chainId,
  contentId,
  contentRegistryAddress,
  deploymentKey,
  enabled = true,
  walletAddress,
}: UseGatedContextManifestParams) {
  const contentIdParam = contentId.toString();
  const normalizedWalletAddress = walletAddress?.trim().toLowerCase();
  const normalizedDeploymentKey = deploymentKey?.trim().toLowerCase() ?? "";
  const normalizedContentRegistryAddress = contentRegistryAddress?.trim().toLowerCase() ?? "";

  return useQuery({
    queryKey: [
      "gatedContextManifest",
      chainId ?? null,
      normalizedDeploymentKey,
      normalizedContentRegistryAddress,
      contentIdParam,
      normalizedWalletAddress ?? "",
    ],
    queryFn: async (): Promise<GatedContextManifest> => {
      if (!walletAddress) throw new Error("Wallet address required.");

      const params = new URLSearchParams({
        address: walletAddress,
        contentId: contentIdParam,
      });
      appendScopeParams(params, { chainId, contentRegistryAddress, deploymentKey });
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
