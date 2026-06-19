type ConfidentialityTermsStatus = {
  accepted: boolean;
  hasSession: boolean;
};

export type ConfidentialityClientScope = {
  chainId?: number | null;
  contentRegistryAddress?: string | null;
  deploymentKey?: string | null;
};

function appendScopeParams(params: URLSearchParams, scope: ConfidentialityClientScope = {}) {
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

function buildConfidentialityTermsParams(
  address: string,
  contentId: bigint | string,
  scope: ConfidentialityClientScope = {},
) {
  const params = new URLSearchParams({
    address,
    contentId: contentId.toString(),
  });
  appendScopeParams(params, scope);
  return params;
}

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

export async function fetchConfidentialityTermsStatus(
  address: string,
  contentId: bigint | string,
  scope: ConfidentialityClientScope = {},
): Promise<ConfidentialityTermsStatus> {
  const params = buildConfidentialityTermsParams(address, contentId, scope);
  const termsResponse = await fetch(`/api/confidentiality/terms?${params.toString()}`, {
    credentials: "include",
  });
  if (!termsResponse.ok) return { accepted: false, hasSession: false };

  const termsBody = await readJson(termsResponse);
  return {
    accepted: termsBody?.accepted === true,
    hasSession: termsBody?.hasSession === true,
  };
}
