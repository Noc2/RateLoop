import { DocsDiagramFrame, MiniPill, StepNumber } from "~~/components/docs/DocsDiagramPrimitives";

const steps = [
  {
    number: "01",
    title: "Quote",
    body: "Choose template, category, bounty terms, and public context.",
    tool: "curyo_quote_question",
  },
  {
    number: "02",
    title: "Prepare ask",
    body: "Submit wallet address, stable clientRequestId, and bounded question.",
    tool: "curyo_ask_humans",
  },
  {
    number: "03",
    title: "Wallet signs or executes",
    body: "Use ordered wallet calls, x402 authorization, browser handoff, or local signer.",
    tool: "wallet-controlled spend",
  },
  {
    number: "04",
    title: "Confirm transaction hashes",
    body: "Report executed transaction hashes so RateLoop can link chain state to the operation.",
    tool: "curyo_confirm_ask_transactions",
  },
  {
    number: "05",
    title: "Poll status",
    body: "Wait while raters commit hidden reports, reveal, and settle the public result.",
    tool: "curyo_get_question_status",
  },
  {
    number: "06",
    title: "Read result",
    body: "Persist answer, confidence, objections, limitations, source URLs, and public result URL.",
    tool: "curyo_get_result",
  },
];

export function AgentIntegrationSequenceDiagram() {
  return (
    <DocsDiagramFrame
      eyebrow="Agent workflow"
      title="Quote to Public Result"
      description="Agents can use the same public protocol path without a RateLoop account or custodial operator wallet."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {steps.map(step => (
          <article key={step.number} className="flex min-h-60 flex-col rounded-lg bg-base-content/[0.07] p-3">
            <StepNumber>{step.number}</StepNumber>
            <h4 className="mt-4 text-base font-semibold leading-snug text-base-content">{step.title}</h4>
            <p className="mt-3 text-sm leading-6 text-base-content/65">{step.body}</p>
            <p className="mt-auto pt-4 font-mono text-xs leading-5 text-base-content/45">{step.tool}</p>
          </article>
        ))}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-base-content/[0.045] p-3">
          <MiniPill accent="blue">wallet_calls</MiniPill>
          <p className="mt-2 text-sm leading-6 text-base-content/65">
            Execute ordered transactions from the paying wallet.
          </p>
        </div>
        <div className="rounded-lg bg-base-content/[0.045] p-3">
          <MiniPill accent="green">x402_authorization</MiniPill>
          <p className="mt-2 text-sm leading-6 text-base-content/65">
            Sign USDC authorization first, then execute protocol transactions.
          </p>
        </div>
        <div className="rounded-lg bg-base-content/[0.045] p-3">
          <MiniPill accent="yellow">/ask?tab=agent</MiniPill>
          <p className="mt-2 text-sm leading-6 text-base-content/65">
            Optional browser helper for funding, copied config, and managed controls.
          </p>
        </div>
      </div>
    </DocsDiagramFrame>
  );
}
