import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSURANCE_ARTIFACT_UPLOAD_FORM_BODY_MAX_BYTES,
  readAssuranceArtifactUploadForm,
} from "~~/app/api/account/workspaces/[workspaceId]/assurance/projects/[projectId]/artifacts/route";
import {
  BROWSER_IMAGE_UPLOAD_FORM_BODY_MAX_BYTES,
  readBrowserImageUploadForm,
} from "~~/app/api/account/workspaces/[workspaceId]/public-media/images/route";
import { readAgentOAuthAuthorizationForm } from "~~/app/api/agent/oauth/authorize/route";
import { readAgentOAuthDeviceAuthorizationForm } from "~~/app/api/agent/oauth/device/authorize/route";
import {
  AGENT_IMAGE_UPLOAD_FORM_BODY_MAX_BYTES,
  readAgentImageUploadForm,
} from "~~/app/api/agent/v1/media/images/route";
import { API_OAUTH_FORM_BODY_MAX_BYTES, multipartFormBodyLimit } from "~~/lib/tokenless/apiRequestBody";
import { ARTIFACT_MAX_BYTES } from "~~/lib/tokenless/artifactPrivacy";
import { PUBLIC_QUESTION_IMAGE_MAX_BYTES } from "~~/lib/tokenless/publicQuestionMedia";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type FormReader = (request: Pick<Request, "body" | "headers">) => Promise<FormData>;

const consumers: { limit: number; name: string; read: FormReader }[] = [
  {
    limit: API_OAUTH_FORM_BODY_MAX_BYTES,
    name: "OAuth authorization",
    read: readAgentOAuthAuthorizationForm,
  },
  {
    limit: API_OAUTH_FORM_BODY_MAX_BYTES,
    name: "OAuth device authorization",
    read: readAgentOAuthDeviceAuthorizationForm,
  },
  {
    limit: AGENT_IMAGE_UPLOAD_FORM_BODY_MAX_BYTES,
    name: "agent image upload",
    read: readAgentImageUploadForm,
  },
  {
    limit: BROWSER_IMAGE_UPLOAD_FORM_BODY_MAX_BYTES,
    name: "browser image upload",
    read: readBrowserImageUploadForm,
  },
  {
    limit: ASSURANCE_ARTIFACT_UPLOAD_FORM_BODY_MAX_BYTES,
    name: "assurance artifact upload",
    read: readAssuranceArtifactUploadForm,
  },
];

test("upload form limits derive from the same downstream file-byte invariants", () => {
  assert.equal(AGENT_IMAGE_UPLOAD_FORM_BODY_MAX_BYTES, multipartFormBodyLimit(PUBLIC_QUESTION_IMAGE_MAX_BYTES));
  assert.equal(BROWSER_IMAGE_UPLOAD_FORM_BODY_MAX_BYTES, multipartFormBodyLimit(PUBLIC_QUESTION_IMAGE_MAX_BYTES));
  assert.equal(ASSURANCE_ARTIFACT_UPLOAD_FORM_BODY_MAX_BYTES, multipartFormBodyLimit(ARTIFACT_MAX_BYTES));
});

function request(contentLength: string) {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("field=value"));
        controller.close();
      },
    }),
    headers: new Headers({
      "content-length": contentLength,
      "content-type": "application/x-www-form-urlencoded",
    }),
  };
}

test("all form consumers share exact-limit and limit-plus-one streaming boundaries", async () => {
  for (const consumer of consumers) {
    const exact = await consumer.read(request(String(consumer.limit)));
    assert.equal(exact.get("field"), "value", `${consumer.name} exact limit`);
    await assert.rejects(
      consumer.read(request(String(consumer.limit + 1))),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.status === 413 && error.code === "request_too_large",
      `${consumer.name} limit plus one`,
    );
  }
});

test("all form consumers reject malformed Content-Length before parsing", async () => {
  for (const consumer of consumers) {
    await assert.rejects(
      consumer.read(request("not-a-length")),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.status === 400 && error.code === "invalid_content_length",
      consumer.name,
    );
  }
});
