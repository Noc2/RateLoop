import React from "react";
import { CONNECTION_MESSAGE_URL_PLACEHOLDER, HOST_TIER_BADGES } from "../hostGuide";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { buildAgentConnectionMessageForHost } from "~~/components/tokenless/agents/agentConnectionMessage";
import { TOKENLESS_HOST_CAPABILITIES } from "~~/lib/tokenless/hostCapabilities";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

function flat(value: string) {
  return value.replace(/\s+/g, " ");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

test("every host guide is a pure projection of its registry entry", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: ConnectHostPage } = await import("./page");

  for (const host of TOKENLESS_HOST_CAPABILITIES) {
    const html = flat(renderToStaticMarkup(await ConnectHostPage({ params: Promise.resolve({ host: host.id }) })));
    const includes = (expected: string, message: string) => assert.ok(html.includes(flat(expected)), message);

    includes(escapeHtml(host.displayName), `${host.id} must show its display name`);
    includes(escapeHtml(HOST_TIER_BADGES[host.supportTier].meaning), `${host.id} tier meaning missing`);
    if (host.notes) includes(escapeHtml(host.notes), `${host.id} registry notes missing`);

    assert.match(html, /What to expect/);
    for (const action of host.humanActions) {
      includes(`<li>${escapeHtml(action)}</li>`, `${host.id} must list "${action}"`);
    }

    const message = buildAgentConnectionMessageForHost({
      hostId: host.id,
      connectionUrl: CONNECTION_MESSAGE_URL_PLACEHOLDER,
    });
    includes(escapeHtml(message), `${host.id} must render its exact connection message`);
    includes(escapeHtml(CONNECTION_MESSAGE_URL_PLACEHOLDER), `${host.id} must keep the placeholder link shape`);
    assert.doesNotMatch(html, /aci_[a-f0-9]/, `${host.id} must not fabricate a live connection link`);

    assert.match(html, /Host-native setup/);
    if (host.installAffordances.length === 0) {
      assert.match(html, /No checked install command, link, or configuration snippet is published/);
    }
    for (const affordance of host.installAffordances) {
      includes(escapeHtml(affordance.label), `${host.id} affordance label missing`);
      includes(escapeHtml(affordance.value), `${host.id} affordance value missing`);
      includes(
        escapeHtml(`Checked ${affordance.checkedAt} against ${affordance.clientVersion}.`),
        `${host.id} affordance must carry its checkedAt and clientVersion attribution`,
      );
    }

    assert.match(html, /If the tools are missing after authorization/);
    assert.match(html, /href="\/docs\/agent-connection\.md"/);
    assert.match(html, /href="\/docs\/connect"/);
  }
});
