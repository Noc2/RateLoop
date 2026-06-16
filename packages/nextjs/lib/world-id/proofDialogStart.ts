import type { WorldIdProofMode } from "./config";
import { WORLD_CREDENTIAL_PROOF_OF_HUMAN, type WorldCredentialKind, type WorldIdProofPurpose } from "./credentials";

type WorldIdProofDialogStartInput = {
  address?: string;
  appId?: string | null;
  kind: WorldCredentialKind;
  open: boolean;
  proofMode?: WorldIdProofMode;
  purpose: WorldIdProofPurpose;
  signal?: string | null;
};

export function getWorldIdProofDialogUnavailableMessage(input: WorldIdProofDialogStartInput) {
  if (!input.open) {
    return null;
  }

  if (!input.appId) {
    return "World ID is not configured for this deployment.";
  }

  if (!input.address || !input.signal) {
    return "Connect a wallet before verifying with World ID.";
  }

  if (
    (input.proofMode ?? "legacy") === "legacy" &&
    (input.purpose !== "credential" || input.kind !== WORLD_CREDENTIAL_PROOF_OF_HUMAN)
  ) {
    return "This deployment only supports the Proof of Human World ID v3 credential.";
  }

  return null;
}

export function getWorldIdProofDialogAutoStartKey(input: WorldIdProofDialogStartInput) {
  if (!input.open) {
    return null;
  }

  if (getWorldIdProofDialogUnavailableMessage(input)) {
    return null;
  }

  return [input.appId, input.address?.toLowerCase(), input.kind, input.purpose, input.signal?.toLowerCase()].join(":");
}
