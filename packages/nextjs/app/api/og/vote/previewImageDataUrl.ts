import { Buffer } from "node:buffer";

const PREVIEW_IMAGE_FETCH_TIMEOUT_MS = 2_500;
const PREVIEW_IMAGE_MAX_BYTES = 2_000_000;

export async function fetchPreviewImageDataUrl(
  imageUrl: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!imageUrl) return null;

  try {
    const response = await fetchImpl(imageUrl, {
      cache: "force-cache",
      signal: AbortSignal.timeout(PREVIEW_IMAGE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!contentType?.startsWith("image/")) return null;

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > PREVIEW_IMAGE_MAX_BYTES) return null;

    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}
