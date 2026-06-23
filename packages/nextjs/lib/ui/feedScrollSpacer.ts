interface EndSpacerHeightInput {
  scrollerHeight: number;
  lastCardHeight: number;
  minimumEndSpacer?: number;
  reservedEndSpace?: number;
  topSnapGuard?: number;
}

export function resolveEndSpacerHeightForLastCardSnap({
  scrollerHeight,
  lastCardHeight,
  minimumEndSpacer = 0,
  reservedEndSpace = 0,
  topSnapGuard = 0,
}: EndSpacerHeightInput) {
  const requiredEndSpace = Math.max(0, Math.ceil(scrollerHeight) - Math.ceil(lastCardHeight) - Math.ceil(topSnapGuard));

  return Math.max(0, Math.ceil(minimumEndSpacer), requiredEndSpace - Math.ceil(reservedEndSpace));
}
