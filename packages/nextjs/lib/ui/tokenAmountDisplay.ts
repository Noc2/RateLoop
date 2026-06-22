type AtomicAmount = bigint | null | undefined;

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

export function formatUsdcTokenAmount(value: AtomicAmount): string {
  return formatFixedTokenAmount(value, { displayDecimals: 2, sourceDecimals: 6 });
}

export function formatEthTokenAmount(value: AtomicAmount): string {
  return formatFixedTokenAmount(value, { displayDecimals: 4, sourceDecimals: 18 });
}
