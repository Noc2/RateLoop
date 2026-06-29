import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, getAddress, http, isAddress, isHex, verifyMessage } from "viem";
import { parsePositiveIntegerChainId } from "~~/lib/chainId";
import { getServerRpcOverrides, getServerTargetNetworkById } from "~~/lib/env/server";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { buildFreeTransactionReservationSessionMessage } from "~~/lib/thirdweb/freeTransactionReservationSession";
import { getPendingReservationSessionToken } from "~~/lib/thirdweb/freeTransactions";
import { checkRateLimit } from "~~/utils/rateLimit";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

type ReservationSessionRequest = {
  address?: string;
  chainId?: number;
  operationKey?: string;
  signature?: string;
};

function getSignatureVerificationClient(chainId: number) {
  const network = getServerTargetNetworkById(chainId);
  const rpcUrl = network ? (getServerRpcOverrides()[chainId] ?? network.rpcUrls.default.http[0]) : null;
  if (!network || !rpcUrl) return null;

  return createPublicClient({
    chain: network,
    transport: http(rpcUrl),
  });
}

async function verifiesReservationSessionProof(params: {
  address: string;
  chainId: number;
  operationKey: string;
  signature: string;
}) {
  if (!isHex(params.signature)) return false;

  const address = getAddress(params.address);
  const message = buildFreeTransactionReservationSessionMessage({
    address,
    chainId: params.chainId,
    operationKey: params.operationKey,
  });

  try {
    if (await verifyMessage({ address, message, signature: params.signature })) {
      return true;
    }
  } catch {
    // Contract wallets are checked through the chain-aware public client below.
  }

  try {
    const publicClient = getSignatureVerificationClient(params.chainId);
    return publicClient ? await publicClient.verifyMessage({ address, message, signature: params.signature }) : false;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const preParseLimited = await checkRateLimit(request, READ_RATE_LIMIT, {
    extraKeyParts: ["preparse"],
  });
  if (preParseLimited) return preParseLimited;

  const parsedBody = await parseJsonBody(request);
  if (!isJsonObjectBody(parsedBody)) return jsonBodyErrorResponse(parsedBody, "Invalid request body");
  const body = parsedBody as ReservationSessionRequest;
  const address = body.address;
  const chainIdParam = typeof body.chainId === "number" ? String(body.chainId) : undefined;
  const operationKey = body.operationKey?.trim() ?? "";

  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    allowOnStoreUnavailable: false,
    extraKeyParts: [typeof address === "string" ? address : undefined, operationKey || undefined],
  });
  if (limited) return limited;

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const chainId = parsePositiveIntegerChainId(chainIdParam);
  if (chainId === null) {
    return NextResponse.json({ error: "Invalid chain" }, { status: 400 });
  }
  if (!getServerTargetNetworkById(chainId)) {
    return NextResponse.json({ error: "Unsupported chain" }, { status: 400 });
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(operationKey)) {
    return NextResponse.json({ error: "Invalid operation key" }, { status: 400 });
  }
  if (
    !(await verifiesReservationSessionProof({
      address,
      chainId,
      operationKey,
      signature: body.signature ?? "",
    }))
  ) {
    return NextResponse.json({ error: "Invalid reservation session signature" }, { status: 401 });
  }

  const reservationSessionToken = await getPendingReservationSessionToken({
    address,
    chainId,
    operationKey,
  });

  if (!reservationSessionToken) {
    return NextResponse.json({ error: "Pending reservation not found" }, { status: 404 });
  }

  return NextResponse.json({ reservationSessionToken });
}
