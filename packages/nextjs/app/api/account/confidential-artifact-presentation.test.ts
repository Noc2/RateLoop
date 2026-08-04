import assert from "node:assert/strict";
import test from "node:test";
import { buildConfidentialArtifactResponse as assignmentArtifactResponse } from "~~/app/api/account/assurance/assignments/[assignmentId]/artifacts/[artifactId]/route";
import { buildConfidentialArtifactResponse as workspaceArtifactResponse } from "~~/app/api/account/workspaces/[workspaceId]/assurance/projects/[projectId]/artifacts/[artifactId]/route";
import { buildConfidentialArtifactResponse as adjudicationArtifactResponse } from "~~/app/api/account/workspaces/[workspaceId]/compliance/dsa/reference-panel/adjudications/[unitId]/artifact/route";

const HTML = new TextEncoder().encode('<script>fetch("/api/account")</script>');
const responders = [assignmentArtifactResponse, workspaceArtifactResponse, adjudicationArtifactResponse] as const;

function artifact(rendererPolicy: string, contentType = "text/html") {
  return { bytes: HTML, contentType, rendererPolicy, sizeBytes: HTML.byteLength };
}

test("every confidential artifact handler shares the same presentation policy", () => {
  assert.equal(workspaceArtifactResponse, assignmentArtifactResponse);
  assert.equal(adjudicationArtifactResponse, assignmentArtifactResponse);
});

test("every confidential artifact handler renders plain-text policy as inert text", async () => {
  for (const respond of responders) {
    const response = respond({ artifact: artifact("plain_text"), filename: "artifact_exact" });
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(response.headers.get("content-disposition"), null);
    assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(await response.text(), new TextDecoder().decode(HTML));
  }
});

test("every confidential artifact handler downloads HTML until sanitization is implemented", () => {
  for (const respond of responders) {
    for (const rendererPolicy of ["sanitized_html", "download", "unknown"]) {
      const response = respond({ artifact: artifact(rendererPolicy), filename: 'artifact\"exact' });
      assert.equal(response.headers.get("content-type"), "text/html");
      assert.equal(response.headers.get("content-disposition"), 'attachment; filename="artifact-exact"');
      assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
    }
  }
});

test("every confidential artifact handler inlines only supported image policy media", () => {
  for (const respond of responders) {
    const image = respond({ artifact: artifact("image", "image/png"), filename: "image.png" });
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(image.headers.get("content-disposition"), null);

    const svg = respond({ artifact: artifact("image", "image/svg+xml"), filename: "image.svg" });
    assert.equal(svg.headers.get("content-disposition"), 'attachment; filename="image.svg"');

    const exported = respond({ artifact: artifact("image", "image/webp"), download: true, filename: "image.webp" });
    assert.equal(exported.headers.get("content-disposition"), 'attachment; filename="image.webp"');
  }
});
