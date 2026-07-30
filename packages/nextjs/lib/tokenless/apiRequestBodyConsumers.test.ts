import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  MAX_ASSURANCE_RESPONSE_BATCH_BODY_BYTES,
  readAssuranceResponseBatchBody,
} from "~~/app/api/account/assurance/assignments/[assignmentId]/responses/route";
import {
  MAX_WORM_EXPORT_REQUEST_BODY_BYTES,
  readWormExportRequestBody,
} from "~~/app/api/account/workspaces/[workspaceId]/assurance/worm/exports/route";
import { readAgentRegistrationBody } from "~~/app/api/agent/v1/registrations/route";
import {
  MAX_AUTOMATED_EVAL_RECEIPT_BYTES,
  readAutomatedEvalReceiptBody,
} from "~~/app/api/assurance/v1/evaluations/receipts/route";
import { readModerationRequestBody } from "~~/app/api/internal/tokenless/moderation/route";
import { readPipelineRequestBody } from "~~/app/api/internal/tokenless/pipeline/route";
import { MAX_RATER_COMMIT_BODY_BYTES, readRaterCommitBody } from "~~/app/api/rater/commits/route";
import {
  MAX_PAID_ELIGIBILITY_REQUEST_BODY_BYTES,
  readPaidEligibilityRequestBody,
} from "~~/app/api/rater/eligibility/route";
import { readPaidVoucherRequestBody } from "~~/app/api/rater/vouchers/route";
import { API_JSON_REQUEST_BODY_MAX_BYTES } from "~~/lib/tokenless/apiRequestBody";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type BodyReader = (request: Pick<Request, "body" | "headers">) => Promise<unknown>;

const consumers: { errorCode?: string; limit: number; name: string; read: BodyReader }[] = [
  {
    limit: MAX_ASSURANCE_RESPONSE_BATCH_BODY_BYTES,
    name: "assurance response batch",
    read: readAssuranceResponseBatchBody,
  },
  { limit: API_JSON_REQUEST_BODY_MAX_BYTES, name: "agent registration", read: readAgentRegistrationBody },
  {
    errorCode: "automated_eval_receipt_too_large",
    limit: MAX_AUTOMATED_EVAL_RECEIPT_BYTES,
    name: "automated evaluation receipt",
    read: request =>
      readAutomatedEvalReceiptBody({
        ...request,
        headers: new Headers([...request.headers, ["content-type", "application/json"]]),
      }),
  },
  { limit: API_JSON_REQUEST_BODY_MAX_BYTES, name: "internal moderation", read: readModerationRequestBody },
  { limit: API_JSON_REQUEST_BODY_MAX_BYTES, name: "internal pipeline", read: readPipelineRequestBody },
  {
    limit: MAX_PAID_ELIGIBILITY_REQUEST_BODY_BYTES,
    name: "paid eligibility",
    read: readPaidEligibilityRequestBody,
  },
  { limit: MAX_RATER_COMMIT_BODY_BYTES, name: "rater commit", read: readRaterCommitBody },
  { limit: API_JSON_REQUEST_BODY_MAX_BYTES, name: "paid voucher", read: readPaidVoucherRequestBody },
  { limit: MAX_WORM_EXPORT_REQUEST_BODY_BYTES, name: "WORM export artifact", read: readWormExportRequestBody },
];

function request(contentLength: number) {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    }),
    headers: new Headers({ "content-length": String(contentLength) }),
  };
}

function routeFiles(root: URL): URL[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, root);
    if (entry.isDirectory()) return routeFiles(url);
    return entry.name === "route.ts" ? [url] : [];
  });
}

test("high-cost API consumers share exact-limit and limit-plus-one body boundaries", async () => {
  for (const consumer of consumers) {
    assert.deepEqual(await consumer.read(request(consumer.limit)), {}, `${consumer.name} exact limit`);
    await assert.rejects(
      consumer.read(request(consumer.limit + 1)),
      (error: unknown) =>
        error instanceof TokenlessServiceError &&
        error.status === 413 &&
        error.code === (consumer.errorCode ?? "request_too_large"),
      `${consumer.name} limit plus one`,
    );
  }
});

test("API routes do not bypass the streaming body readers", () => {
  const routes = routeFiles(new URL("../../app/api/", import.meta.url));
  const bypasses = routes.filter(route =>
    /\brequest\.(?:arrayBuffer|formData|json|text)\s*\(/u.test(readFileSync(route, "utf8")),
  );
  assert.deepEqual(
    bypasses.map(route => route.pathname),
    [],
  );
});

test("API routes cannot swallow streaming boundary failures while remapping invalid JSON", () => {
  const routes = routeFiles(new URL("../../app/api/", import.meta.url));
  const swallowing = routes.filter(route => {
    const source = readFileSync(route, "utf8");
    if (!source.includes("readApiJsonRequestBody")) return false;
    return (
      /read(?:ApiJson|[A-Z][A-Za-z]+)RequestBody\([^;]*?\.catch\(\(\)\s*=>/su.test(source) ||
      /\}\s*catch\s*\{/u.test(source)
    );
  });
  assert.deepEqual(
    swallowing.map(route => route.pathname),
    [],
  );
});
