type JsonObject = Record<string, unknown>;

const WEBMCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const WEBMCP_MAX_DESCRIPTION_LENGTH = 2_000;

export type WebMcpToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
};

export type WebMcpToolClient = {
  requestUserInteraction?: (callback: () => Promise<unknown> | unknown) => Promise<unknown>;
};

export type WebMcpToolDefinition = {
  annotations?: WebMcpToolAnnotations;
  description: string;
  execute: (input: unknown, client?: WebMcpToolClient) => Promise<unknown> | unknown;
  inputSchema?: JsonObject;
  name: string;
  title?: string;
};

type WebMcpRegisterToolOptions = {
  exposedTo?: string[];
  signal?: AbortSignal;
};

export type WebMcpDocument = {
  modelContext?: {
    registerTool?: (tool: WebMcpToolDefinition, options?: WebMcpRegisterToolOptions) => Promise<unknown> | unknown;
  };
};

type RegisterWebMcpToolsOptions = {
  document?: WebMcpDocument | null;
  exposedTo?: string[];
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
};

const DEFAULT_WEBMCP_ANNOTATIONS: Required<WebMcpToolAnnotations> = {
  readOnlyHint: false,
  untrustedContentHint: true,
};

function resolveDocument(documentLike?: WebMcpDocument | null) {
  if (documentLike !== undefined) return documentLike;
  return typeof document === "undefined" ? null : (document as WebMcpDocument);
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAnnotations(annotations: WebMcpToolAnnotations | undefined): Required<WebMcpToolAnnotations> {
  return {
    readOnlyHint: annotations?.readOnlyHint ?? DEFAULT_WEBMCP_ANNOTATIONS.readOnlyHint,
    untrustedContentHint: annotations?.untrustedContentHint ?? DEFAULT_WEBMCP_ANNOTATIONS.untrustedContentHint,
  };
}

export function normalizeWebMcpTool(tool: WebMcpToolDefinition): WebMcpToolDefinition {
  if (!WEBMCP_TOOL_NAME_PATTERN.test(tool.name)) {
    throw new Error(`Invalid WebMCP tool name: ${tool.name}`);
  }
  if (!tool.description.trim()) {
    throw new Error(`WebMCP tool ${tool.name} must have a description.`);
  }
  if (tool.description.length > WEBMCP_MAX_DESCRIPTION_LENGTH) {
    throw new Error(`WebMCP tool ${tool.name} description is too long.`);
  }
  if (tool.inputSchema !== undefined && !isJsonObject(tool.inputSchema)) {
    throw new Error(`WebMCP tool ${tool.name} inputSchema must be an object.`);
  }

  return {
    ...tool,
    annotations: normalizeAnnotations(tool.annotations),
  };
}

export function isWebMcpAvailable(documentLike?: WebMcpDocument | null) {
  return typeof resolveDocument(documentLike)?.modelContext?.registerTool === "function";
}

export function registerWebMcpTools(tools: readonly WebMcpToolDefinition[], options: RegisterWebMcpToolsOptions = {}) {
  const modelContext = resolveDocument(options.document)?.modelContext;
  const registerTool = modelContext?.registerTool;

  if (!registerTool) {
    return () => undefined;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", abort, { once: true });
    }
  }

  const reportError = (error: unknown) => {
    if (options.onError) {
      options.onError(error);
      return;
    }

    console.warn("[webmcp] tool registration failed", error);
  };

  for (const tool of tools.map(normalizeWebMcpTool)) {
    try {
      Promise.resolve(
        registerTool.call(modelContext, tool, {
          exposedTo: options.exposedTo,
          signal: controller.signal,
        }),
      ).catch(reportError);
    } catch (error) {
      reportError(error);
    }
  }

  return () => {
    options.signal?.removeEventListener("abort", abort);
    controller.abort();
  };
}
