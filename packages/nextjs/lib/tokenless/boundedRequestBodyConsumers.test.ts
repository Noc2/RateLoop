import assert from "node:assert/strict";
import test from "node:test";
import { readWorkspaceMcpRequestBody } from "~~/app/api/agent/v1/mcp/route";
import { readOtlpRequestBody } from "~~/app/api/agent/v1/telemetry/v1/traces/route";
import { STRIPE_WEBHOOK_BODY_MAX_BYTES, readStripeWebhookBody } from "~~/app/api/billing/stripe/webhook/route";
import { readPublicMcpRequestBody } from "~~/app/api/mcp/route";
import { readWorldIdVerifyBody } from "~~/app/api/rater/assurance/world-id/verify/route";
import {
  ELIGIBILITY_PROVIDER_CALLBACK_BODY_MAX_BYTES,
  readEligibilityProviderCallbackBody,
} from "~~/app/api/rater/eligibility/provider/callback/route";
import { MAX_JSON_REQUEST_BODY_BYTES, readJsonRequestBody } from "~~/lib/mcp/requestBody";
import {
  AGENT_OAUTH_FORM_BODY_MAX_BYTES,
  AGENT_OAUTH_REGISTRATION_BODY_MAX_BYTES,
  readAgentOAuthFormBody,
  readAgentOAuthRegistrationBody,
} from "~~/lib/tokenless/agentOAuthHttp";
import { OTLP_INGEST_LIMITS } from "~~/lib/tokenless/otlpTraceIngest";
import { WORLD_ID_VERIFY_BODY_MAX_BYTES } from "~~/lib/tokenless/worldIdAssurance";

type BodyReader = (request: Pick<Request, "body" | "headers">) => Promise<unknown>;

const consumers: { limit: number; name: string; read: BodyReader }[] = [
  {
    limit: MAX_JSON_REQUEST_BODY_BYTES,
    name: "shared machine JSON",
    read: request => readJsonRequestBody(request),
  },
  {
    limit: MAX_JSON_REQUEST_BODY_BYTES,
    name: "public MCP",
    read: readPublicMcpRequestBody,
  },
  {
    limit: MAX_JSON_REQUEST_BODY_BYTES,
    name: "workspace MCP",
    read: readWorkspaceMcpRequestBody,
  },
  {
    limit: STRIPE_WEBHOOK_BODY_MAX_BYTES,
    name: "Stripe webhook",
    read: readStripeWebhookBody,
  },
  {
    limit: AGENT_OAUTH_REGISTRATION_BODY_MAX_BYTES,
    name: "public OAuth registration",
    read: readAgentOAuthRegistrationBody,
  },
  {
    limit: AGENT_OAUTH_FORM_BODY_MAX_BYTES,
    name: "OAuth form endpoints",
    read: readAgentOAuthFormBody,
  },
  {
    limit: ELIGIBILITY_PROVIDER_CALLBACK_BODY_MAX_BYTES,
    name: "eligibility provider callback",
    read: readEligibilityProviderCallbackBody,
  },
  {
    limit: WORLD_ID_VERIFY_BODY_MAX_BYTES,
    name: "World ID verification",
    read: readWorldIdVerifyBody,
  },
  {
    limit: OTLP_INGEST_LIMITS.compressedBytes,
    name: "OTLP trace ingest",
    read: readOtlpRequestBody,
  },
];

function request(body: string, contentLength: string) {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    headers: new Headers({ "content-length": contentLength }),
  };
}

function statusOf(result: unknown) {
  if (result && typeof result === "object" && "status" in result && typeof result.status === "number") {
    return result.status;
  }
  return 200;
}

async function outcome(consumer: (typeof consumers)[number], contentLength: string) {
  try {
    return statusOf(await consumer.read(request("{}", contentLength)));
  } catch (error) {
    return statusOf(error);
  }
}

test("all low-trust body consumers bind exact-limit and limit-plus-one declarations to the shared reader", async () => {
  for (const consumer of consumers) {
    assert.equal(await outcome(consumer, String(consumer.limit)), 200, `${consumer.name} exact limit`);
    assert.equal(await outcome(consumer, String(consumer.limit + 1)), 413, `${consumer.name} limit plus one`);
  }
});

test("all low-trust body consumers fail closed on malformed Content-Length", async () => {
  for (const consumer of consumers) {
    assert.equal(await outcome(consumer, "not-a-length"), 400, consumer.name);
  }
});
