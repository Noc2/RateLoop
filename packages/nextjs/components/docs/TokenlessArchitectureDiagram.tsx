import { DiagramNode, DocsDiagramFrame, MiniPill } from "~~/components/docs/DocsDiagramPrimitives";

export function TokenlessArchitectureDiagram() {
  return (
    <DocsDiagramFrame
      eyebrow="Technical architecture"
      title="Agent interfaces, RateLoop services, and immutable Base settlement"
      description="The credential authority governs new admission. It cannot move funds, alter accepted work, or redirect claims."
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1.15fr_auto_1.2fr] lg:items-center">
        <section aria-labelledby="architecture-agent-interfaces" className="grid gap-3">
          <p
            id="architecture-agent-interfaces"
            className="font-mono text-xs font-semibold uppercase tracking-wider text-base-content/45"
          >
            Agent interfaces
          </p>
          <DiagramNode accent="blue" title="MCP Adapter">
            Streamable HTTP tools for approval-bound handoffs and connected workspace policies.
          </DiagramNode>
          <DiagramNode accent="green" title="SDK + HTTP API">
            Typed quote, ask, wait, and result operations for direct integrations.
          </DiagramNode>
          <DiagramNode accent="yellow" title="x402 funding lane">
            A wallet-signed EIP-3009 USDC authorization funds the exact frozen round total.
          </DiagramNode>
        </section>

        <div className="flex flex-col items-center gap-1 py-1 lg:px-1" aria-hidden="true">
          <span className="font-mono text-xs text-base-content/35">request</span>
          <span className="rotate-90 font-mono text-xl text-base-content/25 lg:rotate-0">→</span>
        </div>

        <section aria-labelledby="architecture-services" className="grid gap-3">
          <p
            id="architecture-services"
            className="font-mono text-xs font-semibold uppercase tracking-wider text-base-content/45"
          >
            RateLoop services
          </p>
          <DiagramNode accent="blue" title="Workspace policy">
            Authenticates the caller, freezes audience rules, and binds evidence to the review.
          </DiagramNode>
          <DiagramNode accent="green" title="Assignment + reveal orchestration">
            Checks paid eligibility, issues assignments, and drives sealed commit and reveal deadlines.
          </DiagramNode>
          <DiagramNode accent="pink" title="Indexer + decision packets">
            Turns public events and private review artifacts into a result the agent can consume.
          </DiagramNode>
        </section>

        <div className="flex flex-col items-center gap-1 py-1 lg:px-1" aria-hidden="true">
          <span className="font-mono text-xs text-base-content/35">calls + events</span>
          <span className="rotate-90 font-mono text-xl text-base-content/25 lg:rotate-0">→</span>
        </div>

        <section aria-labelledby="architecture-base" className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              id="architecture-base"
              className="font-mono text-xs font-semibold uppercase tracking-wider text-base-content/45"
            >
              Base + USDC
            </p>
            <MiniPill accent="green">Public settlement</MiniPill>
          </div>
          <DiagramNode accent="yellow" title="X402PanelSubmitter">
            Stateless adapter: receives the exact authorization, creates the round, and retains no balance.
          </DiagramNode>
          <DiagramNode accent="blue" title="CredentialIssuer">
            Fundless, epoch-versioned trust anchor for new paid-task vouchers.
          </DiagramNode>
          <DiagramNode accent="green" title="TokenlessPanel">
            Immutable fund core for round custody, commits, reveals, deterministic settlement, refunds, and claims.
          </DiagramNode>
        </section>
      </div>
    </DocsDiagramFrame>
  );
}
