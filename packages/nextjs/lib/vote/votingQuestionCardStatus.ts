const VOTE_COOLDOWN_ERROR_PREFIX = "You already voted on this content within the last";

export function resolveVotingQuestionCardDisplayError({
  cooldownActive,
  error,
  roundNotAcceptingMessage,
}: {
  cooldownActive: boolean;
  error?: string | null;
  roundNotAcceptingMessage?: string | null;
}) {
  const isCooldownError = error?.includes(VOTE_COOLDOWN_ERROR_PREFIX) ?? false;

  if (cooldownActive && (!error || isCooldownError)) {
    return null;
  }

  return error ?? roundNotAcceptingMessage ?? null;
}
