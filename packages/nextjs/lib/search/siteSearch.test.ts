import assert from "node:assert/strict";
import test from "node:test";
import { DOCS_NAV } from "~~/constants/docsNav";
import { SITE_SEARCH_INDEX, searchSite } from "~~/lib/search/siteSearch";

test("site search indexes every docs navigation page", () => {
  const indexedHrefs = new Set(SITE_SEARCH_INDEX.map(entry => entry.href.split("#")[0]));

  for (const group of DOCS_NAV) {
    for (const link of group.links) assert.ok(indexedHrefs.has(link.href), `${link.href} is missing from site search`);
  }
});

test("site search finds documentation by title and topic", () => {
  assert.equal(searchSite("drand")[0]?.href, "/docs/tech-stack#drand-tlock");
  assert.equal(searchSite("API errors")[0]?.href, "/docs/ai/errors");
  assert.equal(searchSite("customer support")[0]?.href, "/docs/use-cases#customer-replies");
  assert.equal(searchSite("research deliverable")[0]?.href, "/docs/use-cases#research-deliverables");
  assert.equal(searchSite("candidate ranking")[0]?.href, "/docs/use-cases#hiring-decisions");
  assert.equal(searchSite("low confidence extraction")[0]?.href, "/docs/use-cases");
  assert.ok(searchSite("adaptive review").some(result => result.href === "/docs/how-it-works#adaptive-review"));
  assert.equal(searchSite("Evidence reference")[0]?.href, "/docs/evidence");
  assert.equal(searchSite("OSCAL")[0]?.href, "/docs/evidence");
  assert.equal(searchSite("browser verification")[0]?.href, "/docs/evidence/verify");
  assert.equal(searchSite("approval privacy")[0]?.href, "/docs/ai#public-browser-handoff");
});

test("site search includes canonical tasks and core pages", () => {
  assert.equal(searchSite("assigned work")[0]?.href, "/human/review");
  assert.equal(searchSite("connect agent")[0]?.href, "/agents/connections");
  assert.equal(searchSite("invite reviewer")[0]?.href, "/agents/review-setup");
  assert.equal(searchSite("review settings")[0]?.href, "/agents/review-setup");
  assert.equal(searchSite("view results")[0]?.href, "/agents/results");
  assert.equal(searchSite("export evidence")[0]?.href, "/agents/results#evidence-packets-heading");
  assert.equal(searchSite("billing")[0]?.href, "/agents/billing");
  assert.equal(searchSite("notifications")[0]?.href, "/human/settings");
  assert.equal(searchSite("reviewer access")[0]?.href, "/human/profile");
  assert.equal(searchSite("pricing")[0]?.href, "/pricing");
  assert.deepEqual(searchSite(""), []);
});

test("site search keeps public documentation results and emits each URL once", () => {
  const results = searchSite("review", 100);
  assert.ok(results.some(result => result.area === "Docs"));
  assert.equal(new Set(results.map(result => result.href)).size, results.length);
});
