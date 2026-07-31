import React from "react";
import { TokenlessLandingPage } from "../../app/[locale]/(public)/page";
import { SignInSurface } from "../auth/SignInSurface";
import { HumanAssuranceRaterClient } from "./HumanAssuranceRaterClient";
import { PublicQuestionCard } from "./answer/PublicQuestionCard";
import axe from "axe-core";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { AgentTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

async function assertNoSemanticViolations(name: string, element: React.ReactElement) {
  const dom = new JSDOM(
    `<!doctype html><html lang="en"><head><title>${name}</title></head><body>${renderToStaticMarkup(
      <AgentTestProviders>{element}</AgentTestProviders>,
    )}</body></html>`,
    { runScripts: "outside-only" },
  );
  dom.window.eval(axe.source);
  const browserAxe = (dom.window as unknown as { axe: typeof axe }).axe;
  const result = await browserAxe.run(dom.window.document, {
    rules: {
      "color-contrast": { enabled: false },
      "link-in-text-block": { enabled: false },
      region: { enabled: false },
    },
  });
  assert.equal(
    result.violations.length,
    0,
    `${name} should have no axe semantic violations: ${JSON.stringify(
      result.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.html) })),
    )}`,
  );
  dom.window.close();
}

test("five primary tokenless surfaces pass rendered DOM axe checks", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const publicTask = {
    operationKey: "op_example",
    chainId: 84532,
    panelAddress: `0x${"1".repeat(40)}` as `0x${string}`,
    roundId: "round_example",
    contentId: `0x${"2".repeat(64)}` as `0x${string}`,
    reviewerSource: "rateloop_network" as const,
    assignmentId: "hasn_accessibility",
    assignmentStatus: "accepted" as const,
    assignmentExpiresAt: "2030-01-01T00:00:00.000Z",
    confidentialityTermsHash: `sha256:${"3".repeat(64)}` as const,
    selectionBindingHash: `sha256:${"4".repeat(64)}` as const,
    question: {
      kind: "binary" as const,
      prompt: "Would you send this reply?",
      negativeLabel: "Needs work",
      positiveLabel: "Approve",
      rationale: { mode: "off" as const },
    },
    voucherDeadline: "2030-01-01T00:00:00.000Z",
    alreadyVouchered: false,
    earnings: {
      guaranteedBaseAtomic: "3000000",
      possibleBonusAtomic: "2000000",
      possibleSurpriseBonusAtomic: "1000000",
      attemptCompensationAtomic: "1000000",
    },
    disclosureBeacon: { network: "quicknet-t" as const, round: 1 },
    scoringBeacon: { network: "quicknet-t" as const, round: 2 },
  };

  await assertNoSemanticViolations("Landing", <TokenlessLandingPage socialProofItems={[]} />);
  await assertNoSemanticViolations(
    "Human hub",
    <SignInSurface
      description="Review work is available to eligible, signed-in RateLoop humans."
      headingLevel={2}
      layout="embedded"
      title="Sign in to discover review work"
      titleId="human-discover-sign-in-title"
    >
      <button type="button">Sign in</button>
    </SignInSurface>,
  );
  await assertNoSemanticViolations(
    "Agents hub",
    <SignInSurface
      description="Sign in to connect an agent, configure human review, manage reviewers, and evaluate performance."
      title="Agents"
      titleId="agents-sign-in-title"
    >
      <button type="button">Sign in</button>
    </SignInSurface>,
  );
  await assertNoSemanticViolations("Private reviewer", <HumanAssuranceRaterClient />);
  await assertNoSemanticViolations(
    "Public reviewer",
    <PublicQuestionCard
      task={publicTask}
      paidAccess={{ state: "ready" }}
      onSubmitted={() => undefined}
      principalId="rlp_accessibility_reviewer"
    />,
  );
});
