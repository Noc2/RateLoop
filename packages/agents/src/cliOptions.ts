export type CliOptionValue = string | boolean | string[];
export type CliOptions = Record<string, CliOptionValue>;

const POSITIVE_DECIMAL_INTEGER_PATTERN = /^[1-9]\d*$/;
const COMMAND_OPTIONS: Record<string, ReadonlySet<string>> = {
  ask: new Set(["file"]),
  quote: new Set(["file"]),
  result: new Set(["operation-key"]),
  wait: new Set([
    "cursor",
    "max-wait-ms",
    "operation-key",
    "timeout-ms",
    "until-ready",
  ]),
};

export function validateCliOptions(command: string, options: CliOptions): void {
  const allowed = COMMAND_OPTIONS[command];
  if (!allowed) return;

  for (const [name, value] of Object.entries(options)) {
    if (!allowed.has(name)) {
      throw new Error(`Unknown option --${name} for ${command}`);
    }
    if (Array.isArray(value)) {
      throw new Error(`--${name} may only be specified once`);
    }
  }
}

export function readOptionalPositiveInteger(
  options: CliOptions,
  name: string,
): number | undefined {
  const value = options[name];
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !POSITIVE_DECIMAL_INTEGER_PATTERN.test(value)
  ) {
    throw new Error(`--${name} must be a positive base-10 safe integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--${name} must be a positive base-10 safe integer`);
  }
  return parsed;
}

export function readBooleanFlag(options: CliOptions, name: string): boolean {
  const value = options[name];
  if (value === undefined) return false;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`--${name} must be a boolean flag`);
}
