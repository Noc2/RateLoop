import { NextResponse } from "next/server";
import type { IDKitResult, ResponseItemV4 } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { getWorldIdServerConfig } from "~~/lib/world-id/config";

type WorldIdVerifyRequest = {
  idkitResponse?: IDKitResult;
  signal?: string;
};

type WorldIdVerifyResponse = {
  success?: boolean;
  nullifier?: string;
  results?: Array<{
    identifier?: string;
    success?: boolean;
    nullifier?: string;
    code?: string;
    detail?: string;
  }>;
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getIdkitResponse(body: unknown): IDKitResult | null {
  if (!isRecord(body)) {
    return null;
  }

  const candidate = isRecord(body.idkitResponse) ? body.idkitResponse : body;
  if (!Array.isArray(candidate.responses) || typeof candidate.protocol_version !== "string") {
    return null;
  }

  return candidate as unknown as IDKitResult;
}

function getResponseSignalHash(result: IDKitResult) {
  const response = result.responses[0] as Partial<ResponseItemV4> | undefined;
  return typeof response?.signal_hash === "string" ? response.signal_hash : null;
}

function getVerifiedNullifier(payload: WorldIdVerifyResponse, result: IDKitResult) {
  return (
    payload.nullifier ??
    payload.results?.find(item => item.success !== false && item.nullifier)?.nullifier ??
    ("session_id" in result ? result.session_id : result.responses[0]?.nullifier) ??
    null
  );
}

function getSignal(body: unknown) {
  return isRecord(body) && typeof body.signal === "string" ? body.signal : "";
}

export async function POST(request: Request): Promise<Response> {
  const config = getWorldIdServerConfig();

  if (!config.rpId) {
    return NextResponse.json({ error: "World ID is not configured for this deployment." }, { status: 503 });
  }

  let body: WorldIdVerifyRequest;
  try {
    body = (await request.json()) as WorldIdVerifyRequest;
  } catch {
    return NextResponse.json({ error: "Invalid World ID verification payload." }, { status: 400 });
  }

  const idkitResponse = getIdkitResponse(body);
  if (!idkitResponse) {
    return NextResponse.json({ error: "Invalid World ID verification payload." }, { status: 400 });
  }

  if (idkitResponse.protocol_version !== "4.0" || "session_id" in idkitResponse) {
    return NextResponse.json({ error: "RateLoop requires a World ID v4 uniqueness proof." }, { status: 400 });
  }

  if (idkitResponse.action !== config.action) {
    return NextResponse.json({ error: "World ID action does not match this deployment." }, { status: 400 });
  }

  const signal = getSignal(body);
  if (signal) {
    const expectedSignalHash = hashSignal(signal);
    if (getResponseSignalHash(idkitResponse) !== expectedSignalHash) {
      return NextResponse.json({ error: "World ID signal does not match this request." }, { status: 400 });
    }
  }

  const response = await fetch(`${config.endpoint}/${encodeURIComponent(config.rpId)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(idkitResponse),
  });
  const payload = (await response.json().catch(() => ({}))) as WorldIdVerifyResponse;

  if (!response.ok || payload.success !== true) {
    return NextResponse.json(
      {
        error: payload.message ?? "World ID verification failed.",
        results: payload.results ?? [],
      },
      { status: response.ok ? 400 : response.status },
    );
  }

  return NextResponse.json({
    nullifier: getVerifiedNullifier(payload, idkitResponse),
    success: true,
    verifiedAt: new Date().toISOString(),
  });
}
