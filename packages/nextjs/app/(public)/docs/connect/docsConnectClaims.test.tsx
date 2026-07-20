import React from "react";
import { HOST_TIER_BADGES } from "./hostGuide";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  TOKENLESS_HOST_CAPABILITIES,
  TOKENLESS_HOST_SUPPORT_TIERS,
  type TokenlessHostSupportTier,
} from "~~/lib/tokenless/hostCapabilities";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function renderIndexPage() {
  const { default: ConnectHostIndexPage } = await import("./page");
  return renderToStaticMarkup(<ConnectHostIndexPage />);
}

async function renderHostPage(hostId: string) {
  const { default: ConnectHostPage } = await import("./[host]/page");
  return renderToStaticMarkup(await ConnectHostPage({ params: Promise.resolve({ host: hostId }) }));
}

function renderedTiers(html: string): string[] {
  return [...html.matchAll(/data-tier="([^"]*)"/g)].map(match => match[1]!);
}

test("connect docs render only hosts that exist in the capability registry", async () => {
  const registryIds = TOKENLESS_HOST_CAPABILITIES.map(host => host.id);

  const { generateStaticParams } = await import("./[host]/page");
  assert.deepEqual(
    generateStaticParams().map(params => params.host),
    registryIds,
  );

  const indexHtml = await renderIndexPage();
  const linkedIds = [...indexHtml.matchAll(/href="\/docs\/connect\/([^"]+)"/g)].map(match => match[1]!);
  assert.deepEqual([...linkedIds].sort(), [...registryIds].sort(), "index links must be exactly the registry hosts");

  await assert.rejects(renderHostPage("not-a-registry-host"), "an unknown host id must not render a guide");
});

test("no connect docs page claims a support tier the registry does not grant", async () => {
  const pages = [
    { name: "index", html: await renderIndexPage(), hosts: TOKENLESS_HOST_CAPABILITIES },
    ...(await Promise.all(
      TOKENLESS_HOST_CAPABILITIES.map(async host => ({
        name: host.id,
        html: await renderHostPage(host.id),
        hosts: [host],
      })),
    )),
  ];

  for (const page of pages) {
    // The case-sensitive tier label "Verified" may appear only when the registry
    // grants tier "verified" on that page's host(s). Today no host is verified,
    // so this asserts the word appears nowhere in any rendered page.
    if (!page.hosts.some(host => (host.supportTier as TokenlessHostSupportTier) === "verified")) {
      assert.doesNotMatch(page.html, /Verified/, `${page.name} must not use the label of an ungranted tier`);
    }

    const grantedTiers = new Set<TokenlessHostSupportTier>(page.hosts.map(host => host.supportTier));
    for (const tier of TOKENLESS_HOST_SUPPORT_TIERS) {
      if (grantedTiers.has(tier)) continue;
      assert.doesNotMatch(
        page.html,
        new RegExp(`\\b${HOST_TIER_BADGES[tier].label}\\b`),
        `${page.name} must not carry the ungranted "${HOST_TIER_BADGES[tier].label}" tier label`,
      );
    }
  }
});

test("rendered tier badges match the registry exactly", async () => {
  for (const host of TOKENLESS_HOST_CAPABILITIES) {
    const html = await renderHostPage(host.id);
    assert.deepEqual(renderedTiers(html), [host.supportTier], `${host.id} must render exactly its registry tier`);
    assert.ok(
      html.includes(`data-tier="${host.supportTier}"`) && html.includes(HOST_TIER_BADGES[host.supportTier].label),
      `${host.id} badge must carry the registry tier label`,
    );
  }

  const indexTiers = renderedTiers(await renderIndexPage());
  assert.deepEqual(
    [...indexTiers].sort(),
    TOKENLESS_HOST_CAPABILITIES.map(host => host.supportTier as string).sort(),
    "the index must render one badge per host with its registry tier",
  );
});
