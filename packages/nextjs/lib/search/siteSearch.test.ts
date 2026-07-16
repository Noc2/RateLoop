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
  assert.ok(searchSite("refund compensation").some(result => result.href === "/docs/how-it-works#settlement-paths"));
});

test("site search includes Discover questions and core pages", () => {
  assert.equal(searchSite("questions")[0]?.href, "/human?tab=discover");
  assert.equal(searchSite("pricing")[0]?.href, "/pricing");
  assert.deepEqual(searchSite(""), []);
});
