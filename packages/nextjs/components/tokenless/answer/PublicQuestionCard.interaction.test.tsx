import React from "react";
import type { PublicAnswerTask } from "./PublicQuestionCard";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";
import { TOKENLESS_DRAND_NETWORKS } from "~~/lib/tokenless/rater/tlock";

const task: PublicAnswerTask = {
  operationKey: "public-task-1",
  chainId: 84532,
  panelAddress: `0x${"1".repeat(40)}`,
  roundId: "17",
  contentId: `0x${"2".repeat(64)}`,
  reviewerSource: "rateloop_network",
  assignmentId: "hasn_public-task-1",
  assignmentStatus: "accepted",
  assignmentExpiresAt: "2099-07-17T09:00:00.000Z",
  confidentialityTermsHash: `sha256:${"3".repeat(64)}`,
  selectionBindingHash: `sha256:${"4".repeat(64)}`,
  question: {
    kind: "binary",
    prompt: "Is the response supported by the evidence?",
    positiveLabel: "Supported",
    negativeLabel: "Not supported",
    rationale: { mode: "optional", maxLength: 500 },
  },
  voucherDeadline: "2099-07-17T09:00:00.000Z",
  alreadyVouchered: false,
  earnings: {
    guaranteedBaseAtomic: "1000000",
    possibleBonusAtomic: "500000",
    possibleSurpriseBonusAtomic: "250000",
    attemptCompensationAtomic: "100000",
  },
  disclosureBeacon: { network: "quicknet-t", round: 1 },
  scoringBeacon: { network: "quicknet-t", round: 2 },
};

const PRINCIPAL_A = `rlp_${"a".repeat(48)}`;
const PRINCIPAL_B = `rlp_${"b".repeat(48)}`;
const submittableTask: PublicAnswerTask = {
  ...task,
  voucherDeadline: "2099-07-17T09:00:00.000Z",
  disclosureBeacon: { network: "quicknet-t", round: 1_000_000_000 },
  scoringBeacon: { network: "quicknet-t", round: 1_000_000_040 },
};

function session(principalId: string) {
  return {
    authenticated: true,
    principalId,
    authProvider: "email",
    displayName: null,
    expiresAt: "2026-07-18T12:00:00.000Z",
    wallets: { funding: null, payout: `0x${"3".repeat(40)}`, recovery: null },
  };
}

function assertNoRecoveryMaterial(storage: Storage) {
  const entries = Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index) ?? "";
    return [key, storage.getItem(key) ?? ""] as const;
  });
  assert.equal(
    entries.some(([key]) => key.startsWith("rateloop:rater-device-recovery:")),
    false,
  );
  assert.doesNotMatch(
    entries.map(([, value]) => value).join("\n"),
    /recoverySecret|votePrivateKey|payoutPrivateKey|rateloop\.device-recovery-backup/u,
  );
}

test("a reserved network seat must be accepted with its exact terms before public task material opens", async () => {
  const restoreDom = installTestDom();
  const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { PublicQuestionCard } = await import("./PublicQuestionCard");
  const previousFetch = globalThis.fetch;
  const requests: Array<{ body: unknown; url: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/session") return Response.json(session(PRINCIPAL_A));
    requests.push({ body: init?.body ? JSON.parse(String(init.body)) : null, url });
    if (url === `/api/account/assurance/assignments/${task.assignmentId}/accept`) {
      return Response.json({ assignmentId: task.assignmentId, accepted: true, replay: false, leases: [] });
    }
    throw new Error(`Unexpected acceptance-gate request: ${url}`);
  };
  try {
    render(
      <PublicQuestionCard
        task={{ ...task, assignmentStatus: "reserved" }}
        paidAccess={{ state: "ready" }}
        onSubmitted={() => undefined}
        principalId={PRINCIPAL_A}
      />,
    );
    const screen = within(document.body);
    assert.equal(screen.queryByText(task.question.prompt), null);
    assert.equal(screen.queryByRole("button", { name: "Supported" }), null);
    const accept = screen.getByRole<HTMLButtonElement>("button", { name: "Accept and open review" });
    assert.equal(accept.disabled, true);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /accept the exact public paid-review terms/iu }));
    await user.click(accept);
    await waitFor(() => assert.ok(screen.getByText(task.question.prompt)));
    assert.ok(screen.getByRole("button", { name: "Supported" }));
    assert.deepEqual(requests, [
      {
        url: `/api/account/assurance/assignments/${task.assignmentId}/accept`,
        body: {
          confidentialityTermsAccepted: true,
          confidentialityTermsHash: task.confidentialityTermsHash,
        },
      },
    ]);
    assert.equal(
      requests.some(value => value.url === "/api/rater/vouchers"),
      false,
    );
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a public reviewer can choose a rating, exact crowd forecast, and optional feedback", async () => {
  const restoreDom = installTestDom();
  const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { PublicQuestionCard } = await import("./PublicQuestionCard");

  try {
    render(
      <PublicQuestionCard
        task={task}
        paidAccess={{ state: "ready" }}
        onSubmitted={() => undefined}
        principalId="rlp_public_reviewer"
      />,
    );
    const screen = within(document.body);
    const prepare = screen.getByRole("button", { name: "Create recovery backup" }) as HTMLButtonElement;
    assert.equal(prepare.disabled, true);
    assert.equal(screen.queryByRole("spinbutton", { name: /what percentage/iu }), null);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Supported" }));
    const forecast = screen.getByRole<HTMLInputElement>("spinbutton", {
      name: /what percentage of reviewers do you expect to choose “Supported”/iu,
    });
    assert.equal(forecast.value, "");
    assert.equal(forecast.min, "1");
    assert.equal(forecast.max, "99");
    assert.equal(forecast.step, "1");
    assert.match(screen.getByText(/your forecast stays hidden until settlement/iu).textContent ?? "", /hidden/u);
    assert.equal(screen.queryByRole("button", { name: "70%" }), null);
    fireEvent.change(forecast, { target: { value: "73" } });
    await waitFor(() =>
      assert.equal(screen.getByRole<HTMLButtonElement>("button", { name: "Create recovery backup" }).disabled, false),
    );
    fireEvent.change(forecast, { target: { value: "100" } });
    assert.equal(screen.getByRole<HTMLButtonElement>("button", { name: "Create recovery backup" }).disabled, true);
    assert.match(screen.getByRole("alert").textContent ?? "", /whole number from 1 to 99/u);
    fireEvent.change(forecast, { target: { value: "73" } });
    await user.click(screen.getByRole("button", { name: "Add feedback" }));
    const feedback = screen.getByRole("textbox", { name: "Feedback" });
    fireEvent.change(feedback, { target: { value: "The cited source supports the answer." } });
    assert.equal((screen.getByRole("textbox", { name: "Feedback" }) as HTMLInputElement).value.length, 37);
  } finally {
    cleanup();
    restoreDom();
  }
});

test("voucher and commit APIs stay unreachable until the downloaded recovery backup is confirmed", async () => {
  const restoreDom = installTestDom();
  const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { PublicQuestionCard } = await import("./PublicQuestionCard");
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/auth/session") return Response.json(session(PRINCIPAL_A));
    if (url.endsWith(`/${TOKENLESS_DRAND_NETWORKS["quicknet-t"].chainHash}/info`)) {
      const network = TOKENLESS_DRAND_NETWORKS["quicknet-t"];
      return Response.json({
        public_key: network.publicKey,
        period: network.period,
        genesis_time: network.genesisTime,
        hash: network.chainHash,
        groupHash: network.groupHash,
        schemeID: network.schemeId,
        metadata: { beaconID: network.beaconId },
      });
    }
    if (url === "/api/rater/vouchers") {
      return Response.json({ voucherId: "vch_interaction_0001", voucher: { nullifier: `0x${"4".repeat(64)}` } });
    }
    throw new Error(`Unexpected request in recovery-gate test: ${url}`);
  };

  try {
    render(
      <PublicQuestionCard
        task={submittableTask}
        paidAccess={{ state: "ready" }}
        onSubmitted={() => undefined}
        principalId="rlp_public_reviewer"
      />,
    );
    const screen = within(document.body);
    assert.ok(screen.getByRole("heading", { name: "What becomes public" }));
    assert.match(
      screen.getByText(/submitting a paid rating publishes a tlock ciphertext/iu).textContent ?? "",
      /vote, crowd forecast, response hash, per-round payout address, and salt/iu,
    );
    assert.equal(
      screen.getByRole("link", { name: "Read the privacy notice" }).getAttribute("href"),
      "/legal/privacy#on-chain-data",
    );
    assert.equal(
      requests.some(url => url === "/api/rater/vouchers" || url.includes("/api/rater/commits")),
      false,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Supported" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /what percentage/iu }), { target: { value: "73" } });
    await waitFor(() =>
      assert.equal(screen.getByRole<HTMLButtonElement>("button", { name: "Create recovery backup" }).disabled, false),
    );
    await user.click(screen.getByRole("button", { name: "Create recovery backup" }));

    const download = await screen.findByRole("link", { name: "Download recovery backup" }, { timeout: 20_000 });
    assert.deepEqual(requests, ["/api/auth/session"]);
    assert.equal(screen.getByRole<HTMLButtonElement>("button", { name: "Download backup above" }).disabled, true);
    const confirmation = screen.getByRole<HTMLInputElement>("checkbox", { name: "I saved the recovery backup" });
    assert.equal(confirmation.disabled, true);

    download.addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent.click(download);
    await waitFor(() => assert.equal(confirmation.disabled, false));
    assert.equal(screen.getByRole<HTMLButtonElement>("button", { name: "Confirm backup above" }).disabled, true);
    await user.click(confirmation);

    await waitFor(() => {
      assert.equal(
        screen.getByRole<HTMLInputElement>("checkbox", { name: "I saved the recovery backup" }).checked,
        true,
      );
      assert.equal(screen.getByRole<HTMLButtonElement>("button", { name: "Submit rating" }).disabled, false);
    });
    assert.deepEqual(requests, ["/api/auth/session", "/api/auth/session"]);
    assert.equal(requests.filter(url => url === "/api/rater/vouchers").length, 0);
    assert.equal(
      requests.some(url => url.includes("/api/rater/commits")),
      false,
    );
    assertNoRecoveryMaterial(window.localStorage);

    await user.click(screen.getByRole("button", { name: "Submit rating" }));
    await waitFor(() => assert.ok(requests.includes("/api/rater/vouchers")), { timeout: 20_000 });
    assert.equal(requests.filter(url => url === "/api/rater/vouchers").length, 1);
    assert.equal(
      requests.some(url => url.includes("/api/rater/commits")),
      false,
    );

    const forecast = screen.getByRole("spinbutton", { name: /what percentage/iu });
    await screen.findByRole("alert");
    fireEvent.change(forecast, { target: { value: "91" } });
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Create recovery backup" })));
    assert.equal(screen.queryByRole("link", { name: "Download recovery backup" }), null);
    assert.equal(requests.filter(url => url === "/api/rater/vouchers").length, 1);
    assert.equal(
      requests.some(url => url.includes("/api/rater/commits")),
      false,
    );
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a reload before backup confirmation discards private preparation and safely restarts", async () => {
  const restoreDom = installTestDom();
  const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { PublicQuestionCard } = await import("./PublicQuestionCard");
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/auth/session") return Response.json(session(PRINCIPAL_A));
    throw new Error(`Unexpected request before backup confirmation: ${url}`);
  };

  try {
    render(
      <PublicQuestionCard
        task={task}
        paidAccess={{ state: "ready" }}
        onSubmitted={() => undefined}
        principalId="rlp_public_reviewer"
      />,
    );
    const screen = within(document.body);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Supported" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /what percentage/iu }), { target: { value: "73" } });
    await waitFor(() =>
      assert.equal(screen.getByRole<HTMLButtonElement>("button", { name: "Create recovery backup" }).disabled, false),
    );
    await user.click(screen.getByRole("button", { name: "Create recovery backup" }));
    await screen.findByRole("link", { name: "Download recovery backup" }, { timeout: 20_000 });

    cleanup();
    render(
      <PublicQuestionCard
        task={task}
        paidAccess={{ state: "ready" }}
        onSubmitted={() => undefined}
        principalId="rlp_public_reviewer"
      />,
    );
    await waitFor(() =>
      assert.equal(screen.getByRole<HTMLButtonElement>("button", { name: "Create recovery backup" }).disabled, false),
    );
    assert.equal(screen.getByRole<HTMLInputElement>("spinbutton", { name: /what percentage/iu }).value, "73");
    assert.equal(screen.queryByRole("link", { name: "Download recovery backup" }), null);
    assert.deepEqual(requests, ["/api/auth/session"]);
    assertNoRecoveryMaterial(window.localStorage);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("backup confirmation fails closed when the browser principal changes", async () => {
  const restoreDom = installTestDom();
  const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { PublicQuestionCard } = await import("./PublicQuestionCard");
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url !== "/api/auth/session") throw new Error(`Unexpected mutation for changed principal: ${url}`);
    return Response.json(session(requests.length === 1 ? PRINCIPAL_A : PRINCIPAL_B));
  };

  try {
    render(
      <PublicQuestionCard
        task={task}
        paidAccess={{ state: "ready" }}
        onSubmitted={() => undefined}
        principalId="rlp_public_reviewer"
      />,
    );
    const screen = within(document.body);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Supported" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /what percentage/iu }), { target: { value: "73" } });
    await waitFor(() =>
      assert.equal(screen.getByRole<HTMLButtonElement>("button", { name: "Create recovery backup" }).disabled, false),
    );
    await user.click(screen.getByRole("button", { name: "Create recovery backup" }));
    const download = await screen.findByRole("link", { name: "Download recovery backup" }, { timeout: 20_000 });
    download.addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent.click(download);
    await user.click(screen.getByRole("checkbox", { name: "I saved the recovery backup" }));

    await waitFor(() => assert.ok(screen.getByRole("alert").textContent?.includes("account changed")));
    await waitFor(() =>
      assert.equal(screen.getByRole<HTMLButtonElement>("button", { name: "Create recovery backup" }).disabled, false),
    );
    assert.equal(screen.queryByRole("link", { name: "Download recovery backup" }), null);
    assert.deepEqual(requests, ["/api/auth/session", "/api/auth/session"]);
    assertNoRecoveryMaterial(window.localStorage);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
