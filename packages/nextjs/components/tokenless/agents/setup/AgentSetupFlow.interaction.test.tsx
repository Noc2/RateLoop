import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";
import type { WorkspaceAgentSetupView } from "~~/lib/tokenless/workspaceAgentSetup";

type Step = "workspace" | "connect" | "agent" | "reviews" | "people";

const HASH = `sha256:${"a".repeat(64)}` as const;

function definition(overrides: Record<string, unknown> = {}) {
  return {
    definitionId: "expd_global_prompt_security",
    version: 1,
    hash: HASH,
    scope: "global",
    workspaceId: null,
    key: "prompt_security",
    label: "Prompt security",
    description: "Checks prompt-injection and jailbreak resistance.",
    networkEligible: true,
    ...overrides,
  };
}

function stages(currentStep: Step) {
  const order: Step[] = ["workspace", "connect", "agent", "reviews", "people"];
  const currentIndex = order.indexOf(currentStep);
  return order.map((key, index) => ({
    key,
    status: index < currentIndex ? "complete" : index === currentIndex ? "current" : "not_started",
  }));
}

function reviewDraft(profile: Record<string, unknown> = {}) {
  return {
    schemaVersion: "rateloop.workspace-agent-setup-review.v2",
    bindingRevision: 3,
    selection: {
      mode: "fixed",
      enforcementMode: "advisory",
      agreementThresholdBps: 6_600,
      productionFloorBps: 2_500,
      fixedRateBps: 10_000,
      maximumUnreviewedGap: 10,
      requiredRiskTiers: [],
      criticalRiskTiers: [],
      minimumConfidenceBps: null,
      maximumLatencyMs: null,
    },
    requestProfile: {
      questionAuthority: "owner_fixed",
      resultSemantics: "assurance",
      criterion: "Is this answer safe to send?",
      positiveLabel: "Safe",
      negativeLabel: "Unsafe",
      rationaleMode: "optional",
      audience: "private_invited",
      contentBoundary: "private_workspace",
      privateSensitivity: "confidential",
      privateGroupId: "group-1",
      requiredExpertiseKeys: [],
      expertiseRequirements: [],
      responseWindowSeconds: 3_600,
      panelSize: 2,
      compensationMode: "unpaid",
      bountyPerSeatAtomic: null,
      configurationStatus: "ready",
      ...profile,
    },
    authority: "prepare_for_approval",
  };
}

function setupView(currentStep: Step, overrides: Record<string, unknown> = {}): WorkspaceAgentSetupView {
  return {
    workspaceId: "workspace-1",
    workspaceName: "Acme",
    role: "owner",
    canManage: true,
    status: "in_progress",
    revision: 7,
    resumeStep: currentStep,
    currentStep,
    stages: stages(currentStep),
    complete: false,
    grandfathered: false,
    connection: {
      intentId: "intent-1",
      integrationId: "integration-1",
      status: "connected",
      hardExpiresAt: null,
      safeAccess: {
        canCheckReviewRequirement: true,
        canSpend: false,
        canPublish: false,
        canReadPrivateArtifacts: false,
        canAdministerWorkspace: false,
      },
    },
    agent: {
      agentId: "agent-1",
      versionId: "version-1",
      displayName: "Codex",
      description: "",
      provider: "unknown",
      model: "unknown",
      modelVersion: null,
      environment: "production",
      observedClientName: "Codex CLI",
      observedClientVersion: "1.0.0",
    },
    reviewDraft: reviewDraft(),
    peopleDecision: null,
    privateGroupId: "group-1",
    capabilities: {
      reviewerAudiences: ["private_invited"],
      contentBoundaries: ["private_workspace"],
      humanReviewLanes: {},
      autonomousAccess: false,
      unavailableReason: null,
      automaticGrantOffer: null,
    },
    ...overrides,
  } as unknown as WorkspaceAgentSetupView;
}

/**
 * `new FormData(form)` needs jsdom's FormData: the Node global rejects a jsdom element.
 */
function installFormData() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "FormData");
  Object.defineProperty(globalThis, "FormData", {
    configurable: true,
    writable: true,
    value: (globalThis.window as unknown as { FormData: unknown }).FormData,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "FormData", previous);
    else Reflect.deleteProperty(globalThis, "FormData");
  };
}

function stubRouter() {
  const calls: Array<{ method: "push" | "replace"; url: string }> = [];
  return {
    calls,
    router: {
      push: (url: string) => calls.push({ method: "push", url }),
      replace: (url: string) => calls.push({ method: "replace", url }),
      back: () => undefined,
      forward: () => undefined,
      refresh: () => undefined,
      prefetch: () => undefined,
    },
  };
}

async function renderFlow(initialSetup: WorkspaceAgentSetupView, router: unknown) {
  const { render } = await import("@testing-library/react");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { RateLoopNotificationProvider } = await import("~~/components/tokenless/RateLoopNotificationProvider");
  const { AgentSetupFlow } = await import("./AgentSetupFlow");
  return render(
    <AppRouterContext.Provider value={router as never}>
      <RateLoopNotificationProvider>
        <AgentSetupFlow initialSetup={initialSetup} />
      </RateLoopNotificationProvider>
    </AppRouterContext.Provider>,
  );
}

test("a hybrid panel with a saved specialist area offers no control that cannot be honoured", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, within } = await import("@testing-library/react");
  const previousFetch = globalThis.fetch;
  const other = definition({ definitionId: "expd_global_privacy", key: "privacy", label: "Privacy review" });

  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/reviewer-expertise/definitions")) {
      return Response.json({ definitions: [definition(), other], suggestedDefinitionIds: [other.definitionId] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await renderFlow(
      setupView("reviews", {
        reviewDraft: reviewDraft({
          audience: "hybrid",
          contentBoundary: "public_or_test",
          privateSensitivity: null,
          panelSize: 3,
          compensationMode: "usdc",
          bountyPerSeatAtomic: "1000000",
          expertiseRequirements: [
            {
              definitionId: definition().definitionId,
              definitionVersion: 1,
              definitionHash: HASH,
              minimumSeats: 3,
              sourceScope: "any",
            },
          ],
        }),
      }),
      stubRouter().router,
    );
    const screen = within(document.body);

    // The saved area renders with its loaded definition, proving the definition list arrived and
    // that any "+ area" control would have rendered by now.
    assert.ok((await screen.findAllByText("Checks prompt-injection and jailbreak resistance.")).length >= 1);

    assert.deepEqual(
      screen.queryAllByRole("button", { name: /^\+ / }).map(button => button.textContent),
      [],
      "a hybrid panel must not offer an add-specialist-area control",
    );
    assert.ok(
      screen.queryByText("Browse specialist areas") === null,
      "a hybrid panel must not offer a specialist-area browser",
    );

    // It explains why, and names the two ways out.
    const explanations = screen.getAllByText(
      /Specialist areas can’t be added while both invited and network reviewers are used\./,
    );
    assert.ok(explanations.length >= 1);
    assert.ok(screen.getByRole("radio", { name: /No specialist needed/ }));
    assert.ok(screen.getByRole("button", { name: "Remove" }));
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a failed step load surfaces the reason instead of doing nothing", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const previousFetch = globalThis.fetch;
  const { calls, router } = stubRouter();

  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/agent-setup?step=")) {
      return Response.json({ message: "Your session expired. Sign in again." }, { status: 401 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await renderFlow(setupView("connect"), router);
    const screen = within(document.body);
    const back = screen.getByRole("button", { name: "Back" });

    await userEvent.setup().click(back);

    assert.ok(screen.getByText("Your session expired. Sign in again."));
    assert.deepEqual(calls, []);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("step navigation holds the wizard busy so a second navigation cannot race it", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const previousFetch = globalThis.fetch;
  let releaseStep: ((response: Response) => void) | null = null;

  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/agent-setup?step=")) {
      return await new Promise<Response>(resolve => {
        releaseStep = resolve;
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await renderFlow(setupView("agent"), stubRouter().router);
    const screen = within(document.body);
    const back = screen.getByRole("button", { name: "Back" });
    const workspaceChip = screen.getByRole("button", {
      name: name => name.includes("Workspace") && name.includes("Complete"),
    });
    assert.equal(workspaceChip.hasAttribute("disabled"), false);

    const user = userEvent.setup();
    await act(async () => {
      void user.click(back);
      await new Promise(resolve => globalThis.setTimeout(resolve, 10));
    });

    assert.ok(releaseStep, "the step load must be in flight");
    assert.equal(back.hasAttribute("disabled"), true, "Back must stay busy while its load is in flight");
    assert.equal(
      screen
        .getByRole("button", { name: name => name.includes("Workspace") && name.includes("Complete") })
        .hasAttribute("disabled"),
      true,
      "progress navigation must not start a second load while one is in flight",
    );

    await act(async () => {
      releaseStep?.(Response.json(setupView("connect")));
      await new Promise(resolve => globalThis.setTimeout(resolve, 10));
    });
    assert.equal(screen.getByRole("button", { name: "Back" }).hasAttribute("disabled"), false);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a rejected description shows its message on the description field", async () => {
  const restoreDom = installTestDom();
  const restoreFormData = installFormData();
  const { act, cleanup, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/agent-setup/confirm-agent")) {
      return Response.json(
        { message: "Agent description must contain 1-1000 characters.", field: "description" },
        { status: 400 },
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await renderFlow(setupView("agent"), stubRouter().router);
    const screen = within(document.body);
    const user = userEvent.setup();
    const description = screen.getByRole("textbox", { name: /Description/ });

    await user.type(description, "   ");
    await user.click(screen.getByRole("button", { name: "Confirm workflow" }));

    const message = screen.getByText("Agent description must contain 1-1000 characters.");
    assert.equal(message.getAttribute("role"), "alert");
    assert.equal(description.getAttribute("aria-invalid"), "true");
    assert.equal(description.getAttribute("aria-describedby"), message.getAttribute("id"));
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreFormData();
    restoreDom();
  }
});

test("a failed reviewer-group check reads as a failure, not as an endless check", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, within } = await import("@testing-library/react");
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/private-groups")) {
      return Response.json({ message: "The reviewer directory is unavailable." }, { status: 500 });
    }
    if (url.includes("/reviewer-expertise/definitions")) {
      return Response.json({ definitions: [], suggestedDefinitionIds: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await renderFlow(setupView("people"), stubRouter().router);
    const screen = within(document.body);

    const failure = await screen.findByText("The reviewer directory is unavailable.");
    assert.equal(failure.getAttribute("role"), "alert");
    assert.equal(screen.queryByText("Checking the saved reviewer group…"), null);
    assert.ok(screen.getByRole("button", { name: "Check again" }));
    // An unknown group size must not be sized as "nobody has joined yet".
    assert.equal(screen.queryByRole("radio", { name: /Invite several people/ }), null);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a full reviewer group without specialist areas is not told that requests stay unavailable", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, within } = await import("@testing-library/react");
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/private-groups")) {
      return Response.json({ groups: [{ groupId: "group-1", memberCount: 2 }] });
    }
    if (url.includes("/reviewer-expertise/definitions")) {
      return Response.json({ definitions: [], suggestedDefinitionIds: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await renderFlow(setupView("people"), stubRouter().router);
    const screen = within(document.body);

    assert.ok(await screen.findByText("2/2 seats ready"));
    assert.ok(screen.getByRole("radio", { name: /Use confirmed reviewers/ }));
    assert.equal(
      screen.queryByText("Automatic requests stay unavailable until enough reviewers join."),
      null,
      "a full reviewer group must not be told automatic requests are still blocked",
    );
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
