import { buildAgentConnectionMessage } from "./agentConnectionMessage";
import assert from "node:assert/strict";
import test from "node:test";

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
