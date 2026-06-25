import { NextResponse } from "next/server";
import {
  ensureSignedActionChallengeTable,
  mapSignedActionError,
  verifyAndConsumeSignedActionChallenge,
} from "~~/lib/auth/signedActions";
import {
  type SignedReadSessionScope,
  getSignedReadSessionCookie,
  issueSignedReadSession,
} from "~~/lib/auth/signedReadSessions";
import { db } from "~~/lib/db";

export async function verifySignedActionChallenge(params: {
  challengeId: string;
  action: string;
  walletAddress: `0x${string}`;
  payloadHash: string;
  signature: `0x${string}`;
  buildMessage: (args: { nonce: string; expiresAt: Date }) => string;
  chainId?: number;
}) {
  await ensureSignedActionChallengeTable();

  try {
    await db.transaction(async tx => {
      await verifyAndConsumeSignedActionChallenge(tx, {
        challengeId: params.challengeId,
        action: params.action,
        walletAddress: params.walletAddress,
        payloadHash: params.payloadHash,
        signature: params.signature,
        buildMessage: ({ nonce, expiresAt }) =>
          params.buildMessage({
            nonce,
            expiresAt,
          }),
        chainId: params.chainId,
      });
    });
  } catch (error: unknown) {
    const mapped = mapSignedActionError(error);
    if (mapped) {
      return NextResponse.json(
        {
          code: "invalid_arguments",
          message: mapped.error,
          recoverWith: "fix_request_and_retry",
          retryable: false,
          status: mapped.status,
        },
        { status: mapped.status },
      );
    }
    throw error;
  }

  return null;
}

export async function createSignedReadResponse<TBody>(
  walletAddress: `0x${string}`,
  scope: SignedReadSessionScope,
  body: TBody,
  storageScope?: string,
) {
  const response = NextResponse.json(body);
  const session = await issueSignedReadSession(walletAddress, scope, storageScope);
  response.cookies.set(getSignedReadSessionCookie(scope, session));
  return response;
}
