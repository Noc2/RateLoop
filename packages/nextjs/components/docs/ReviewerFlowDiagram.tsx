import { DocsDiagramFrame } from "~~/components/docs/DocsDiagramPrimitives";
import { type DocsFlowStep, DocsStepFlow } from "~~/components/docs/DocsStepFlow";

const steps: readonly DocsFlowStep[] = [
  {
    title: "Eligibility",
    detail: "Complete paid-task, identity, sanctions, tax, and payout checks before receiving a paid voucher.",
    accent: "blue",
  },
  {
    title: "Assignment",
    detail: "Receive a blinded item under the round's invited, network, or hybrid audience policy.",
    accent: "green",
  },
  {
    title: "Commit",
    detail: "Sign a sealed vote, crowd prediction, response hash, and payout commitment.",
    accent: "yellow",
  },
  {
    title: "Reveal",
    detail: "Open the valid report after commit closure, with a self-reveal path if automation fails.",
    accent: "pink",
  },
  {
    title: "Claim",
    detail: "Claim the fixed base plus any earned RBTS bonus to the committed payout address.",
    accent: "blue",
  },
];

export function ReviewerFlowDiagram() {
  return (
    <DocsDiagramFrame
      eyebrow="Reviewer flow"
      title="Eligible before the first paid voucher"
      description="Assignments remain blind through commit closure; accepted revealed work reaches a paid terminal path."
    >
      <DocsStepFlow steps={steps} label="The five stages of a reviewer assignment" />
    </DocsDiagramFrame>
  );
}
