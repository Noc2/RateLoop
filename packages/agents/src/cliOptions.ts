export type CliOptionValue = string | boolean | string[];
export type CliOptions = Record<string, CliOptionValue>;

const POSITIVE_DECIMAL_INTEGER_PATTERN = /^[1-9]\d*$/;

export function readOptionalPositiveInteger(
  options: CliOptions,
  name: string,
): number | undefined {
  const value = options[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`--${name} must be a positive base-10 safe integer`);
  }
  if (!POSITIVE_DECIMAL_INTEGER_PATTERN.test(value)) {
    throw new Error(`--${name} must be a positive base-10 safe integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive base-10 safe integer`);
  }
  return parsed;
}
