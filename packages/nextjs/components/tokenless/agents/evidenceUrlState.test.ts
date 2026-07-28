import { evidenceUrlHref, parseEvidenceUrlState, updateEvidenceUrlSearch } from "./evidenceUrlState";
import assert from "node:assert/strict";
import test from "node:test";

test("evidence URL state restores valid selection and filters while rejecting invalid enums", () => {
  assert.deepEqual(parseEvidenceUrlState("?tab=evidence&q=release&outcome=fail&date=30&run=run-1&packet=packet-1"), {
    query: "release",
    outcome: "fail",
    date: "30",
    runId: "run-1",
    packetId: "packet-1",
  });
  assert.deepEqual(parseEvidenceUrlState("?outcome=unknown&date=365"), {
    query: "",
    outcome: "all",
    date: "all",
    runId: null,
    packetId: null,
  });
});

test("evidence URL updates preserve unrelated workspace and tab context", () => {
  const updated = updateEvidenceUrlSearch("?tab=evidence&workspace=workspace+one&source=audit&q=old&outcome=pass", {
    query: "new query",
    outcome: "insufficient",
    date: "7",
    runId: "run/one",
    packetId: "packet one",
  });
  const params = new URLSearchParams(updated);

  assert.equal(params.get("tab"), "evidence");
  assert.equal(params.get("workspace"), "workspace one");
  assert.equal(params.get("source"), "audit");
  assert.equal(params.get("q"), "new query");
  assert.equal(params.get("outcome"), "insufficient");
  assert.equal(params.get("date"), "7");
  assert.equal(params.get("run"), "run/one");
  assert.equal(params.get("packet"), "packet one");
});

test("packet links remain on the current route and carry both identifiers", () => {
  assert.equal(
    evidenceUrlHref({
      pathname: "/agents",
      search: "?workspace=workspace-1&tab=evidence&q=release",
      hash: "#decision-packets",
      patch: { runId: "run-1", packetId: "packet-1" },
    }),
    "/agents?workspace=workspace-1&tab=evidence&q=release&run=run-1&packet=packet-1#decision-packets",
  );
});
