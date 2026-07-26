export const FIELD_FORMATS = {
  countryCode: {
    pattern: "[A-Za-z]{2}",
    maxLength: 2,
    title: "Use a two-letter country code.",
    message: "Enter a two-letter country code.",
  },
  evmAddress: {
    pattern: "0x[0-9a-fA-F]{40}",
    maxLength: 42,
    title: "Use a 0x-prefixed EVM address.",
    message: "Enter a valid 0x-prefixed EVM address.",
  },
  agentVersion: {
    pattern: "[A-Za-z0-9][A-Za-z0-9._:-]{0,159}",
    maxLength: 160,
    title: "Use letters, numbers, dots, underscores, colons, or hyphens.",
    message: "Enter a valid version of at most 160 characters.",
  },
  grcCredentialReference: {
    pattern: "(?:vault|kms|secret)://rateloop/grc/[A-Za-z0-9._~:/-]{3,300}",
    maxLength: 322,
    title: "Use a RateLoop vault, KMS, or secret reference.",
    message: "Enter a valid RateLoop GRC credential reference.",
  },
  oneTimeCode: {
    pattern: "[0-9]{6}",
    maxLength: 6,
    title: "Use the six-digit code from your email.",
    message: "Enter the six-digit code from your email.",
  },
  sha256Digest: {
    pattern: "sha256:[0-9a-f]{64}",
    maxLength: 71,
    title: "Use sha256: followed by 64 lowercase hexadecimal characters.",
    message: "Enter a valid SHA-256 digest.",
  },
  usdcAmount: {
    pattern: "[0-9]+([.][0-9]{1,6})?",
    maxLength: 32,
    title: "Use a positive amount with no more than six decimal places.",
    message: "Enter a valid USDC amount with no more than six decimal places.",
  },
  usdInvoiceAmount: {
    pattern: "[0-9]{1,6}([.][0-9]{1,2})?",
    maxLength: 9,
    title: "Use up to six whole dollars and no more than two decimal places.",
    message: "Enter a valid USD amount with no more than two decimal places.",
  },
  vatIdentifier: {
    pattern: "[A-Za-z0-9][A-Za-z0-9 ._/-]{0,63}",
    maxLength: 64,
    title: "Use at most 64 letters, numbers, spaces, dots, slashes, underscores, or hyphens.",
    message: "Enter a valid VAT identifier of at most 64 characters.",
  },
  wormCredentialReference: {
    pattern: "sec_[0-9a-f]{48}",
    maxLength: 52,
    title: "Use sec_ followed by 48 lowercase hexadecimal characters.",
    message: "Enter a valid opaque server credential reference.",
  },
} as const;

export type FieldFormatName = keyof typeof FIELD_FORMATS;
export type FieldFormat = (typeof FIELD_FORMATS)[FieldFormatName];

export function fieldFormat(name: FieldFormatName): FieldFormat {
  return FIELD_FORMATS[name];
}
