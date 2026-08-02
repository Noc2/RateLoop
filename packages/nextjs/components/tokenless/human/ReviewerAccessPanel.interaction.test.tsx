import React from "react";
import {
  REVIEWER_ACCESS_SENSITIVITY_MESSAGE_KEYS,
  type ReviewerAccessPrivateSensitivity,
} from "./reviewerAccessSensitivity";
import assert from "node:assert/strict";
import test from "node:test";
import { AgentTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";
import { type Locale, SUPPORTED_LOCALES } from "~~/i18n/config";
import { REVIEW_REQUEST_PRIVATE_SENSITIVITIES } from "~~/lib/tokenless/reviewRequestProfiles";

const EXPECTED_SENSITIVITY_COPY = {
  en: {
    internal: "Internal",
    confidential: "Confidential",
    restricted: "Restricted",
    regulated: "Regulated",
  },
  de: {
    internal: "Intern",
    confidential: "Vertraulich",
    restricted: "Eingeschränkt",
    regulated: "Reguliert",
  },
} as const satisfies Record<Locale, Record<ReviewerAccessPrivateSensitivity, string>>;

test("every reviewer sensitivity renders localized grant copy in every supported locale", async () => {
  assert.deepEqual(Object.keys(REVIEWER_ACCESS_SENSITIVITY_MESSAGE_KEYS), [...REVIEW_REQUEST_PRIVATE_SENSITIVITIES]);
  const restoreDom = installTestDom();
  const previousFetch = globalThis.fetch;
  const { cleanup, render, waitFor, within } = await import("@testing-library/react");
  const { ReviewerAccessPanel } = await import("./ReviewerAccessPanel");
  globalThis.fetch = async () =>
    Response.json({
      reviewerAccess: [
        {
          workspaceId: "workspace_sensitivity_locales",
          workspaceName: "Localized review",
          status: "active",
          grants: REVIEW_REQUEST_PRIVATE_SENSITIVITIES.map(sensitivity => ({
            grantId: `grant_${sensitivity}`,
            maxPrivateSensitivity: sensitivity,
            validUntil: null,
            status: "active",
          })),
        },
      ],
    });

  try {
    for (const locale of SUPPORTED_LOCALES) {
      render(
        <AgentTestProviders locale={locale}>
          <ReviewerAccessPanel />
        </AgentTestProviders>,
      );
      const screen = within(document.body);
      await waitFor(() => {
        for (const sensitivity of REVIEW_REQUEST_PRIVATE_SENSITIVITIES) {
          assert.ok(screen.getByText(new RegExp(EXPECTED_SENSITIVITY_COPY[locale][sensitivity], "u")));
        }
      });
      cleanup();
    }
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
