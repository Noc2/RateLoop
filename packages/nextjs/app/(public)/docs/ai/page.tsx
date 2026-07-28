import Link from "next/link";
import type { Metadata } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { Card } from "~~/components/tokenless/ui/Card";

export const metadata: Metadata = { title: "Agent integration guide" };

const remoteMcpUrl = "https://rateloop-tokenless.vercel.app/api/mcp";
const workspaceMcpUrl = "https://rateloop-tokenless.vercel.app/api/agent/v1/mcp";

const tools = [
  ["rateloop_capabilities", "Read the current environment and browser-handoff safety boundary."],
  ["rateloop_create_handoff", "Prepare an approval-bound browser handoff from an agreed draft."],
  ["rateloop_get_handoff_status", "Check the handoff state with its ID and secret token."],
  ["rateloop_get_result", "Retrieve the structured result when the handoff is complete."],
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
        Connect an agent to one workspace review policy. The current hosted path requests private, unpaid review from
        invited workspace reviewers.
      </p>

      <div className="not-prose my-8 rounded-xl border border-[var(--rateloop-blue)]/25 bg-[var(--rateloop-blue)]/5 p-5">
        <h2 className="text-lg font-semibold text-base-content">Available now</h2>
        <p className="mt-2 text-sm leading-6 text-base-content/70">
          Use the protected workspace MCP to evaluate eligible outputs, request review when required, wait for the same
          operation, and read its result.
        </p>
        <Link href="/agents/connections" className="btn btn-sm rateloop-secondary-action mt-4 px-3 no-underline">
          Connect an agent
        </Link>
      </div>

      <h2 id="workspace-review-flow">Connected workspace review</h2>
      <p>
        The workspace MCP at <code>{workspaceMcpUrl}</code> binds an approved agent version to its owner-approved review
        policy. A safe connection can read that context and evaluate review requirements, but it cannot spend, publish,
        read private artifacts, or administer the workspace.
      </p>
      <ol>
        <li>
          Call <code>rateloop_get_agent_context</code>, then <code>rateloop_verify_connection</code>.
        </li>
        <li>
          Before each eligible output, call <code>rateloop_evaluate_review_requirement</code> with privacy-safe
          execution metadata.
        </li>
        <li>
          If review is required, call <code>rateloop_request_review</code>, then <code>rateloop_wait_for_review</code>{" "}
          and <code>rateloop_get_review_result</code> before the host releases the output.
        </li>
        <li>
          Call <code>rateloop_get_assurance_state</code> when you need current coverage and agreement evidence.
        </li>
      </ol>
      <p>
        Generic MCP is advisory: RateLoop records when review is required, but cannot prove that every host blocks its
        output. Use a verified host-enforced integration when blocking is mandatory.
      </p>

      <h2>Connect with Codex</h2>
      <p>
        Open <Link href="/agents/connections">Connection</Link> and copy the workspace connection message. If the public
        plugin is not installed yet, pin the marketplace to the isolated tokenless branch and add it first:
      </p>
      <CodeBlock>{`codex plugin marketplace add Noc2/RateLoop@tokenless --sparse .agents/plugins --sparse plugins/rateloop --sparse plugins/rateloop-workspace
codex plugin add rateloop@rateloop`}</CodeBlock>
      <p>
        The copied message targets <code>rateloop-workspace@rateloop</code>. It lets Codex install the protected
        workspace plugin and complete OAuth before the connection task begins.
      </p>

      <h3>Authentication finished, but the task is still waiting?</h3>
      <p>
        Codex&apos;s <strong>Authentication complete</strong> page confirms the OAuth callback, not RateLoop
        verification. Return to the same task and use <strong>Continue</strong> if Codex offers it. Treat the first
        missing-tool check as activation pending. If the protected tools are still missing on a later active turn and no
        native action is available, uninstall all existing RateLoop plugins before resuming the same task. Do not remove
        unrelated plugins or create a replacement connection link.
      </p>

      <details className="not-prose mt-8 rounded-xl border border-base-content/10 bg-base-200/40 p-4">
        <summary className="cursor-pointer font-semibold text-base-content">
          Other MCP clients and support levels
        </summary>
        <div className="mt-4 space-y-3 text-sm leading-6 text-base-content/70">
          <p>
            MCP compatibility belongs to the host and agent loop, not the model brand. The model needs tool use, and the
            host must implement remote Streamable HTTP, OAuth, tool results, and the session lifecycle.
          </p>
          <p>
            Codex desktop is the primary verified path. Other clients require their own installed-host release smoke
            test before a named version can be called verified.
          </p>
          <p>
            Use the <a href="/docs/agent-connection.md">host-specific setup and support matrix</a> for the current
            transport and authentication expectations.
          </p>
        </div>
      </details>

      <h2 id="public-browser-handoff">Public browser handoff</h2>
      <p>
        The public MCP at <code>{remoteMcpUrl}</code> prepares a draft for a browser decision. Creating a handoff is not
        submission, and it does not activate an unavailable reviewer network or paid lane.
      </p>
      <div className="not-prose grid gap-3 sm:grid-cols-2">
        {tools.map(([name, description]) => (
          <Card as="div" variant="marketing" key={name} className="rounded-xl p-4">
            <code className="break-words text-sm font-semibold text-base-content">{name}</code>
            <p className="mt-2 text-sm leading-6 text-base-content/65">{description}</p>
          </Card>
        ))}
      </div>
      <p>
        Use only public, synthetic, or safely redacted non-sensitive material. Before creating the handoff, show the
        user the exact prompt, context, URLs, artifact descriptions, data classification, and redaction summary that
        would leave the workspace. Wait for explicit approval, then keep the returned handoff token secret.
      </p>

      <h2>Images and external context</h2>
      <p>
        Image bytes do not belong in MCP arguments or a handoff URL. Upload JPG, PNG, or WEBP files through the
        supported browser or file-backed agent flow, and include meaningful alternative text. Do not log or persist
        preview capabilities.
      </p>

      <h2>Decision boundary</h2>
      <p>
        RateLoop supplies human-review evidence and disclosed limitations; it does not issue an automatic production,
        safety, legal, medical, or compliance approval. Use only authorized, minimized material and keep an accountable
        person responsible for every rollout decision.
      </p>
    </article>
  );
}
