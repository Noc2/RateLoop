/**
 * Saving the human-review configuration and advancing the setup wizard are two separate server
 * calls. A partial failure between them (the advance request fails, or the save response is lost
 * after the server already committed) leaves the browser holding a stale binding version. Because
 * the server permanently rejects an outdated `expectedBindingVersion` with a 409 conflict, a naive
 * Retry that resends the original version can never succeed without a full reload.
 *
 * This helper makes the sequence retry-safe: it adopts the authoritative binding version after any
 * ambiguous or partial failure so the next attempt sends the current version instead of the stale
 * one. The caller supplies the concrete network operations, which keeps this logic pure and
 * directly testable.
 */
export type ReviewConfigurationSaveDeps = {
  /** PUT the human-review configuration; resolves with the newly saved (advanced) binding version. */
  putHumanReviewConfiguration: () => Promise<{ bindingRevision: number }>;
  /** Advance the setup wizard past the review step using the saved binding version. */
  advanceSetup: (bindingRevision: number) => Promise<void>;
  /** Re-read the authoritative current binding version from the server. */
  reloadAuthoritativeBindingRevision: () => Promise<number | null>;
  /** Adopt a binding version into local state so the next Retry uses it as expectedBindingVersion. */
  adoptBindingRevision: (bindingRevision: number) => void;
};

export async function saveReviewConfigurationAndAdvance(deps: ReviewConfigurationSaveDeps): Promise<void> {
  let savedBindingRevision: number | null = null;
  try {
    const ownerView = await deps.putHumanReviewConfiguration();
    if (!Number.isSafeInteger(ownerView.bindingRevision) || ownerView.bindingRevision < 1) {
      throw new Error("The saved review configuration could not be confirmed.");
    }
    savedBindingRevision = ownerView.bindingRevision;
    // The binding is now advanced. Adopt it immediately so that if the wizard advance below fails,
    // Retry sends this version rather than the stale one it started with.
    deps.adoptBindingRevision(savedBindingRevision);
    await deps.advanceSetup(savedBindingRevision);
  } catch (cause) {
    if (savedBindingRevision === null) {
      // The PUT itself failed or its response was lost, so the server may or may not have advanced
      // the binding. Reload the authoritative version so Retry cannot get stuck on a stale one.
      const authoritative = await deps.reloadAuthoritativeBindingRevision().catch(() => null);
      if (authoritative !== null) deps.adoptBindingRevision(authoritative);
    }
    throw cause;
  }
}
