import {
  ASK_AGENT_ROUTE,
  ASK_AGENT_ROUTE_TAB,
  ASK_MANUAL_ROUTE_TAB,
  ASK_ROUTE,
  ASK_ROUTE_TAB_PARAM,
  ASK_SUBMISSIONS_ROUTE,
  ASK_SUBMISSIONS_ROUTE_TAB,
  RATE_CHAIN_ID_PARAM,
  RATE_DEPLOYMENT_KEY_PARAM,
  RATE_ROUTE,
  RATE_WAIT_FOR_CONTENT_PARAM,
  buildRateContentHref,
  buildRouteWithSearchParams,
  parseAskRouteTab,
} from "./routes";
import assert from "node:assert/strict";
import test from "node:test";

test("agent submit route targets the ask page agent tab", () => {
  assert.equal(ASK_AGENT_ROUTE, `${ASK_ROUTE}?${ASK_ROUTE_TAB_PARAM}=${ASK_AGENT_ROUTE_TAB}`);
});

test("submissions route targets the ask page submissions tab", () => {
  assert.equal(ASK_SUBMISSIONS_ROUTE, `${ASK_ROUTE}?${ASK_ROUTE_TAB_PARAM}=${ASK_SUBMISSIONS_ROUTE_TAB}`);
});

test("ask route tab parsing defaults to manual unless a known tab is requested", () => {
  assert.equal(parseAskRouteTab(ASK_AGENT_ROUTE_TAB), ASK_AGENT_ROUTE_TAB);
  assert.equal(parseAskRouteTab(ASK_MANUAL_ROUTE_TAB), ASK_MANUAL_ROUTE_TAB);
  assert.equal(parseAskRouteTab(ASK_SUBMISSIONS_ROUTE_TAB), ASK_SUBMISSIONS_ROUTE_TAB);
  assert.equal(parseAskRouteTab("docs"), ASK_MANUAL_ROUTE_TAB);
  assert.equal(parseAskRouteTab(undefined), ASK_MANUAL_ROUTE_TAB);
});

test("route search param builder preserves ask tab values", () => {
  assert.equal(buildRouteWithSearchParams(ASK_ROUTE, { [ASK_ROUTE_TAB_PARAM]: ASK_AGENT_ROUTE_TAB }), ASK_AGENT_ROUTE);
  assert.equal(
    buildRouteWithSearchParams(ASK_ROUTE, { [ASK_ROUTE_TAB_PARAM]: ASK_SUBMISSIONS_ROUTE_TAB }),
    ASK_SUBMISSIONS_ROUTE,
  );
});

test("rate content links can request a short readiness wait", () => {
  assert.equal(buildRateContentHref(88n), `${RATE_ROUTE}?content=88`);
  assert.equal(
    buildRateContentHref(88n, { waitForContent: true }),
    `${RATE_ROUTE}?content=88&${RATE_WAIT_FOR_CONTENT_PARAM}=1`,
  );
});

test("rate content links preserve deployment scope when provided", () => {
  const href = buildRateContentHref(88n, {
    chainId: 8453,
    deploymentKey: " 8453:0xabc123 ",
  });
  const url = new URL(href, "https://www.rateloop.ai");

  assert.equal(url.pathname, RATE_ROUTE);
  assert.equal(url.searchParams.get("content"), "88");
  assert.equal(url.searchParams.get(RATE_CHAIN_ID_PARAM), "8453");
  assert.equal(url.searchParams.get(RATE_DEPLOYMENT_KEY_PARAM), "8453:0xabc123");
});

test("rate content links omit invalid deployment scope", () => {
  assert.equal(
    buildRateContentHref(88n, {
      chainId: "8453.5",
      deploymentKey: "   ",
    }),
    `${RATE_ROUTE}?content=88`,
  );
});
