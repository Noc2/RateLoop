import type { IncomingHttpHeaders } from "http";
import https from "https";
import type { RequestOptions } from "https";
import { resolvePublicUrlAddress } from "~~/utils/urlSafety";

export type PublicHttpsFetchInit = {
  body?: BodyInit | null;
  headers?: HeadersInit;
  maxResponseBytes?: number;
  method?: string;
  redirect?: RequestRedirect;
  signal?: AbortSignal | null;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

function toHeaderEntries(headers: HeadersInit | undefined) {
  return [...new Headers(headers).entries()];
}

async function bodyToBuffer(body: BodyInit | null | undefined): Promise<Buffer | null> {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  throw new Error("Unsupported safe fetch request body.");
}

function responseHeadersToHeaders(rawHeaders: IncomingHttpHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

export async function fetchPublicHttpsUrl(input: string, init: PublicHttpsFetchInit = {}): Promise<Response> {
  const resolved = await resolvePublicUrlAddress(input);
  if (!resolved) {
    throw new Error("URL must be a public HTTPS URL.");
  }

  const { address, family, url } = resolved;
  const requestBody = await bodyToBuffer(init.body);
  const headers = Object.fromEntries(toHeaderEntries(init.headers));
  headers.host = url.host;
  if (requestBody && !("content-length" in headers)) {
    headers["content-length"] = String(requestBody.length);
  }

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const requestOptions: RequestOptions = {
      family,
      headers,
      hostname: address,
      lookup: (_hostname, _options, callback) => callback(null, address, family),
      method: init.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      port: url.port ? Number(url.port) : 443,
      servername: url.hostname,
      timeout: init.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      init.signal?.removeEventListener("abort", abort);
      callback();
    };

    const request = https.request(requestOptions, response => {
      const status = response.statusCode ?? 0;
      const statusText = response.statusMessage ?? "";
      const responseInit = {
        headers: responseHeadersToHeaders(response.headers),
        status,
        statusText,
      };
      const maxResponseBytes = init.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

      if (maxResponseBytes <= 0) {
        response.destroy();
        finish(() => resolve(new Response(null, responseInit)));
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const resolveBufferedResponse = () => finish(() => resolve(new Response(Buffer.concat(chunks), responseInit)));
      response.on("data", chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = maxResponseBytes - totalBytes;
        if (remaining <= 0) {
          response.destroy();
          return;
        }

        chunks.push(buffer.length > remaining ? buffer.subarray(0, remaining) : buffer);
        totalBytes += Math.min(buffer.length, remaining);
        if (totalBytes >= maxResponseBytes) {
          resolveBufferedResponse();
          response.destroy();
        }
      });
      response.on("end", () => {
        resolveBufferedResponse();
      });
      response.on("error", error => {
        finish(() => reject(error));
      });
    });

    function abort() {
      request.destroy(new Error("Request aborted."));
    }

    request.on("timeout", () => {
      timedOut = true;
      request.destroy(new Error("Request timed out."));
    });
    request.on("error", error => {
      finish(() => reject(timedOut ? new Error("Request timed out.") : error));
    });

    if (init.signal?.aborted) {
      abort();
      return;
    }
    init.signal?.addEventListener("abort", abort, { once: true });
    if (requestBody) {
      request.write(requestBody);
    }
    request.end();
  });
}
