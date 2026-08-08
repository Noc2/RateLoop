import { describe, expect, it } from "vitest";
import { createLogger, redactCredentials } from "../logger";

describe("redactCredentials", () => {
  it("removes an API key carried in an RPC URL path", () => {
    // The shape viem produces: `getUrl` is the identity function, so the full
    // request URL lands in the error message.
    const message =
      "HTTP request failed.\n\nURL: https://base-sepolia.g.alchemy.com/v2/SECRET_KEY_VALUE\nRequest body: {}";
    const redacted = redactCredentials(message);
    expect(redacted).not.toContain("SECRET_KEY_VALUE");
    // The host survives, because that is the part an operator needs.
    expect(redacted).toContain("https://base-sepolia.g.alchemy.com/[redacted]");
  });

  it("removes a key carried in a query string", () => {
    const redacted = redactCredentials("TimeoutError URL: https://rpc.example.test/?apikey=SECRET_KEY_VALUE");
    expect(redacted).not.toContain("SECRET_KEY_VALUE");
    expect(redacted).toContain("https://rpc.example.test/[redacted]");
  });

  it("removes basic-auth userinfo", () => {
    const redacted = redactCredentials("connect https://user:SECRET_KEY_VALUE@rpc.example.test/v2/path");
    expect(redacted).not.toContain("SECRET_KEY_VALUE");
    expect(redacted).toContain("[redacted]@rpc.example.test/[redacted]");
  });

  it("leaves text without a URL untouched", () => {
    expect(redactCredentials("nonce too low")).toBe("nonce too low");
    expect(redactCredentials("round 7 scored")).toBe("round 7 scored");
  });

  it("keeps a bare origin readable", () => {
    expect(redactCredentials("polling https://rpc.example.test")).toBe("polling https://rpc.example.test");
  });
});

describe("createLogger", () => {
  function captureJson(run: (logger: ReturnType<typeof createLogger>) => void) {
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      run(createLogger("json", "debug"));
    } finally {
      process.stderr.write = original;
    }
    return written.join("");
  }

  it("redacts the message and every nested string in the data payload", () => {
    // Every keeper failure path passes `error.message` straight through, so the
    // chokepoint has to be the logger rather than the call sites.
    const output = captureJson(logger => {
      logger.error("HTTP request failed. URL: https://rpc.example.test/v2/SECRET_IN_MSG", {
        error: "URL: https://rpc.example.test/v2/SECRET_IN_DATA",
        nested: { urls: ["https://rpc.example.test/v2/SECRET_IN_ARRAY"] },
        round: 7,
      });
    });
    expect(output).not.toContain("SECRET_IN_MSG");
    expect(output).not.toContain("SECRET_IN_DATA");
    expect(output).not.toContain("SECRET_IN_ARRAY");
    // Non-string values are preserved so the log stays useful.
    expect(output).toContain('"round":7');
  });
});
