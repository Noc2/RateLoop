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
import type { WorkspaceAgentSetupView } from "~~/lib/tokenless/workspaceAgentSetup";

export type ReviewConfigurationSaveDeps = {
  /** PUT the human-review configuration; resolves with the newly saved (advanced) binding version. */
  putHumanReviewConfiguration: () => Promise<{ bindingRevision: number }>;
  /** Advance the setup wizard past the review step using the saved binding version. */
  advanceSetup: (bindingRevision: number) => Promise<void>;
  /** Re-read the full setup state after any ambiguous save or advance failure. */
  reloadAuthoritativeSetup: () => Promise<WorkspaceAgentSetupView>;
  /** Adopt the server state, including its step, setup revision, and binding revision. */
  adoptAuthoritativeSetup: (setup: WorkspaceAgentSetupView) => void;
  /** Adopt a confirmed binding revision immediately, before the setup advance. */
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
    // Either request may have committed before its response was lost. Reload the complete setup so
    // both the binding revision and wizard revision/step come from one authoritative snapshot.
    const authoritative = await deps.reloadAuthoritativeSetup().catch(() => null);
    if (authoritative) {
      deps.adoptAuthoritativeSetup(authoritative);
      // A lost configure-reviews response is already a successful operation when the server has
      // moved to people (or completed setup). Treat it as success instead of offering a stale Retry.
      if (authoritative.resumeStep === "people" || authoritative.resumeStep === "complete") return;
    }
    throw cause;
  }
}
