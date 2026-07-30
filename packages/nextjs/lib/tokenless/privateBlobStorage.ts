import type { get as getBlob } from "@vercel/blob";
import { maintenanceRequestSignal, throwIfMaintenanceCancelled } from "~~/lib/tokenless/maintenanceCancellation";

export const VERCEL_BLOB_OPERATION_TIMEOUT_MS = 30_000;

type BlobGetResult = Awaited<ReturnType<typeof getBlob>>;

type BlobApi = {
  del(reference: string, options: { abortSignal: AbortSignal }): Promise<void>;
  get(
    reference: string,
    options: { abortSignal: AbortSignal; access: "private"; useCache: false },
  ): Promise<BlobGetResult>;
  put(
    pathname: string,
    body: Buffer,
    options: {
      abortSignal: AbortSignal;
      access: "private";
      addRandomSuffix: false;
      contentType: string;
    },
  ): Promise<{ url: string }>;
};

type BlobApiLoader = () => Promise<BlobApi>;

async function loadVercelBlobApi(): Promise<BlobApi> {
  const { del, get, put } = await import("@vercel/blob");
  return { del, get, put };
}

export function createPrivateBlobStorage(options: { loadApi?: BlobApiLoader; timeoutMs?: number } = {}) {
  const loadApi = options.loadApi ?? loadVercelBlobApi;
  const timeoutMs = options.timeoutMs ?? VERCEL_BLOB_OPERATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("The Vercel Blob operation timeout must be a positive integer.");
  }

  return {
    async delete(reference: string, signal?: AbortSignal) {
      throwIfMaintenanceCancelled(signal);
      const api = await loadApi();
      await api.del(reference, { abortSignal: maintenanceRequestSignal(signal, timeoutMs) });
    },
    async get(reference: string, signal?: AbortSignal) {
      throwIfMaintenanceCancelled(signal);
      const api = await loadApi();
      const result = await api.get(reference, {
        abortSignal: maintenanceRequestSignal(signal, timeoutMs),
        access: "private",
        useCache: false,
      });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async put(pathname: string, body: Uint8Array, contentType: string, signal?: AbortSignal) {
      throwIfMaintenanceCancelled(signal);
      const api = await loadApi();
      const result = await api.put(pathname, Buffer.from(body), {
        abortSignal: maintenanceRequestSignal(signal, timeoutMs),
        access: "private",
        addRandomSuffix: false,
        contentType,
      });
      return result.url;
    },
  };
}

export const privateBlobStorage = createPrivateBlobStorage();
