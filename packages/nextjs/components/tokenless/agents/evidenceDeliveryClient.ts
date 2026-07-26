import { HttpJsonError } from "~~/lib/tokenless/http";

export async function readEvidenceDeliveryJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new HttpJsonError(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
      {
        code: typeof body.code === "string" ? body.code : null,
        field: typeof body.field === "string" ? body.field : null,
        status: response.status,
      },
    );
  }
  return body as T;
}

export function formatEvidenceDeliveryDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}
