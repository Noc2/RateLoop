import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { PoolClient } from "pg";
import "server-only";
import { PASSKEY_ACTION_PROOF_HEADER, consumePasskeyAddProof } from "~~/lib/auth/passkeyActionProof";
import { dbClient, dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type PasskeyFallbacks = {
  emailOtpEnabled: boolean;
  emailVerified: boolean;
  passkeyCount: number;
};

const passkeyMutationTails = new Map<string, Promise<void>>();

async function serializePasskeyMutation<T>(userId: string, action: () => Promise<T>) {
  const previous = passkeyMutationTails.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  passkeyMutationTails.set(userId, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (passkeyMutationTails.get(userId) === tail) passkeyMutationTails.delete(userId);
  }
}

export function canRemovePasskey(input: PasskeyFallbacks) {
  return input.passkeyCount > 1 || (input.emailOtpEnabled && input.emailVerified);
}

export function passkeySafetyPlugin(): BetterAuthPlugin {
  return {
    id: "rateloop-passkey-safety",
    hooks: {
      before: [
        {
          matcher: context =>
            context.path === "/passkey/delete-passkey" || context.path === "/passkey/verify-registration",
          handler: createAuthMiddleware(async context => {
            if (context.path === "/passkey/delete-passkey") {
              throw APIError.from("FORBIDDEN", {
                code: "PASSKEY_DELETION_REQUIRES_RATELOOP_REAUTH",
                message: "Remove passkeys through RateLoop account settings.",
              });
            }
            const authSession = await getSessionFromCtx(context);
            if (!authSession?.user.id) {
              throw APIError.from("UNAUTHORIZED", {
                code: "PASSKEY_ACTION_PROOF_REQUIRED",
                message: "Verify your sign-in again before adding a passkey.",
              });
            }
            try {
              await consumePasskeyAddProof({
                betterAuthUserId: authSession.user.id,
                proof: context.headers?.get(PASSKEY_ACTION_PROOF_HEADER),
              });
            } catch {
              throw APIError.from("UNAUTHORIZED", {
                code: "PASSKEY_ACTION_PROOF_REQUIRED",
                message: "Verify your sign-in again before adding a passkey.",
              });
            }
          }),
        },
      ],
    },
  };
}

async function principalBetterAuthUser(principalId: string) {
  const identity = await dbClient.execute({
    sql: `SELECT b.provider_subject,u.email_verified
          FROM tokenless_identity_bindings b
          JOIN tokenless_better_auth_users u ON u.id=b.provider_subject
          WHERE b.principal_id=? AND b.provider='better_auth' AND b.status='active'
          LIMIT 1`,
    args: [principalId],
  });
  const row = identity.rows[0] as Record<string, unknown> | undefined;
  if (!row?.provider_subject) {
    throw new TokenlessServiceError("The account sign-in record was not found.", 404, "sign_in_record_not_found");
  }
  return { emailVerified: row.email_verified === true, userId: String(row.provider_subject) };
}

export async function assertPrincipalBetterAuthUser(principalId: string, betterAuthUserId: string) {
  const identity = await principalBetterAuthUser(principalId);
  if (identity.userId !== betterAuthUserId) {
    throw new TokenlessServiceError(
      "Sign in to this RateLoop account before changing its passkeys.",
      403,
      "passkey_account_mismatch",
    );
  }
  return identity;
}

export async function listPrincipalPasskeys(principalId: string, emailOtpEnabled: boolean) {
  const identity = await principalBetterAuthUser(principalId);
  const passkeyResult = await dbClient.execute({
    sql: `SELECT id,name,device_type,backed_up,created_at
          FROM tokenless_better_auth_passkeys
          WHERE user_id=? ORDER BY created_at DESC NULLS LAST,id`,
    args: [identity.userId],
  });
  const passkeys = passkeyResult.rows.map(row => ({
    backedUp: row.backed_up === true,
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : null,
    deviceType: typeof row.device_type === "string" ? row.device_type : null,
    id: String(row.id),
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Passkey",
  }));
  return {
    canRemoveLast: canRemovePasskey({
      emailOtpEnabled,
      emailVerified: identity.emailVerified,
      passkeyCount: passkeys.length,
    }),
    passkeys,
  };
}

export async function removePrincipalPasskey(input: {
  betterAuthUserId: string;
  emailOtpEnabled: boolean;
  passkeyId: string;
  principalId: string;
}) {
  const passkeyId = input.passkeyId.trim();
  if (!passkeyId || passkeyId.length > 255) {
    throw new TokenlessServiceError("Passkey was not found.", 404, "passkey_not_found");
  }
  return serializePasskeyMutation(input.betterAuthUserId, async () => {
    const client = (await dbPool.connect()) as PoolClient;
    try {
      await client.query("BEGIN");
      const identity = await client.query(
        `SELECT user_record.id,user_record.email_verified
       FROM tokenless_identity_bindings binding
       JOIN tokenless_better_auth_users user_record ON user_record.id = binding.provider_subject
       WHERE binding.principal_id = $1 AND binding.provider = 'better_auth'
         AND binding.provider_subject = $2 AND binding.status = 'active'
       FOR UPDATE`,
        [input.principalId, input.betterAuthUserId],
      );
      if (identity.rowCount !== 1) {
        throw new TokenlessServiceError(
          "Sign in to this RateLoop account before changing its passkeys.",
          403,
          "passkey_account_mismatch",
        );
      }
      const passkeys = await client.query(
        `SELECT id FROM tokenless_better_auth_passkeys WHERE user_id = $1 ORDER BY id FOR UPDATE`,
        [input.betterAuthUserId],
      );
      if (!passkeys.rows.some(row => String(row.id) === passkeyId)) {
        throw new TokenlessServiceError("Passkey was not found.", 404, "passkey_not_found");
      }
      if (
        !canRemovePasskey({
          emailOtpEnabled: input.emailOtpEnabled,
          emailVerified: identity.rows[0]?.email_verified === true,
          passkeyCount: passkeys.rowCount ?? passkeys.rows.length,
        })
      ) {
        throw new TokenlessServiceError(
          "Add another passkey before removing your only sign-in method.",
          409,
          "last_sign_in_method",
        );
      }
      const deleted = await client.query(
        `DELETE FROM tokenless_better_auth_passkeys WHERE id = $1 AND user_id = $2 RETURNING id`,
        [passkeyId, input.betterAuthUserId],
      );
      if (deleted.rowCount !== 1) {
        throw new TokenlessServiceError("Passkey was not found.", 404, "passkey_not_found");
      }
      await client.query("COMMIT");
      return { removed: true as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
