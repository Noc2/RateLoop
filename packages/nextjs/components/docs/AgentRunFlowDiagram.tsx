import { DocsDiagramFrame } from "~~/components/docs/DocsDiagramPrimitives";
import { type DocsFlowStep, DocsStepFlow } from "~~/components/docs/DocsStepFlow";

const steps: readonly DocsFlowStep[] = [
  {
    title: "Quote",
    code: "quote()",
    detail: "Price the panel and freeze the review terms before any money moves.",
    accent: "blue",
  },
  {
    title: "Ask",
    code: "ask()",
    detail: "Submit one decision, its evidence, audience policy, and callback metadata.",
    accent: "green",
  },
  {
    title: "Payment",
    code: "USDC",
    detail: "Fund the exact round total from prepaid balance or an EIP-3009 authorization.",
    accent: "yellow",
  },
  {
    title: "Wait",
    code: "wait()",
    detail: "Poll, receive a webhook, or resume the agent when the panel reaches a terminal state.",
    accent: "pink",
  },
  {
    title: "Result",
    code: "result()",
    detail: "Read the verdict, reports, disagreement, review evidence, and settlement references.",
    accent: "blue",
  },
];

export function AgentRunFlowDiagram() {
  return (
    <DocsDiagramFrame
      eyebrow="Agent flow"
      title="Quote → Ask → Payment → Wait → Result"
      description="The same production workflow is available through the SDK, HTTP API, and MCP Adapter."
    >
      <DocsStepFlow steps={steps} label="The five stages of an agent review run" />
    </DocsDiagramFrame>
  );
}
