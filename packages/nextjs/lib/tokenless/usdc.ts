const USDC_DECIMALS = 6;
const USDC_SCALE = 1_000_000n;

export type FormatUsdcOptions = {
  includeUnit?: boolean;
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
  useGrouping?: boolean;
};

function fractionDigit(value: number | undefined, fallback: number) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0 || resolved > USDC_DECIMALS) {
    throw new RangeError(`USDC fraction digits must be between 0 and ${USDC_DECIMALS}.`);
  }
  return resolved;
}

export function formatUsdcAtomic(value: bigint | string, options: FormatUsdcOptions = {}) {
  const minimumFractionDigits = fractionDigit(options.minimumFractionDigits, 0);
  const maximumFractionDigits = fractionDigit(options.maximumFractionDigits, USDC_DECIMALS);
  if (minimumFractionDigits > maximumFractionDigits) {
    throw new RangeError("USDC minimumFractionDigits cannot exceed maximumFractionDigits.");
  }

  const atomic = typeof value === "bigint" ? value : BigInt(value);
  const negative = atomic < 0n;
  const absolute = negative ? -atomic : atomic;
  const roundingScale = 10n ** BigInt(USDC_DECIMALS - maximumFractionDigits);
  const rounded = (absolute + roundingScale / 2n) / roundingScale;
  const displayScale = 10n ** BigInt(maximumFractionDigits);
  const whole = maximumFractionDigits === 0 ? rounded : rounded / displayScale;
  const rawFraction =
    maximumFractionDigits === 0 ? "" : (rounded % displayScale).toString().padStart(maximumFractionDigits, "0");
  const trimmedFraction = rawFraction.replace(/0+$/u, "");
  const fraction = trimmedFraction.padEnd(minimumFractionDigits, "0");
  const groupedWhole = options.useGrouping === false ? whole.toString() : whole.toLocaleString("en-US");
  const amount = `${negative ? "-" : ""}${groupedWhole}${fraction ? `.${fraction}` : ""}`;
  return options.includeUnit === false ? amount : `${amount} USDC`;
}

export function parseUsdcDecimal(value: string) {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,6}))?$/u.exec(value.trim());
  if (!match) throw new Error("USDC amounts must use decimal notation with up to six decimal places.");
  const absolute = BigInt(match[2]!) * USDC_SCALE + BigInt((match[3] ?? "").padEnd(USDC_DECIMALS, "0") || "0");
  return (match[1] === "-" ? -absolute : absolute).toString();
}
