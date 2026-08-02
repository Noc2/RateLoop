import { BETTER_AUTH_SIGN_IN_TEST_IDS } from "../../components/auth/browserSelectors";
import { withEnglishAppTestProviders } from "../../components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "../../components/tokenless/testing/dom";
import { hostedAuthEmailInput } from "./harness";
import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import type { Locator, Page } from "@playwright/test";

test("the hosted harness and rendered sign-in input share one stable selector", async () => {
  const restoreDom = installTestDom();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async input => {
    const url = String(input);
    if (url === "/api/auth/config") {
      return Response.json({
        configured: true,
        methods: { apple: false, emailOtp: true, google: false, passkey: true, sso: false },
      });
    }
    if (url === "/api/auth/session") return Response.json({ authenticated: false });
    throw new Error(`Unexpected hosted selector test request: ${url}`);
  }) as typeof fetch;
  const { cleanup, render: baseRender } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { BetterAuthSignIn } = await import("../../components/auth/BetterAuthSignIn");

  try {
    const view = render(React.createElement(BetterAuthSignIn));
    const renderedInput = await view.findByTestId(BETTER_AUTH_SIGN_IN_TEST_IDS.emailInput);
    assert.equal(view.getByRole("textbox", { name: "Email address" }), renderedInput);

    const selectedTestIds: string[] = [];
    const locator = {} as Locator;
    const page = {
      getByTestId(testId: string) {
        selectedTestIds.push(testId);
        return locator;
      },
    } as Pick<Page, "getByTestId">;

    assert.equal(hostedAuthEmailInput(page), locator);
    assert.deepEqual(selectedTestIds, [renderedInput.getAttribute("data-testid")]);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    restoreDom();
  }
});
