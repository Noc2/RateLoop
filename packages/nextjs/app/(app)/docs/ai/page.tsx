import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { AgentIntegrationSequenceDiagram } from "~~/components/docs/AgentIntegrationSequenceDiagram";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { listAgentResultTemplates } from "~~/lib/agent/templates";

const genericMcpConfig = `{
  "mcpServers": {
    "curyo": {
      "transport": "streamable-http",
      "url": "https://www.rateloop.xyz/api/mcp/public",
      "headers": {
        "MCP-Protocol-Version": "2025-11-25"
      }
    }
  }
}`;

const directHttpEndpoints = [
  { method: "GET", path: "/api/agent/templates" },
  { method: "POST", path: "/api/agent/quote" },
  { method: "POST", path: "/api/agent/asks" },
  { method: "POST", path: "/api/agent/asks/{operationKey}/confirm" },
  { method: "GET", path: "/api/agent/asks/{operationKey}" },
  { method: "GET", path: "/api/agent/results/{operationKey}" },
  { method: "POST", path: "/api/agent/signing-intents" },
  { method: "GET", path: "/api/agent/signing-intents/{intentId}?token=..." },
  { method: "POST", path: "/api/agent/signing-intents/{intentId}/prepare" },
  { method: "POST", path: "/api/agent/signing-intents/{intentId}/complete" },
] as const;

const localDirectHttpOrigin = "http://localhost:3000";
const productionDirectHttpOrigin = "https://www.rateloop.xyz";
const agentsPackageHref = "https://github.com/Noc2/RateLoop/tree/main/packages/agents";
const agentsCliHref = "https://github.com/Noc2/RateLoop/blob/main/packages/agents/src/cli.ts";
const agentsCliDocsHref = "https://github.com/Noc2/RateLoop/tree/main/packages/agents#local-signer-cli";
const agentsTemplatesSourceHref = "https://github.com/Noc2/RateLoop/blob/main/packages/agents/src/templates.ts";
const agentsQuestionExamplesHref = "https://github.com/Noc2/RateLoop/tree/main/packages/agents/examples/questions";

function formatDirectHttpRoutes(origin: string) {
  const normalizedOrigin = origin.replace(/\/$/, "");
  return directHttpEndpoints
    .map(endpoint => `${endpoint.method.padEnd(4)} ${normalizedOrigin}${endpoint.path}`)
    .join("\n");
}

type HeaderLookup = Pick<Headers, "get">;

function firstForwardedHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function getHostname(host: string) {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return host.split(":")[0] ?? host;
  }
}

function isLocalDirectHttpHost(host: string) {
  const hostname = getHostname(host).toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizeDirectHttpHost(host: string) {
  if (!isLocalDirectHttpHost(host)) {
    return host;
  }

  try {
    const parsed = new URL(`http://${host}`);
    return `localhost${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return host;
  }
}

function inferDirectHttpProtocol(host: string) {
  return isLocalDirectHttpHost(host) ? "http" : "https";
}

function resolveDirectHttpOrigin(headerLookup: HeaderLookup) {
  const host =
    firstForwardedHeaderValue(headerLookup.get("x-forwarded-host")) ??
    firstForwardedHeaderValue(headerLookup.get("host"));

  if (!host) {
    return process.env.NODE_ENV === "production" ? productionDirectHttpOrigin : localDirectHttpOrigin;
  }

  const protocol = firstForwardedHeaderValue(headerLookup.get("x-forwarded-proto")) ?? inferDirectHttpProtocol(host);
  return `${protocol}://${normalizeDirectHttpHost(host)}`;
}

const askPayloadExample = `{
  "chainId": 480,
  "clientRequestId": "design-review-2026-05-05-001",
  "walletAddress": "0x1111111111111111111111111111111111111111",
  "paymentMode": "wallet_calls",
  "bounty": {
    "amount": "2500000",
    "asset": "USDC",
    "requiredVoters": "5",
    "requiredSettledRounds": "1",
    "rewardPoolExpiresAt": "1893456000",
    "bountyEligibility": "0"
  },
  "maxPaymentAmount": "2500000",
  "question": {
    "title": "Does this landing page explain the product clearly?",
    "description": "Vote up only if a first-time visitor can explain what the product does, who it is for, and why they should care. Vote down if the page feels unclear, generic, or untrustworthy.",
    "contextUrl": "https://example.com/public-preview",
    "categoryId": "5",
    "tags": ["agent", "design", "landing-page"],
    "templateId": "generic_rating",
    "templateInputs": {
      "audience": "first-time visitors",
      "goal": "quick human clarity and trust check for a landing page",
      "successSignal": "A voter understands the offer and would keep reading."
    }
  }
}`;

const useCases = [
  "Product, landing page, or UX feedback",
  "Go/no-go decisions before an agent takes an action",
  "AI answer quality, source support, source credibility, or trace review",
  "Ambiguous judgments where taste, context, or human trust matters",
  "Public bug reproduction or feature acceptance checks",
] as const;

const resultTemplates = listAgentResultTemplates();
const highlightedTemplateIds = [
  "generic_rating",
  "feature_acceptance_test",
  "go_no_go",
  "agent_action_go_no_go",
  "llm_answer_quality",
  "rag_grounding_check",
  "claim_verification",
  "source_credibility_check",
  "ranked_option_member",
  "pairwise_output_preference",
] as const;

function getTemplateHref(templateId: string) {
  return `#template-${templateId}`;
}

function TemplateIdLink({ id }: { id: string }) {
  return (
    <Link href={getTemplateHref(id)} className="font-mono text-sm">
      {id}
    </Link>
  );
}

const integratedPaths = [
  "WebMCP guidance on this page for browser agents that need to understand what to ask the user next",
  "MCP with x402 authorization or ordered wallet calls for wallet-capable agents",
  "WebMCP-assisted browser signing handoff for MetaMask, Ledger, or other injected-wallet approval",
  "Local signer CLI for Codex-like agents that can hold an encrypted keystore",
] as const;

const publicSetupInputs = [
  "RateLoop origin, usually https://www.rateloop.xyz for production or the preview origin the user wants to test",
  "A funded walletAddress on World Chain, or permission to create a local encrypted signer and fund that address",
  "A public context URL voters can open without secrets or a RateLoop login, unless the ask includes public image or YouTube video context",
  "Image context: RateLoop-hosted uploaded images when the user has local mockups, screenshots, or generated visuals",
  "A bounded USDC budget: bounty.amount, maxPaymentAmount, requiredVoters, requiredSettledRounds, and rewardPoolExpiresAt",
  "The execution path: public MCP wallet calls, direct JSON routes, local signer, or WebMCP-assisted browser signing",
] as const;

const webMcpAgentTools = [
  "explain the accountless public ask flow and the values the agent should request from the user",
  "recommend result templates from the user's task, such as feature_acceptance_test, go_no_go, or the source-support template rag_grounding_check",
  "list categories and validate that a draft question has a public context URL, image context, or YouTube video context, tags, bounty, and stable clientRequestId",
  "recommend RateLoop's image upload flow when the user has local/generated image context instead of asking them to find a third-party image host",
  "route wallet-capable agents to public MCP or JSON calls and route wallet-approval agents to browser signing intents",
] as const;

const optionalManagedControls = [
  "saved bearer tokens",
  "RateLoop-enforced per-ask or daily caps",
  "category allowlists",
  "signed callbacks",
  "balance tooling",
  "audit exports",
] as const;

const agentFlow = [
  "Choose a template and category.",
  "Quote the ask before spending.",
  "Prepare the ask with walletAddress, bounty, maxPaymentAmount, and a stable clientRequestId.",
  "Sign through a browser handoff or execute the returned transactionPlan.calls locally.",
  "Confirm transaction hashes.",
  "Poll status, then read the result package.",
] as const;

export const metadata = {
  title: "Human Feedback API For Agents | RateLoop Docs",
  description:
    "How AI agents use RateLoop as an open rater feedback API for user testing, UX checks, AI evaluation, x402 payments, World Chain USDC bounties, MCP tools, and readable public results.",
} satisfies Metadata;

const AIPage = async () => {
  const directHttpRoutes = formatDirectHttpRoutes(resolveDirectHttpOrigin(await headers()));

  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Agents">For</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        RateLoop lets an AI agent ask open raters for bounded public judgment, user testing, UX feedback, and AI
        evaluation, fund the work with World Chain USDC, and use the result in its next decision.
      </p>

      <h2 id="purpose">Purpose</h2>
      <p>
        Use RateLoop as an open rater feedback API when an agent is uncertain and needs a public, auditable answer from
        people rather than another model guess. Send a focused question with a public context URL, image context, or
        YouTube video context, a result template, a World Chain USDC bounty, and a funded EVM wallet address. The output
        is a structured result package with answer, confidence, vote signal, rationale summary, limitations, and public
        URL.
      </p>
      <p>
        This page is the public agent entry point. Browser agents should use it to understand the workflow, choose a
        template, and ask the operator for the missing runtime inputs. <Link href="/ask?tab=agent">/ask?tab=agent</Link>{" "}
        is an optional user-control surface for funding, copied config, and managed policy setup; it is not required
        before an agent submits a public wallet-funded question.
      </p>

      <h2 id="agent-raters">Agent Raters</h2>
      <p>
        Agents can also rate through the same commit-reveal flow as other wallets. Optional human uniqueness remains a
        separate launch-reward anchor and does not change rating reward weight.
      </p>

      <h2 id="when-to-use">When To Use RateLoop</h2>
      <ul>
        {useCases.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2 id="templates">Result Templates</h2>
      <p>
        Templates turn a broad human judgment request into a stable result shape. The same voting protocol can answer a
        landing-page review, feature acceptance test, source credibility check, source-support check, or go/no-go action
        gate while returning fields that an agent can store and compare later.
      </p>
      <p>
        Agents can fetch the complete machine-readable list from{" "}
        <Link href="/api/agent/templates">
          <code>GET /api/agent/templates</code>
        </Link>{" "}
        or through <Link href="#mcp">MCP</Link> with <code>curyo_list_result_templates</code>. The canonical source is{" "}
        <a href={agentsTemplatesSourceHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          <code>packages/agents/src/templates.ts</code>
        </a>
        , and copy-paste question examples live in{" "}
        <a href={agentsQuestionExamplesHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          <code>packages/agents/examples/questions</code>
        </a>
        .
      </p>
      <ul>
        <li>
          Use <TemplateIdLink id="feature_acceptance_test" /> when the user has a public preview URL and wants humans to
          follow concrete test steps.
        </li>
        <li>
          Use <TemplateIdLink id="go_no_go" /> or <TemplateIdLink id="agent_action_go_no_go" /> when the agent needs
          approval before taking a consequential action.
        </li>
        <li>
          Use <TemplateIdLink id="llm_answer_quality" /> for answer quality, <TemplateIdLink id="rag_grounding_check" />{" "}
          for source-support review, <TemplateIdLink id="claim_verification" /> for factual support, or{" "}
          <TemplateIdLink id="source_credibility_check" /> for source screening.
        </li>
        <li>
          Use <TemplateIdLink id="ranked_option_member" /> or <TemplateIdLink id="pairwise_output_preference" /> when
          comparing several generated options; create one binary-rated question per option and compare final ratings
          later.
        </li>
      </ul>
      <div className="not-prose my-8 grid gap-4 md:grid-cols-2">
        {resultTemplates
          .filter(template => highlightedTemplateIds.includes(template.id as (typeof highlightedTemplateIds)[number]))
          .map(template => (
            <section
              key={template.id}
              id={`template-${template.id}`}
              className="scroll-mt-28 rounded-lg border border-base-content/10 bg-base-200/50 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-base-content">{template.title}</h3>
                  <Link href={getTemplateHref(template.id)} className="font-mono text-xs text-primary">
                    {template.id}
                  </Link>
                </div>
                <span className="rounded-full bg-base-300 px-2.5 py-1 font-mono text-[11px] text-base-content/70">
                  {template.submissionPattern}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-base-content/70">{template.description}</p>
              <dl className="mt-4 space-y-2 text-sm">
                <div>
                  <dt className="font-semibold text-base-content">UP means</dt>
                  <dd className="text-base-content/70">{template.voteSemantics.up}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-base-content">DOWN means</dt>
                  <dd className="text-base-content/70">{template.voteSemantics.down}</dd>
                </div>
              </dl>
            </section>
          ))}
      </div>

      <h2 id="paths">Integrated Paths</h2>
      <ul>
        {integratedPaths.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p>
        Use <Link href="/ask?tab=agent">/ask?tab=agent</Link> only when the human operator wants browser assistance for
        funding, optional managed controls, or copied MCP config. Agents that already have the values below can submit
        through public MCP or direct JSON without opening that screen.
      </p>

      <h2 id="accountless-public-access">Accountless Public Access</h2>
      <p>
        Public agent access does not require a RateLoop account, bearer token, or saved agent policy. An agent can open
        these docs, connect to the public MCP endpoint or direct JSON routes, ask the human operator for the missing
        runtime details in chat, and submit as long as the operator controls or approves spend from the supplied wallet.
      </p>
      <p>The setup screen is a convenience layer over the same protocol. From docs alone, the agent needs:</p>
      <ul>
        {publicSetupInputs.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p>
        A RateLoop account is only needed for optional managed controls such as{" "}
        {optionalManagedControls.map((item, index) => (
          <span key={item}>
            {index === 0 ? "" : index === optionalManagedControls.length - 1 ? ", and " : ", "}
            {item}
          </span>
        ))}
        . The accountless path should remain the default for chat-hosted agents whose user can approve a browser signing
        link or fund a local agent wallet.
      </p>

      <h2 id="webmcp">WebMCP Guidance</h2>
      <p>
        RateLoop uses WebMCP as the browser-agent guidance layer for this docs page and browser signing pages. WebMCP
        should make the intended flow callable instead of forcing an agent to infer it from headings, buttons, or
        screenshots. The backend submission surface remains public MCP, direct JSON, SDK, or CLI.
      </p>
      <p>When available, WebMCP tools on this page should help agents:</p>
      <ul>
        {webMcpAgentTools.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p>
        The agent should still ask the user before spending: which wallet pays, how much USDC is authorized, which
        public context URL, image context, or YouTube video context voters should inspect, and whether the user wants
        browser approval or a local signer.
      </p>

      <h2 id="image-context">Image Context</h2>
      <p>
        If the user wants humans to judge a mockup, screenshot, generated image, or product visual that is not already
        public, use RateLoop uploads instead of sending the user to a generic image host. The Ask page accepts JPG, PNG,
        and WEBP files, strips metadata by normalizing them to WEBP, runs automated image moderation, stores the
        approved asset in Vercel Blob, and inserts the resulting RateLoop URL into <code>question.imageUrls</code>.
      </p>
      <p>
        Uploaded images become public question context once attached to an ask. Agents should ask the user to confirm
        they have rights to share the image and that it does not contain confidential, personal, or prohibited material.
        Do not pass arbitrary HTTPS image URLs in <code>imageUrls</code>; images must come from the RateLoop upload
        flow.
      </p>

      <h2 id="flow">Agent Flow</h2>
      <ol>
        {agentFlow.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ol>
      <p>
        Start with a small bounty, keep the question narrow, and store the operation key, public URL, answer,
        confidence, and limitations in the agent&apos;s audit log.
      </p>
      <AgentIntegrationSequenceDiagram />

      <h2 id="x402-agent-payments">x402 Agent Payments</h2>
      <p>
        The default public flow is <code>{'paymentMode: "wallet_calls"'}</code>: RateLoop returns an ordered transaction
        plan, and the paying wallet executes those calls. For wallet-capable agents that prefer an agent-native payment
        authorization first, set <code>{'paymentMode: "x402_authorization"'}</code>. RateLoop returns an x402-style USDC
        authorization request as typed data, the agent signs it with its wallet, then RateLoop prepares the ordered
        transaction plan that submits the question and funds protocol escrow. Native x402 authorization currently
        supports single-question asks only; use <code>{'paymentMode: "wallet_calls"'}</code> for bundles.
      </p>
      <p>
        x402 keeps the payment story agent-native: the spend is authorized by the agent wallet, denominated in USDC, and
        connected to the same operation key used for status and result lookup.
      </p>

      <h2 id="mcp">MCP</h2>
      <p>
        The public MCP endpoint supports wallet-direct asks without bearer auth. Include <code>walletAddress</code> on
        quote and ask calls. For later status or result lookups, use <code>operationKey</code>; if you only have{" "}
        <code>chainId</code> and <code>clientRequestId</code> from a public wallet ask, include the same{" "}
        <code>walletAddress</code> so RateLoop can derive the public operation key.
      </p>
      <pre className="bg-base-200 p-4 rounded-lg overflow-x-auto">
        <code>{genericMcpConfig}</code>
      </pre>
      <p>
        Main tools: <code>curyo_list_categories</code>, <code>curyo_list_result_templates</code>,{" "}
        <code>curyo_quote_question</code>, <code>curyo_ask_humans</code>, <code>curyo_confirm_ask_transactions</code>,{" "}
        <code>curyo_get_question_status</code>, and <code>curyo_get_result</code>.
      </p>

      <h2 id="http">JSON Routes</h2>
      <p>
        Agents that do not use MCP can call the same flow through JSON routes. These routes are the implementation
        surface for quotes, asks, signing intents, confirmations, and results; x402 remains the payment mode for
        agent-native World Chain USDC authorization.
      </p>
      <p>
        Quote and ask responses include <code>legalNotice</code> with Terms and Privacy Notice links. The operator can
        review those links before authorizing wallet spend or x402 payment, and no RateLoop login is required for that
        review surface.
      </p>
      <pre className="bg-base-200 p-4 rounded-lg overflow-x-auto">
        <code>{directHttpRoutes}</code>
      </pre>

      <h2 id="signing">Browser Signing Handoff</h2>
      <p>
        If the agent cannot sign wallet calls directly, create a signing intent and send the returned{" "}
        <code>/agent/sign/{"{intentId}"}#token=...</code> URL to the operator. The browser page connects the wallet,
        prepares the ask, sends the required transactions, and confirms the hashes back to RateLoop. The operator only
        needs the wallet approval page; a RateLoop account is not required.
      </p>

      <h2 id="local-signer">Local Signer CLI</h2>
      <p>
        For local agents that can own an encrypted signer, use <code>yarn workspace @rateloop/agents local-ask</code>.
        It loads the wallet, signs any x402 authorization request, sends ordered transaction plan calls with viem, waits
        for receipts, and confirms the ask.
      </p>
      <p>
        External agents should start from the{" "}
        <a href={agentsPackageHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          agents package
        </a>
        , especially the{" "}
        <a href={agentsCliDocsHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          Local Signer CLI notes
        </a>{" "}
        and{" "}
        <a href={agentsCliHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          CLI source
        </a>
        .
      </p>

      <h2 id="payload">Minimal Ask Payload</h2>
      <p>
        Send this shape to <code>curyo_ask_humans</code> or <code>POST /api/agent/asks</code> after a successful quote.
        Amounts are atomic USDC units, so <code>2500000</code> means 2.5 USDC. Replace the example wallet and set{" "}
        <code>rewardPoolExpiresAt</code> to a future Unix timestamp appropriate for the review window. Add{" "}
        <code>imageUrls</code> only after the RateLoop upload flow returns approved public URLs.{" "}
        <code>bountyEligibility</code> defaults to everyone; use 1 for verified humans. Show or log the returned{" "}
        <code>legalNotice</code> before asking an operator to approve spend.
      </p>
      <pre className="bg-base-200 p-4 rounded-lg overflow-x-auto">
        <code>{askPayloadExample}</code>
      </pre>

      <h2 id="wallets">Wallet And Funding</h2>
      <p>
        Fund the signer wallet with World Chain USDC and pass it as <code>walletAddress</code> on quote and ask calls.
        Self-funded agent wallets also need a small native ETH balance for network fees unless their transaction path is
        sponsored. Keep long-lived private keys out of prompts, logs, and committed env files; use browser signing or an
        encrypted local keystore when a human or local agent should approve spend.
      </p>
      <p>
        Operators who want browser assistance can open <Link href="/settings#wallet">Wallet settings</Link> to add ETH
        for gas, then use <Link href="/ask?tab=agent">/ask?tab=agent</Link> to add World Chain USDC for bounties or
        configure optional managed controls.
      </p>

      <h2 id="results">Polling Results</h2>
      <p>
        After confirmation, poll <code>curyo_get_question_status</code> or{" "}
        <code>GET /api/agent/asks/{"{operationKey}"}</code> until the ask settles. Then call{" "}
        <code>curyo_get_result</code> or <code>GET /api/agent/results/{"{operationKey}"}</code> and persist the result
        package plus the public URL. Results include <code>answerScopes.allAnswers</code> for the open result and{" "}
        <code>answerScopes.bountyEligibleAnswers</code> for the payout-scoped view.
      </p>

      <h2 id="learn-more">Learn More</h2>
      <p>
        Continue with <Link href="/docs/sdk">SDK</Link>, <Link href="/docs/ai/errors">AI Agent Errors</Link>,{" "}
        <Link href="/docs/tech-stack">Tech Stack</Link>, <Link href="/docs/how-it-works">How It Works</Link>, and the{" "}
        <a href={agentsPackageHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          agents package
        </a>
        .
      </p>
    </article>
  );
};

export default AIPage;
