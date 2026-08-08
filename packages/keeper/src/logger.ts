type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function formatTime(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function formatData(data?: Record<string, unknown>): string {
  if (!data) return "";
  return Object.entries(data)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
}

/**
 * Strips credentials out of any URL that reaches a log line, keeping the scheme
 * and host.
 *
 * Managed RPC providers put the API key in the URL path, and viem interpolates
 * the full request URL into `HttpRequestError`, `RpcRequestError` and
 * `TimeoutError` messages -- `getUrl` is the identity function. Every keeper
 * failure path logs `error.message` verbatim, so an ordinary 429 was enough to
 * write the provider credential into the service logs, where anyone with log
 * access could read it.
 *
 * Redaction lives here rather than at the call sites because there are more than
 * a dozen of them and a new one is one `catch` block away. Unlike the app's
 * `logRedactedError`, which drops the message entirely, this keeps the message
 * and the host: the keeper is an operational service where the error text is the
 * primary diagnostic, and a log that says only "something failed" trades a real
 * credential risk for a real outage risk.
 */
export function redactCredentials(value: string): string {
  return value
    // Basic-auth userinfo, before the path rule can hide it.
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/giu, "$1[redacted]@")
    // Anything after the host: path, query and fragment can all carry a key.
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^/\s?#]+)[/?#][^\s"']*/giu, "$1/[redacted]");
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactCredentials(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactUnknown(v)]));
  }
  return value;
}

export function createLogger(
  format: "json" | "text",
  minLevel: LogLevel = "info"
): Logger {
  const minPriority = LEVEL_PRIORITY[minLevel];

  function log(level: LogLevel, rawMsg: string, rawData?: Record<string, unknown>) {
    if (LEVEL_PRIORITY[level] < minPriority) return;
    // Applied once, here, so no call site can forget it.
    const msg = redactCredentials(rawMsg);
    const data = rawData ? (redactUnknown(rawData) as Record<string, unknown>) : rawData;

    if (format === "json") {
      const entry: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        level,
        msg,
        ...data,
      };
      const stream = level === "error" ? process.stderr : process.stdout;
      stream.write(JSON.stringify(entry) + "\n");
    } else {
      const extra = formatData(data);
      const prefix = `[Keeper] ${formatTime()} ${level.toUpperCase()}`;
      const line = extra ? `${prefix} ${msg} ${extra}` : `${prefix} ${msg}`;
      const stream = level === "error" ? console.error : console.log;
      stream(line);
    }
  }

  return {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
  };
}
