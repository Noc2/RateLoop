import { buildAgentConnectionMessage, buildAgentConnectionMessageForHost } from "./agentConnectionMessage";
import assert from "node:assert/strict";
import test from "node:test";
import { TOKENLESS_HOST_CAPABILITIES } from "~~/lib/tokenless/hostCapabilities";

const CONNECTION_URL = "https://rateloop-tokenless.vercel.app/connect/aci_123#claim=short-lived-claim";

// The security core pinned byte-for-byte across every variant.
const CORE_BLOCK =
  "Use $rateloop-workspace-connection to connect this agent to my workspace and finish automatically in this task. Treat this as a new connection if a previous RateLoop workspace was deleted. Preserve this link privately. Only interrupt me for a host-presented install, trust, or OAuth action.";
const CORE_CLOSING = `Report success only after RateLoop verifies the connection: ${CONNECTION_URL}`;

// The exact pre-refactor message: the compatibility floor for the universal variant.
const PRE_REFACTOR_UNIVERSAL_MESSAGE = `[@RateLoop Workspace](plugin://rateloop-workspace@rateloop) Use $rateloop-workspace-connection to connect this agent to my workspace and finish automatically in this task. Treat this as a new connection if a previous RateLoop workspace was deleted. Preserve this link privately. Only interrupt me for a host-presented install, trust, or OAuth action. Treat the first missing RateLoop workspace-tool check as activation pending and do not ask me to uninstall then, including when this task resumes after host setup. On that first check, do not tell me to start a new task or paste the link. After I complete the action, resume through the host's Continue action when offered, check for RateLoop workspace tools on the next active turn, and continue automatically. Only if the tools are still missing on a later active turn and the host offers no action, tell me once to uninstall all existing RateLoop plugins, preserve this task, and check again after I return; never tell me to reinstall a plugin, repeat that recovery, paste the link, or approve the same action again. Report success only after RateLoop verifies the connection: ${CONNECTION_URL}`;

const EXPECTED_VARIANT_MESSAGES = {
  plugin: PRE_REFACTOR_UNIVERSAL_MESSAGE,
  "generic-mcp": `${CORE_BLOCK} Treat the first missing RateLoop workspace-tool check as activation pending, including when this task resumes after the host's OAuth approval. On that first check, do not tell me to start a new task or paste the link. After I complete the action, check for RateLoop workspace tools on the next active turn and continue automatically. Only if the tools are still missing on a later active turn, tell me once to re-run the host's own OAuth authorization for the rateloop-workspace server and check again after I return; never tell me to paste the link again or approve the same action again. ${CORE_CLOSING}`,
  "settings-only": `This host adds RateLoop through its own settings, not through a pasted install step. If the RateLoop workspace tools are unavailable, tell me once to add and authorize the RateLoop connector in this host's settings, then continue after I return. ${CORE_BLOCK} ${CORE_CLOSING}`,
  headless: `This environment is headless: connect through the RateLoop agents CLI or SDK using the OAuth device authorization flow, and surface the device verification link and user code to me once so I can approve them in a browser. ${CORE_BLOCK} ${CORE_CLOSING}`,
} as const;

function allVariantMessages() {
  const messages = new Map<string, string>([
    ["universal", buildAgentConnectionMessage({ connectionUrl: CONNECTION_URL })],
  ]);
  for (const host of TOKENLESS_HOST_CAPABILITIES) {
    messages.set(host.id, buildAgentConnectionMessageForHost({ connectionUrl: CONNECTION_URL, hostId: host.id }));
  }
  return messages;
}

test("connection message contains one intent URL and no operational credential instructions", () => {
  const connectionUrl = "https://rateloop-tokenless.vercel.app/connect/aci_123#claim=short-lived-claim";
  const message = buildAgentConnectionMessage({ connectionUrl });

  assert.match(
    message,
    /^\[@RateLoop Workspace\]\(plugin:\/\/rateloop-workspace@rateloop\) Use \$rateloop-workspace-connection/,
  );
  assert.match(message, /connect this agent to my workspace and finish automatically in this task/);
  assert.match(message, /Treat this as a new connection if a previous RateLoop workspace was deleted/);
  assert.match(message, /Preserve this link privately/);
  assert.match(message, /Only interrupt me for a host-presented install, trust, or OAuth action/);
  assert.match(message, /first missing RateLoop workspace-tool check as activation pending/);
  assert.match(message, /do not ask me to uninstall then/);
  assert.match(message, /do not tell me to start a new task or paste the link/);
  assert.match(message, /host's Continue action when offered/);
  assert.match(message, /check for RateLoop workspace tools on the next active turn/);
  assert.match(message, /still missing on a later active turn and the host offers no action/);
  assert.match(message, /tell me once to uninstall all existing RateLoop plugins/);
  assert.match(message, /never tell me to reinstall a plugin/);
  assert.match(message, /repeat that recovery, paste the link, or approve the same action again/);
  assert.match(message, /Report success only after RateLoop verifies the connection/);
  assert.equal(message.match(/\$rateloop-workspace-connection/g)?.length, 1);
  assert.equal(message.match(/https:\/\//g)?.length, 1);
  assert.match(message, new RegExp(connectionUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(message, /Authorization header|Bearer|rlk_|access token|refresh token|environment variable/i);
  assert.doesNotMatch(message, /poll|heartbeat|refresh|reload|restart|settings|gear|toggle/i);
});

test("universal message is byte-identical to the pre-refactor string", () => {
  assert.equal(buildAgentConnectionMessage({ connectionUrl: CONNECTION_URL }), PRE_REFACTOR_UNIVERSAL_MESSAGE);
});

test("each host renders its registry variant snapshot", () => {
  const byVariant: Record<string, string[]> = {
    plugin: ["codex-desktop", "claude-code"],
    "generic-mcp": ["vscode-copilot-chat", "cursor", "gemini-cli", "generic-mcp"],
    "settings-only": ["claude-desktop", "chatgpt-connectors"],
    headless: ["headless-sdk"],
  };
  assert.deepEqual(Object.values(byVariant).flat().sort(), TOKENLESS_HOST_CAPABILITIES.map(host => host.id).sort());

  for (const [variant, hostIds] of Object.entries(byVariant)) {
    for (const hostId of hostIds) {
      assert.equal(
        buildAgentConnectionMessageForHost({ connectionUrl: CONNECTION_URL, hostId }),
        EXPECTED_VARIANT_MESSAGES[variant as keyof typeof EXPECTED_VARIANT_MESSAGES],
        `${hostId} must render the ${variant} snapshot`,
      );
    }
  }
});

test("an unknown host id falls back to the universal message", () => {
  assert.equal(
    buildAgentConnectionMessageForHost({ connectionUrl: CONNECTION_URL, hostId: "unknown-host" }),
    PRE_REFACTOR_UNIVERSAL_MESSAGE,
  );
});

test("the core block and closing are byte-identical across all variants", () => {
  for (const [id, message] of allVariantMessages()) {
    assert.equal(message.split(CORE_BLOCK).length, 2, `${id} must contain the core block exactly once`);
    assert.ok(message.endsWith(CORE_CLOSING), `${id} must end with the verification closing and the URL`);
    assert.equal(message.match(/\$rateloop-workspace-connection/g)?.length, 1, `${id} skill invocation`);
  }
});

test("no variant contains credential material beyond the connection URL", () => {
  for (const [id, message] of allVariantMessages()) {
    assert.equal(message.split(CONNECTION_URL).length, 2, `${id} must contain the connection URL exactly once`);
    const withoutUrl = message.split(CONNECTION_URL).join("");
    assert.doesNotMatch(
      withoutUrl,
      /Authorization header|Bearer|rlk_|access token|refresh token|environment variable|api key|client secret/i,
      `${id} must not mention credential material`,
    );
    assert.ok(!withoutUrl.includes("https://"), `${id} must carry no URL besides the connection URL`);
    assert.ok(!withoutUrl.includes("aci_"), `${id} must not leak intent identifiers outside the URL`);
    assert.ok(!withoutUrl.includes("#claim"), `${id} must not leak claim fragments outside the URL`);
  }
});
