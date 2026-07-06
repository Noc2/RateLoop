import {
  type WebMcpDocument,
  type WebMcpToolDefinition,
  isWebMcpAvailable,
  normalizeWebMcpTool,
  registerWebMcpTools,
} from "./registerTools";
import assert from "node:assert/strict";
import { test } from "node:test";

function validTool(overrides: Partial<WebMcpToolDefinition> = {}): WebMcpToolDefinition {
  return {
    description: "Read the current browser handoff status.",
    execute: () => ({ status: "pending" }),
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object",
    },
    name: "rateloop_get_browser_handoff_status",
    ...overrides,
  };
}

test("detects WebMCP support from document.modelContext", () => {
  assert.equal(isWebMcpAvailable(null), false);
  assert.equal(isWebMcpAvailable({}), false);
  assert.equal(
    isWebMcpAvailable({
      modelContext: {
        registerTool: () => undefined,
      },
    }),
    true,
  );
});

test("normalizes safe defaults for WebMCP annotations", () => {
  const tool = normalizeWebMcpTool(validTool());

  assert.deepEqual(tool.annotations, {
    readOnlyHint: false,
    untrustedContentHint: true,
  });
});

test("rejects invalid WebMCP tool metadata", () => {
  assert.throws(() => normalizeWebMcpTool(validTool({ name: "bad name" })), /Invalid WebMCP tool name/);
  assert.throws(() => normalizeWebMcpTool(validTool({ description: "" })), /must have a description/);
  assert.throws(
    () => normalizeWebMcpTool(validTool({ inputSchema: [] as unknown as Record<string, unknown> })),
    /inputSchema must be an object/,
  );
});

test("registers tools with cleanup signals and no-ops without WebMCP", () => {
  const calls: Array<{ options?: { signal?: AbortSignal }; tool: WebMcpToolDefinition }> = [];
  const documentLike: WebMcpDocument = {
    modelContext: {
      registerTool: (tool, options) => calls.push({ options, tool }),
    },
  };

  const noopCleanup = registerWebMcpTools([validTool()], { document: {} });
  noopCleanup();

  const cleanup = registerWebMcpTools([validTool({ annotations: { readOnlyHint: true } })], {
    document: documentLike,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.tool.annotations?.readOnlyHint, true);
  assert.equal(calls[0]?.tool.annotations?.untrustedContentHint, true);
  assert.equal(calls[0]?.options?.signal?.aborted, false);

  cleanup();

  assert.equal(calls[0]?.options?.signal?.aborted, true);
});

test("reports registration failures instead of throwing after validation", () => {
  const errors: unknown[] = [];
  const documentLike: WebMcpDocument = {
    modelContext: {
      registerTool: () => {
        throw new Error("browser rejected tool");
      },
    },
  };

  registerWebMcpTools([validTool()], {
    document: documentLike,
    onError: error => errors.push(error),
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0] instanceof Error ? errors[0].message : "", /browser rejected tool/);
});
