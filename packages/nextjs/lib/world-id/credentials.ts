import { type Hex, concatHex, getAddress, numberToHex, stringToHex } from "viem";

export const WORLD_CREDENTIAL_SELFIE = 1;
export const WORLD_CREDENTIAL_PASSPORT = 2;
export const WORLD_CREDENTIAL_PROOF_OF_HUMAN = 3;

export type WorldCredentialKind =
  | typeof WORLD_CREDENTIAL_SELFIE
  | typeof WORLD_CREDENTIAL_PASSPORT
  | typeof WORLD_CREDENTIAL_PROOF_OF_HUMAN;

export type WorldIdCredentialIdentifier = "face" | "passport" | "proof_of_human";
export type WorldIdProofPurpose = "credential" | "presence";

export const WORLD_CREDENTIAL_OPTIONS: Array<{
  id: WorldCredentialKind;
  identifier: WorldIdCredentialIdentifier;
  label: string;
  shortLabel: string;
}> = [
  {
    id: WORLD_CREDENTIAL_SELFIE,
    identifier: "face",
    label: "Selfie Check / fresh liveness",
    shortLabel: "Selfie Check",
  },
  {
    id: WORLD_CREDENTIAL_PASSPORT,
    identifier: "passport",
    label: "Passport / NFC document",
    shortLabel: "Passport",
  },
  {
    id: WORLD_CREDENTIAL_PROOF_OF_HUMAN,
    identifier: "proof_of_human",
    label: "Proof of Human",
    shortLabel: "Proof of Human",
  },
];

export const WORLD_CREDENTIAL_BOUNTY_OPTIONS = WORLD_CREDENTIAL_OPTIONS.filter(option =>
  isWorldCredentialEnabledForBountyUi(option.id),
);

export function isWorldCredentialEnabledForBountyUi(kind: WorldCredentialKind): boolean {
  return kind === WORLD_CREDENTIAL_PROOF_OF_HUMAN;
}

export function isWorldCredentialKind(value: number): value is WorldCredentialKind {
  return (
    value === WORLD_CREDENTIAL_SELFIE ||
    value === WORLD_CREDENTIAL_PASSPORT ||
    value === WORLD_CREDENTIAL_PROOF_OF_HUMAN
  );
}

export function getWorldCredentialOption(kind: WorldCredentialKind) {
  return WORLD_CREDENTIAL_OPTIONS.find(option => option.id === kind) ?? WORLD_CREDENTIAL_OPTIONS[2];
}

function buildPackedSignal(prefix: string, address: string, kind: WorldCredentialKind): Hex {
  return concatHex([stringToHex(prefix), getAddress(address) as Hex, numberToHex(kind, { size: 1 })]);
}

export function buildWorldCredentialSignal(address: string, kind: WorldCredentialKind): Hex {
  if (kind === WORLD_CREDENTIAL_PROOF_OF_HUMAN) {
    return getAddress(address) as Hex;
  }

  return buildPackedSignal("rateloop-world-credential-v1", address, kind);
}

export function buildWorldPresenceSignal(address: string, kind: WorldCredentialKind): Hex {
  return buildPackedSignal("rateloop-world-presence-v1", address, kind);
}

export function getWorldIdSignalForPurpose(
  address: string,
  kind: WorldCredentialKind,
  purpose: WorldIdProofPurpose,
): Hex {
  return purpose === "presence" ? buildWorldPresenceSignal(address, kind) : buildWorldCredentialSignal(address, kind);
}
