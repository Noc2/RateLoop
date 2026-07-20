import { DocsTitle } from "~~/components/docs/DocsTitle";

const remoteMcpUrl = "https://rateloop-tokenless.vercel.app/api/mcp";
const workspaceMcpUrl = "https://rateloop-tokenless.vercel.app/api/agent/v1/mcp";

const toolsListRequest = `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`;

const capabilitiesRequest = `{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "rateloop_capabilities",
    "arguments": {}
  }
}`;

const createHandoffRequest = `{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "rateloop_create_handoff",
    "arguments": {
      "dataClassification": "synthetic",
      "redactionSummary": "Synthetic release-readiness prompt; no customer or production data.",
      "confirmedNoSensitiveData": true,
      "request": {
        "audience": {
          "source": "customer_invited",
          "admissionPolicyHash": "0x8681aba447f1c2d918b038b1109b4f4112877b0acaa3f132da97e98a3d8cf09c"
        },
        "audiencePolicy": {
          "schemaVersion": "rateloop.human-assurance.v2",
          "policyId": "aud_public_release_customer_invited_v1",
          "version": 1,
          "reviewerSource": "customer_invited",
          "compensation": "paid",
          "cohorts": [
            { "cohortId": "customer_named", "minimumReviewers": 3, "maximumReviewers": 500 }
          ],
          "selection": "customer_named",
          "fallbacks": { "allowed": false, "sources": [] },
          "requiredQualifications": [],
          "assurance": {
            "requirements": [
              {
                "capability": "account_control",
                "reviewerSources": ["customer_invited"],
                "allowedProviders": []
              }
            ]
          },
          "buyerPrivacy": {
            "visibleFields": [],
            "minimumAggregationSize": 3,
            "suppressSmallCells": true
          },
          "legalEligibilityRequired": true
        },
        "budget": {
          "attemptReserveAtomic": "500000",
          "bountyAtomic": "5000000",
          "feeBps": 500
        },
        "question": {
          "kind": "binary",
          "prompt": "Is this release candidate ready for rollout?",
          "rationale": { "mode": "optional" }
        },
        "requestedPanelSize": 3
      }
    }
  }
}`;

const statusRequest = `{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "rateloop_get_handoff_status",
    "arguments": {
      "handoffId": "<returned handoffId>",
      "handoffToken": "<returned handoffToken>"
    }
  }
}`;

const tools = [
  ["rateloop_capabilities", "Read the current environment, safety boundary, and handoff contract."],
  ["rateloop_create_handoff", "Create an approval-bound browser handoff from an agreed request."],
  ["rateloop_get_handoff_status", "Check the handoff state with the returned ID and secret token."],
  ["rateloop_get_result", "Retrieve the structured result with the same ID and token."],
] as const;

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-base-content/10 bg-base-300/50 p-4 text-xs leading-6">
      <code>{children}</code>
    </pre>
  );
}

export default function TokenlessAgentDocsPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="MCP">Agents &amp;</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        RateLoop supports both draft-first browser handoffs and delegated autonomous runs. The public MCP remains
        approval-bound; an authenticated workspace key can publish without a per-run click only when an owner-issued
        policy fixes its budget, payment mode, wallet, audience, project, data, expiry, and revocation rules.
      </p>

      <h2 id="choose-a-publishing-lane">Choose a publishing lane</h2>
      <ul>
        <li>
          <strong>Browser handoff:</strong> the agent drafts public, synthetic, or safely redacted material and a person
          reviews, quotes, and submits it.
        </li>
        <li>
          <strong>Delegated prepaid:</strong> a policy-bound workspace key spends only the prepaid balance and stays
          inside the caps its owner approved.
        </li>
        <li>
          <strong>Delegated self-funded:</strong> the tokenless CLI signs short-lived x402/EIP-3009 authorizations from
          an encrypted agent wallet; RateLoop&apos;s relayer supplies gas but never receives the key.
        </li>
      </ul>
      <p>
        Autonomous publishing is not an unscoped public MCP permission. Requests outside policy fail closed or return a
        browser-handoff continuation, according to the policy. A result is decision support and does not silently
        authorize a release or regulated action.
      </p>
      <p>
        Workspace API keys are scoped, revocable server credentials. The server derives their workspace and authorized
        client/project boundary; neither a caller-supplied tenant ID nor a wallet address grants access. Prepaid agents
        need no wallet, while a self-funded wallet is limited to its policy-bound payment path.
      </p>

      <h2>The connected workspace assurance loop</h2>
      <p>
        The workspace MCP at <code>{workspaceMcpUrl}</code> binds one approved agent version to one owner-approved
        review policy. A safe connection can read that context and evaluate review requirements, but it cannot spend,
        publish, read private artifacts, or administer the workspace. Requesting a paid review requires a separate
        owner-approved publishing step-up with explicit limits.
      </p>
      <ol>
        <li>
          Call <code>rateloop_get_agent_context</code> after connection. Use the returned immutable agent version,
          policy, audience hash, and allowed workflows; caller-supplied identity is not trusted.
        </li>
        <li>
          Before each eligible output, call <code>rateloop_evaluate_review_requirement</code> with its workflow, risk,
          declared confidence, completeness, suggestion commitment, and source-evidence reference.
        </li>
        <li>
          If the decision says skip, continue and keep the recorded evidence scope. If review is required and publishing
          authority is active, call <code>rateloop_request_review</code>, then <code>rateloop_wait_for_review</code> and
          <code>rateloop_get_review_result</code> before the host releases the output.
        </li>
        <li>
          Call <code>rateloop_get_assurance_state</code> to read the current scoped coverage, human agreement,
          conservative lower bound, checked/skipped counts, and next reassessment. The same source-derived evidence
          appears in the workspace Agents tab.
        </li>
      </ol>
      <p>
        Generic MCP is advisory: RateLoop records when review is required, but cannot prove that every host blocks its
        output. Use a host-enforced integration when blocking is mandatory.
      </p>

      <h2>Connect with Codex</h2>
      <p>
        Codex is the primary setup path. Pin the Git marketplace to the isolated tokenless branch, then install the
        public RateLoop plugin:
      </p>
      <CodeBlock>{`codex plugin marketplace add Noc2/RateLoop@tokenless --sparse .agents/plugins --sparse plugins/rateloop --sparse plugins/rateloop-workspace
codex plugin add rateloop@rateloop`}</CodeBlock>
      <p>
        A copied workspace connection message targets <code>rateloop-workspace@rateloop</code> directly, so Codex can
        install the protected workspace plugin and complete OAuth during installation, before the connection task
        starts. Existing or revoked installs may still need <strong>Continue</strong> when Codex offers it.
      </p>
      <h4>Authentication finished, but still waiting?</h4>
      <p>
        Codex&apos;s <strong>Authentication complete</strong> page confirms the OAuth callback, not RateLoop
        verification. Return to the same task and use <strong>Continue</strong> if it appears; a fresh install should
        not require a typed follow-up. Treat the first missing-tool check as activation pending. If the protected tools
        are still missing on a later active turn and Codex offers no native action, uninstall all existing RateLoop
        plugins before resuming that task with the original message. Do not remove unrelated plugins or create a
        replacement connection link.
      </p>

      <details className="not-prose mt-8 rounded-xl border border-base-content/10 bg-base-200/40 p-4">
        <summary className="cursor-pointer font-semibold text-base-content">
          Other MCP clients and support levels
        </summary>
        <div className="mt-4 space-y-3 text-sm leading-6 text-base-content/70">
          <p>
            MCP compatibility belongs to the host and agent loop, not the model brand. A model must support tool use,
            while its host must also implement remote Streamable HTTP, the required OAuth flow, tool results, and the
            session lifecycle.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-base-content">Protocol-compatible:</strong> Codex desktop is the primary path;
              Claude Code, local GitHub Copilot Chat in VS Code, and Gemini CLI document the needed transport and OAuth
              capabilities. RateLoop still requires installed-host release smoke tests before calling a named version
              verified.
            </li>
            <li>
              <strong className="text-base-content">Application-managed:</strong> hosted OpenAI or Anthropic MCP
              connectors and SDK integrations require the embedding application to obtain, refresh, and supply
              authorization.
            </li>
            <li>
              <strong className="text-base-content">Public MCP only:</strong> GitHub Copilot cloud agent and code review
              do not currently support remote OAuth MCP servers, so they cannot use the protected workspace endpoint.
            </li>
          </ul>
          <p>
            Use the <a href="/docs/agent-connection.md">host-specific setup and full support matrix</a>. It keeps other
            clients separate from the Codex path and does not guess client IDs, redirect URIs, or install links.
          </p>
        </div>
      </details>

      <h2>Four-purpose tool surface</h2>
      <p>
        The public browser-handoff server at <code>{remoteMcpUrl}</code> intentionally exposes only four RateLoop tools:
      </p>
      <div className="not-prose grid gap-3 sm:grid-cols-2">
        {tools.map(([name, description]) => (
          <div key={name} className="rateloop-surface-card rounded-xl p-4">
            <code className="break-words text-sm font-semibold text-base-content">{name}</code>
            <p className="mt-2 text-sm leading-6 text-base-content/65">{description}</p>
          </div>
        ))}
      </div>
      <h2>Image and YouTube context</h2>
      <p>
        YouTube context is canonicalized to one video ID and can travel in an ordinary public draft. Image bytes never
        belong in MCP arguments or a handoff URL. A browser author uploads images in the public Ask form; an
        authenticated delegated agent stages a local file with the SDK or CLI and places the returned opaque asset ID,
        normalized digest, and meaningful alternative text in <code>question.media.items</code> before quoting.
      </p>
      <CodeBlock>{`export RATELOOP_AGENT_API_KEY=rlk_...
yarn workspace @rateloop/agents media-upload \\
  --file ./candidate.png \\
  --client-request-id release-candidate-01`}</CodeBlock>
      <p>
        Staging accepts JPG, PNG, and WEBP files up to 10 MB. For a browser handoff, copy each descriptor&apos;s exact
        asset ID, digest, and short-lived preview capability into the tool&apos;s top-level <code>mediaPreviews</code>.
        The bearer grant stays in the handoff fragment, works only for a signed-in active workspace member, expires with
        staging, and is consumed only while atomically binding the accepted ask. Do not log or persist it.
      </p>

      <h2 id="approval-and-privacy-boundary">Approval and privacy boundary</h2>
      <ol>
        <li>Draft the question and request locally.</li>
        <li>
          Show the user the exact prompt, context, URLs, artifact descriptions, data classification, and redaction
          summary that would leave the workspace.
        </li>
        <li>Wait for explicit approval before calling the handoff tool.</li>
        <li>
          Open the returned handoff URL. The user reviews or edits the request, accepts the quote, and submits in the
          browser. Creating a handoff is not submission.
        </li>
        <li>Poll status and retrieve the result with the returned handoff ID and secret handoff token.</li>
      </ol>
      <p>
        The approval sequence above applies to the public MCP handoff. A delegated API/CLI run may skip the per-run
        browser click only after the workspace owner has issued its policy-bound credential and the request stays within
        that policy.
      </p>
      <p>
        Use only <code>public</code>, <code>synthetic</code>, or safely <code>redacted</code> non-sensitive material.
        Never include secrets, credentials, private source code, customer records, regulated personal data, or
        safety-critical content. Keep the handoff token secret; it grants access to that handoff&apos;s status and
        result.
      </p>

      <h2>JSON-RPC tool flow</h2>
      <p>Discover the live schemas first:</p>
      <CodeBlock>{toolsListRequest}</CodeBlock>
      <p>Then read capabilities without sending review content:</p>
      <CodeBlock>{capabilitiesRequest}</CodeBlock>
      <p>After the user approves the exact outbound content, create a browser handoff:</p>
      <CodeBlock>{createHandoffRequest}</CodeBlock>
      <p>
        The response supplies the browser handoff URL, <code>handoffId</code>, and <code>handoffToken</code>. After the
        browser step, check status:
      </p>
      <CodeBlock>{statusRequest}</CodeBlock>
      <p>
        Call <code>rateloop_get_result</code> with the same <code>handoffId</code> and <code>handoffToken</code> only
        when status says a result is available.
      </p>

      <h2>Decision boundary</h2>
      <p>
        RateLoop supplies human-review evidence and disclosed limitations; it does not issue an automatic production,
        safety, legal, or compliance approval. Use only authorized, minimized material and keep an accountable person
        responsible for every rollout decision.
      </p>
    </article>
  );
}
