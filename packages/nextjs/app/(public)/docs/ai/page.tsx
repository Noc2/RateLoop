const remoteMcpUrl = "https://rateloop-tokenless.vercel.app/api/mcp";

const mcpConfiguration = `{
  "mcpServers": {
    "rateloop": {
      "type": "http",
      "url": "${remoteMcpUrl}"
    }
  }
}`;

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
          "source": "sandbox",
          "admissionPolicyHash": "0x0000000000000000000000000000000000000000000000000000000000000000"
        },
        "budget": {
          "attemptReserveAtomic": "500000",
          "bountyAtomic": "5000000",
          "feeBps": 500
        },
        "question": {
          "kind": "binary",
          "prompt": "Is this synthetic release candidate ready for the next test stage?",
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
      <h1>Agents and MCP</h1>
      <p className="lead">
        RateLoop gives an agent a narrow, draft-first path to outside human judgment. The integration prepares a
        request, a person approves exactly what may leave the workspace, and the browser remains the quote-and-submit
        gate. It does not give an agent permission to publish a panel by itself.
      </p>

      <h2>Supported agent clients</h2>
      <p>
        The same remote MCP surface can be used from Claude Code, OpenAI Codex, Cursor, GitHub Copilot, Gemini CLI, and
        OpenClaw when the client supports a remote HTTP MCP server. Client configuration syntax may differ; use the
        client&apos;s current remote-MCP instructions.
      </p>

      <h2>Connect to the remote MCP server</h2>
      <p>
        Register <code>{remoteMcpUrl}</code> as a remote HTTP MCP server. A common configuration shape is:
      </p>
      <CodeBlock>{mcpConfiguration}</CodeBlock>
      <p>
        Call <code>tools/list</code> after connecting. Its returned schemas are canonical and should take precedence
        over copied examples.
      </p>

      <h3>Install the Codex plugin from this repository</h3>
      <p>From the RateLoop repository root, add the local marketplace and install the included plugin:</p>
      <CodeBlock>{`codex plugin marketplace add .
codex plugin add rateloop@rateloop`}</CodeBlock>
      <p>Start a new Codex task after installation so the plugin and its safety instructions are loaded.</p>

      <h2>Four-purpose tool surface</h2>
      <p>The public integration intentionally exposes only four RateLoop tools:</p>
      <div className="not-prose grid gap-3 sm:grid-cols-2">
        {tools.map(([name, description]) => (
          <div key={name} className="rateloop-surface-card rounded-xl p-4">
            <code className="break-words text-sm font-semibold text-base-content">{name}</code>
            <p className="mt-2 text-sm leading-6 text-base-content/65">{description}</p>
          </div>
        ))}
      </div>
      <p>
        Legacy wallet-transaction, LREP, governance, protocol-token, and token-era rating tools are not restored on this
        endpoint.
      </p>

      <h2>Approval and privacy boundary</h2>
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
      <p>After the user approves the exact outbound content, create a sandbox handoff:</p>
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

      <h2>Sandbox boundary</h2>
      <p>
        The public sandbox simulates reviewer activity, results, and payments. It does not provide live human reviews,
        paid human evidence, or a production approval. Use synthetic or safely redacted test material and keep an
        accountable person responsible for every rollout decision.
      </p>
    </article>
  );
}
