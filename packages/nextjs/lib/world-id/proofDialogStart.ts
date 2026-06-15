import type { WorldCredentialKind, WorldIdProofPurpose } from "./credentials";

type WorldIdProofDialogStartInput = {
  address?: string;
  appId?: string | null;
  kind: WorldCredentialKind;
  open: boolean;
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
