type ConfidentialityTermsStatus = {
  accepted: boolean;
  hasSession: boolean;
};

function buildConfidentialityTermsParams(address: string, contentId: bigint | string) {
  return new URLSearchParams({
    address,
    contentId: contentId.toString(),
  });
}

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

export async function fetchConfidentialityTermsStatus(
  address: string,
  contentId: bigint | string,
): Promise<ConfidentialityTermsStatus> {
  const params = buildConfidentialityTermsParams(address, contentId);
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
