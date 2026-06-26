type AtomicAmount = bigint | null | undefined;
type LrepAmount = bigint | number | null | undefined;

type FormatLrepAmountOptions = {
  fallback?: string;
  includeSymbol?: boolean;
  maximumFractionDigits?: number;
  roundingMode?: "half-up" | "truncate";
};

function groupWholeUnits(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatFixedTokenAmount(
  value: AtomicAmount,
  {
    displayDecimals,
    sourceDecimals,
  }: {
    displayDecimals: number;
    sourceDecimals: number;
  },
): string {
  if (value == null) return "—";

  const safeSourceDecimals = Math.max(0, Math.trunc(sourceDecimals));
  const safeDisplayDecimals = Math.max(0, Math.trunc(displayDecimals));
  const sign = value < 0n ? "-" : "";
  const absoluteValue = value < 0n ? -value : value;
  const displayScale = 10n ** BigInt(safeDisplayDecimals);
  const roundedDisplayUnits =
    safeSourceDecimals >= safeDisplayDecimals
      ? (absoluteValue + 10n ** BigInt(safeSourceDecimals - safeDisplayDecimals) / 2n) /
        10n ** BigInt(safeSourceDecimals - safeDisplayDecimals)
      : absoluteValue * 10n ** BigInt(safeDisplayDecimals - safeSourceDecimals);
  const whole = roundedDisplayUnits / displayScale;
  const fractional = roundedDisplayUnits % displayScale;

  if (safeDisplayDecimals === 0) {
    return `${sign}${groupWholeUnits(whole)}`;
  }

  return `${sign}${groupWholeUnits(whole)}.${fractional.toString().padStart(safeDisplayDecimals, "0")}`;
}

export function formatLrepTokenAmount(value: AtomicAmount): string {
  return formatFixedTokenAmount(value, { displayDecimals: 2, sourceDecimals: 6 });
}

export function formatLrepAmount(
  value: LrepAmount,
  optionsOrMaximumFractionDigits: number | FormatLrepAmountOptions = 1,
): string {
  const options =
    typeof optionsOrMaximumFractionDigits === "number"
      ? { maximumFractionDigits: optionsOrMaximumFractionDigits }
      : optionsOrMaximumFractionDigits;
  const fallback = options.fallback ?? "—";
  if (value == null) return fallback;

  const amountMicro = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  const sign = amountMicro < 0n ? "-" : "";
  const absoluteAmount = amountMicro < 0n ? -amountMicro : amountMicro;
  const whole = absoluteAmount / 1_000_000n;
  const fractionalMicro = absoluteAmount % 1_000_000n;
  const digits = Math.min(Math.max(options.maximumFractionDigits ?? 1, 0), 6);
  const roundingMode = options.roundingMode ?? "half-up";
  let formatted: string;

  if (digits === 0) {
    const roundedWhole = roundingMode === "truncate" || fractionalMicro < 500_000n ? whole : whole + 1n;
    formatted = `${sign}${groupWholeUnits(roundedWhole)}`;
  } else if (fractionalMicro === 0n) {
    formatted = `${sign}${groupWholeUnits(whole)}`;
  } else {
    const divisor = 10n ** BigInt(6 - digits);
    const roundedFractional =
      roundingMode === "truncate" ? fractionalMicro / divisor : (fractionalMicro + divisor / 2n) / divisor;
    const upperBound = 10n ** BigInt(digits);
    if (roundedFractional >= upperBound) {
      formatted = `${sign}${groupWholeUnits(whole + 1n)}`;
    } else {
      const fractionalString = roundedFractional.toString().padStart(digits, "0").replace(/0+$/, "");
      formatted = fractionalString
        ? `${sign}${groupWholeUnits(whole)}.${fractionalString}`
        : `${sign}${groupWholeUnits(whole)}`;
    }
  }

  return options.includeSymbol ? `${formatted} LREP` : formatted;
}

export function formatUsdcTokenAmount(value: AtomicAmount): string {
  return formatFixedTokenAmount(value, { displayDecimals: 2, sourceDecimals: 6 });
}

export function formatEthTokenAmount(value: AtomicAmount): string {
  return formatFixedTokenAmount(value, { displayDecimals: 4, sourceDecimals: 18 });
}
