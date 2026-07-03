import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getThirdwebClientId, getThirdwebServerVerifierSecret } from "~~/lib/env/server";
import { isJsonObjectBody, parseJsonBody } from "~~/lib/http/jsonBody";
import {
  type FreeTransactionAllowanceDecision,
  evaluateFreeTransactionAllowance,
} from "~~/lib/thirdweb/freeTransactions";
import { getThirdwebVerifierRouteTestOverrides } from "~~/lib/thirdweb/routeTestOverrides";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

function getVerifierRequestSummary(body: Record<string, unknown>) {
  const userOp = (body.userOp ?? {}) as {
    sender?: unknown;
    targets?: unknown;
    data?: { targets?: unknown };
  };
  const directTargets = Array.isArray(userOp.targets) ? userOp.targets : [];
  const nestedTargets = Array.isArray(userOp.data?.targets) ? userOp.data.targets : [];
  const targets = [...directTargets, ...nestedTargets].filter((value): value is string => typeof value === "string");

  return {
    chainId: typeof body.chainId === "number" ? body.chainId : null,
    clientId: typeof body.clientId === "string" ? body.clientId : null,
    sender: typeof userOp.sender === "string" ? userOp.sender : null,
    targetCount: targets.length,
    targets,
  };
}

function createDeniedResponse(reason: string) {
  return NextResponse.json({
    isAllowed: false,
    reason,
  });
}

function logVerifierRequestCompleted(startedAt: number, payload: Record<string, unknown>) {
  console.info("[thirdweb-verifier] request completed", {
    ...payload,
    durationMs: Date.now() - startedAt,
  });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) {
    logVerifierRequestCompleted(startedAt, {
      debugCode: "rate_limited",
      isAllowed: false,
    });
    return limited;
  }

  const overrides = getThirdwebVerifierRouteTestOverrides();
  const configuredSecret = overrides?.getThirdwebServerVerifierSecret?.() ?? getThirdwebServerVerifierSecret();
  const providedSecret = request.headers.get("x-thirdweb-verifier-secret");

  if (!configuredSecret) {
    console.error("[thirdweb-verifier] denied request", {
      debugCode: "missing_server_secret",
    });
    logVerifierRequestCompleted(startedAt, {
      debugCode: "missing_server_secret",
      isAllowed: false,
    });
    return createDeniedResponse("Transactions are not sponsored right now.");
  }

  if (
    !providedSecret ||
    providedSecret.length !== configuredSecret.length ||
    !timingSafeEqual(Buffer.from(providedSecret), Buffer.from(configuredSecret))
  ) {
    console.warn("[thirdweb-verifier] denied request", {
      debugCode: "invalid_verifier_secret",
      hasProvidedSecret: Boolean(providedSecret),
    });
    logVerifierRequestCompleted(startedAt, {
      debugCode: "invalid_verifier_secret",
      hasProvidedSecret: Boolean(providedSecret),
      isAllowed: false,
    });
    return createDeniedResponse("Unauthorized");
  }

  const parsedBody = await parseJsonBody(request);
  if (!isJsonObjectBody(parsedBody)) {
    logVerifierRequestCompleted(startedAt, {
      debugCode: "invalid_json_body",
      isAllowed: false,
    });
    return createDeniedResponse("Invalid request.");
  }
  const body = parsedBody;

  const requestSummary = getVerifierRequestSummary(body);
  console.info("[thirdweb-verifier] request received", requestSummary);

  const configuredClientId = overrides?.getThirdwebClientId?.() ?? getThirdwebClientId();
  if (configuredClientId && body.clientId !== configuredClientId) {
    console.warn("[thirdweb-verifier] denied request", {
      ...requestSummary,
      debugCode: "client_id_mismatch",
      expectedClientId: configuredClientId,
    });
    logVerifierRequestCompleted(startedAt, {
      ...requestSummary,
      debugCode: "client_id_mismatch",
      isAllowed: false,
    });
    return createDeniedResponse("Transactions are not sponsored right now.");
  }

  try {
    const evaluateAllowance = overrides?.evaluateFreeTransactionAllowance ?? evaluateFreeTransactionAllowance;
    const decision = (await evaluateAllowance(body as never)) as FreeTransactionAllowanceDecision;

    if (!decision.isAllowed) {
      console.warn("[thirdweb-verifier] denied request", {
        ...requestSummary,
        debugCode: decision.debugCode,
        reason: decision.reason,
        summary: decision.summary,
      });
      logVerifierRequestCompleted(startedAt, {
        ...requestSummary,
        debugCode: decision.debugCode,
        isAllowed: false,
        reason: decision.reason,
      });
      return createDeniedResponse(decision.reason);
    }

    if (requestSummary.chainId === 8453) {
      console.info("[thirdweb-verifier] approved mainnet request", requestSummary);
    }

    logVerifierRequestCompleted(startedAt, {
      ...requestSummary,
      debugCode: decision.debugCode ?? null,
      hasReservationSessionToken:
        decision.isAllowed && "reservationSessionToken" in decision ? Boolean(decision.reservationSessionToken) : null,
      isAllowed: true,
    });
    return NextResponse.json({
      isAllowed: true,
      ...(decision.isAllowed && decision.reservationSessionToken
        ? { reservationSessionToken: decision.reservationSessionToken }
        : {}),
    });
  } catch (error) {
    console.error("[thirdweb-verifier] request failed", {
      ...requestSummary,
      error,
    });
    logVerifierRequestCompleted(startedAt, {
      ...requestSummary,
      debugCode: "verifier_exception",
      isAllowed: false,
    });
    return createDeniedResponse("Transactions are not sponsored right now.");
  }
}
