import { DiagramNode, DocsDiagramFrame } from "~~/components/docs/DocsDiagramPrimitives";

const arrowMarker = (
  <marker
    id="protocol-pieces-arrow"
    viewBox="0 0 10 10"
    refX="8"
    refY="5"
    markerWidth="6"
    markerHeight="6"
    orient="auto"
  >
    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(245 245 245 / 0.55)" />
  </marker>
);

function MobileProtocolPieces() {
  return (
    <div className="grid gap-3 md:hidden">
      <DiagramNode accent="blue" title="Asker or agent">
        Submits the question, public context, funding asset, and later reads the result.
      </DiagramNode>
      <DiagramNode accent="yellow" title="Frontend and SDK">
        Prepares wallet calls, attaches frontend attribution, and explains the current round state.
      </DiagramNode>
      <DiagramNode accent="green" title="Raters">
        Commit a hidden up/down signal, crowd prediction, and optional LREP stake.
      </DiagramNode>
      <DiagramNode accent="pink" title="Keeper">
        Reveals eligible reports, settles ready rounds, and can publish payout artifacts.
      </DiagramNode>
      <DiagramNode accent="green" title="On-chain protocol state">
        Stores questions, commitments, settlement, escrows, frontend bonds, and payout roots.
      </DiagramNode>
      <DiagramNode accent="blue" title="Indexer and public reads">
        Makes settled ratings, revealed reports, claim state, and result packages easy to query.
      </DiagramNode>
    </div>
  );
}

export function ProtocolPiecesDiagram() {
  return (
    <DocsDiagramFrame title="Protocol map">
      <MobileProtocolPieces />
      <div className="relative hidden min-h-[27rem] overflow-hidden rounded-lg md:block">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1080 432" aria-hidden="true">
          <defs>{arrowMarker}</defs>
          <line x1="650" y1="20" x2="650" y2="412" stroke="rgb(245 245 245 / 0.18)" strokeDasharray="7 7" />
          <text x="604" y="18" fill="rgb(245 245 245 / 0.42)" fontSize="11" fontWeight="700">
            ON-CHAIN STATE
          </text>
          <path
            d="M 240 108 C 305 108 330 108 390 108"
            fill="none"
            stroke="rgb(245 245 245 / 0.34)"
            strokeWidth="2"
            markerEnd="url(#protocol-pieces-arrow)"
          />
          <path
            d="M 240 330 C 310 320 334 178 390 158"
            fill="none"
            stroke="rgb(245 245 245 / 0.22)"
            strokeWidth="2"
            markerEnd="url(#protocol-pieces-arrow)"
          />
          <path
            d="M 610 128 C 680 128 710 118 820 118"
            fill="none"
            stroke="rgb(245 245 245 / 0.34)"
            strokeWidth="2"
            markerEnd="url(#protocol-pieces-arrow)"
          />
          <path
            d="M 610 326 C 706 310 722 190 820 178"
            fill="none"
            stroke="rgb(245 245 245 / 0.22)"
            strokeWidth="2"
            markerEnd="url(#protocol-pieces-arrow)"
          />
          <path
            d="M 930 226 C 930 270 930 292 930 320"
            fill="none"
            stroke="rgb(245 245 245 / 0.28)"
            strokeWidth="2"
            markerEnd="url(#protocol-pieces-arrow)"
          />
          <path
            d="M 820 370 C 650 404 430 402 240 346"
            fill="none"
            stroke="rgb(245 245 245 / 0.16)"
            strokeWidth="2"
            markerEnd="url(#protocol-pieces-arrow)"
          />
          <text x="280" y="86" fill="rgb(245 245 245 / 0.52)" fontSize="12" fontFamily="monospace">
            submit / fund
          </text>
          <text x="678" y="96" fill="rgb(245 245 245 / 0.52)" fontSize="12" fontFamily="monospace">
            transactions + events
          </text>
          <text x="444" y="274" fill="rgb(245 245 245 / 0.48)" fontSize="12" fontFamily="monospace">
            reveal / settle
          </text>
          <text x="948" y="282" fill="rgb(245 245 245 / 0.48)" fontSize="12" fontFamily="monospace">
            indexed reads
          </text>
        </svg>

        <DiagramNode accent="blue" title="Wallet-controlled asker" className="absolute left-4 top-12 w-56">
          Question, public context, signed wallet calls, later result read.
        </DiagramNode>
        <DiagramNode accent="green" title="Open raters" className="absolute bottom-10 left-4 w-56">
          Hidden report, crowd prediction, optional LREP stake.
        </DiagramNode>
        <DiagramNode accent="yellow" title="Frontend and SDK" className="absolute left-[24rem] top-16 w-56">
          Wallet calls, frontend attribution, round-state UX.
        </DiagramNode>
        <DiagramNode accent="pink" title="Keeper" className="absolute bottom-12 left-[24rem] w-56">
          Reveal, settle, cleanup, and payout artifact publishing.
        </DiagramNode>
        <DiagramNode accent="green" title="On-chain protocol state" className="absolute right-4 top-14 w-64">
          Questions, hidden report commitments, escrows, settlement, frontend bonds, payout roots.
        </DiagramNode>
        <DiagramNode accent="blue" title="Indexer and public reads" className="absolute bottom-12 right-4 w-64">
          Settled rating, revealed reports, claim state, artifact state, public result package.
        </DiagramNode>
      </div>
    </DocsDiagramFrame>
  );
}
