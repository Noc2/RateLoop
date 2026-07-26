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
  vatIdentifier: {
    pattern: "[A-Za-z0-9][A-Za-z0-9 ._/-]{0,63}",
    maxLength: 64,
    title: "Use at most 64 letters, numbers, spaces, dots, slashes, underscores, or hyphens.",
    message: "Enter a valid VAT identifier of at most 64 characters.",
  },
} as const;

export type FieldFormatName = keyof typeof FIELD_FORMATS;
export type FieldFormat = (typeof FIELD_FORMATS)[FieldFormatName];

export function fieldFormat(name: FieldFormatName): FieldFormat {
  return FIELD_FORMATS[name];
}
