export async function readEvidenceDeliveryJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body as T;
}

export function formatEvidenceDeliveryDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}
