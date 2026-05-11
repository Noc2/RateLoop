import { NextResponse } from "next/server";
import type { IDKitResult, ResponseItemV4 } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { getAddress, isAddress } from "viem";
import { WorldIdAttestationError, attestWorldIdCredential } from "~~/lib/world-id/attestation";
import { getWorldIdServerConfig } from "~~/lib/world-id/config";

type WorldIdVerifyRequest = {
  idkitResponse?: IDKitResult;
  signal?: string;
  walletAddress?: string;
  chainId?: number | string;
  requireOnChainAttestation?: boolean;
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

function getWalletAddress(body: unknown): `0x${string}` | null {
  if (!isRecord(body) || typeof body.walletAddress !== "string" || !isAddress(body.walletAddress, { strict: false })) {
    return null;
  }

  return getAddress(body.walletAddress) as `0x${string}`;
}

function getChainId(body: unknown): number | null {
  if (!isRecord(body)) {
    return null;
  }

  const rawChainId = body.chainId;
  const parsedChainId =
    typeof rawChainId === "number"
      ? rawChainId
      : typeof rawChainId === "string" && /^\d+$/.test(rawChainId)
        ? Number(rawChainId)
        : Number.NaN;

  return Number.isSafeInteger(parsedChainId) ? parsedChainId : null;
}

function requiresOnChainAttestation(body: unknown) {
  return isRecord(body) && body.requireOnChainAttestation === true;
}

function matchesWalletSignal(signal: string, walletAddress: string) {
  return isAddress(signal, { strict: false }) && getAddress(signal) === getAddress(walletAddress);
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

  const shouldAttestOnChain = requiresOnChainAttestation(body);
  const walletAddress = getWalletAddress(body);
  const chainId = getChainId(body);

  if (shouldAttestOnChain && (!walletAddress || chainId === null)) {
    return NextResponse.json(
      { error: "Wallet address and chain ID are required for on-chain World ID attestation." },
      { status: 400 },
    );
  }

  if (shouldAttestOnChain && walletAddress && (!signal || !matchesWalletSignal(signal, walletAddress))) {
    return NextResponse.json({ error: "World ID proof must be bound to the wallet being attested." }, { status: 400 });
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

  const nullifier = getVerifiedNullifier(payload, idkitResponse);
  let attestation;

  if (shouldAttestOnChain && walletAddress && chainId !== null) {
    try {
      attestation = await attestWorldIdCredential({
        walletAddress,
        chainId,
        nullifier,
        action: config.action,
        rpId: config.rpId,
        signalHash: getResponseSignalHash(idkitResponse),
      });
    } catch (error) {
      if (error instanceof WorldIdAttestationError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }

      return NextResponse.json({ error: "World ID credential attestation failed." }, { status: 500 });
    }
  }

  return NextResponse.json({
    nullifier,
    success: true,
    ...(attestation ? { attestation } : {}),
    verifiedAt: new Date().toISOString(),
  });
}
