export type HumanDurationUnit = "seconds" | "minutes" | "hours" | "days";

export const HUMAN_DURATION_UNIT_OPTIONS: Array<{ value: HumanDurationUnit; label: string; seconds: number }> = [
  { value: "seconds", label: "Seconds", seconds: 1 },
  { value: "minutes", label: "Minutes", seconds: 60 },
  { value: "hours", label: "Hours", seconds: 60 * 60 },
  { value: "days", label: "Days", seconds: 24 * 60 * 60 },
];

const UNIT_SECONDS = Object.fromEntries(
  HUMAN_DURATION_UNIT_OPTIONS.map(option => [option.value, option.seconds]),
) as Record<HumanDurationUnit, number>;

function pluralize(value: number, unit: string) {
  return `${value.toLocaleString()} ${unit}${value === 1 ? "" : "s"}`;
}

function toFinitePositiveInteger(value: bigint | number | null | undefined): number {
  if (typeof value === "bigint") {
    return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : 0;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

export function getHumanDurationUnitSeconds(unit: HumanDurationUnit): number {
  return UNIT_SECONDS[unit];
}

export function normalizeDurationAmountInput(value: string): string | null {
  if (value === "" || /^\d+$/.test(value)) {
    return value;
  }

  return null;
}

export function parseDurationAmountInput(value: string): number {
  const normalized = normalizeDurationAmountInput(value);
  if (normalized === null || normalized === "") {
    return 0;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export function durationAmountToMinutes(amount: string | number, unit: HumanDurationUnit): number {
  const totalSeconds = durationAmountToSeconds(amount, unit);
  return totalSeconds > 0 ? Math.floor(totalSeconds / 60) : 0;
}

export function durationAmountToSeconds(amount: string | number, unit: HumanDurationUnit): number {
  const parsedAmount = typeof amount === "number" ? Math.floor(amount) : parseDurationAmountInput(amount);
  if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
    return 0;
  }

  return parsedAmount * getHumanDurationUnitSeconds(unit);
}

export function getBestDurationInputPartsFromMinutes(minutes: string | number | null | undefined): {
  amount: string;
  unit: HumanDurationUnit;
} {
  const parsedMinutes =
    typeof minutes === "string" ? parseDurationAmountInput(minutes) : typeof minutes === "number" ? minutes : 0;

  if (!Number.isSafeInteger(parsedMinutes) || parsedMinutes <= 0) {
    return { amount: "", unit: "minutes" };
  }

  return getBestDurationInputPartsFromSeconds(parsedMinutes * 60);
}

export function getBestDurationInputPartsFromSeconds(seconds: string | number | null | undefined): {
  amount: string;
  unit: HumanDurationUnit;
} {
  const parsedSeconds =
    typeof seconds === "string" ? parseDurationAmountInput(seconds) : typeof seconds === "number" ? seconds : 0;

  if (!Number.isSafeInteger(parsedSeconds) || parsedSeconds <= 0) {
    return { amount: "", unit: "minutes" };
  }

  if (parsedSeconds % UNIT_SECONDS.days === 0) {
    return { amount: String(parsedSeconds / UNIT_SECONDS.days), unit: "days" };
  }

  if (parsedSeconds % UNIT_SECONDS.hours === 0) {
    return { amount: String(parsedSeconds / UNIT_SECONDS.hours), unit: "hours" };
  }

  if (parsedSeconds % UNIT_SECONDS.minutes === 0) {
    return { amount: String(parsedSeconds / UNIT_SECONDS.minutes), unit: "minutes" };
  }

  return { amount: String(parsedSeconds), unit: "seconds" };
}

export function formatHumanDuration(seconds: bigint | number | null | undefined): string {
  const totalSeconds = toFinitePositiveInteger(seconds);
  if (totalSeconds <= 0) {
    return "0 minutes";
  }

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const remainingSeconds = totalSeconds % 60;
  const parts: string[] = [];

  if (days > 0) parts.push(pluralize(days, "day"));
  if (hours > 0) parts.push(pluralize(hours, "hour"));
  if (minutes > 0) parts.push(pluralize(minutes, "minute"));
  if (parts.length === 0 || remainingSeconds > 0) parts.push(pluralize(remainingSeconds || totalSeconds, "second"));

  if (parts.length === 1) {
    return parts[0];
  }

  return `${parts.slice(0, -1).join(", ")} ${parts.at(-1)}`;
}

export function formatHumanDurationFromMinutes(minutes: string | number | null | undefined): string {
  const parsedMinutes =
    typeof minutes === "string" ? parseDurationAmountInput(minutes) : typeof minutes === "number" ? minutes : 0;

  if (!Number.isSafeInteger(parsedMinutes) || parsedMinutes <= 0) {
    return "0 minutes";
  }

  return formatHumanDuration(parsedMinutes * 60);
}

export function formatHumanDurationFromSeconds(seconds: string | number | null | undefined): string {
  const parsedSeconds =
    typeof seconds === "string" ? parseDurationAmountInput(seconds) : typeof seconds === "number" ? seconds : 0;

  if (!Number.isSafeInteger(parsedSeconds) || parsedSeconds <= 0) {
    return "0 minutes";
  }

  return formatHumanDuration(parsedSeconds);
}
