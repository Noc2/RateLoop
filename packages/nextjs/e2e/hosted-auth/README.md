# Hosted authentication harness

This harness provisions three isolated Playwright contexts through RateLoop's
real hosted email-OTP sign-in UI:

- one workspace owner;
- reviewer one;
- reviewer two.

The two reviewers are required because private invited panels have a minimum
size of two and routing requires distinct eligible principals. The harness
does not insert identities or sessions into Postgres and does not call a test
authentication endpoint.

Set every required variable before creating the harness:

```text
E2E_BASE_URL=https://rateloop-tokenless.vercel.app
TOKENLESS_E2E_OWNER_EMAIL=<dedicated owner receiving mailbox>
TOKENLESS_E2E_REVIEWER_ONE_EMAIL=<dedicated reviewer-one receiving mailbox>
TOKENLESS_E2E_REVIEWER_TWO_EMAIL=<dedicated reviewer-two receiving mailbox>
TOKENLESS_E2E_OTP_FROM_EMAIL=<bare address configured by RESEND_FROM_EMAIL>
TOKENLESS_E2E_INBOX_PROVIDER=resend
TOKENLESS_E2E_RESEND_RECEIVING_API_KEY=<server-side receiving API key>
```

Optional polling and output variables are:

```text
TOKENLESS_E2E_INBOX_POLL_INTERVAL_MS=2000
TOKENLESS_E2E_INBOX_POLL_TIMEOUT_MS=90000
```

The recipient mailboxes must be distinct dedicated addresses. Plus-addresses,
case-only duplicates, and Gmail/Googlemail dot aliases are rejected before any
request. Run this harness serially: a concurrent OTP request for the same
mailbox is intentionally treated as ambiguous and fails closed.

Use it from a hosted Playwright setup or spec:

```ts
import { HostedAuthHarness } from "./hosted-auth/harness";
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const auth = await HostedAuthHarness.create(browser);
try {
  await auth.signInAll();
  const owner = auth.context("owner");
  const reviewerOne = auth.context("reviewerOne");
  const reviewerTwo = auth.context("reviewerTwo");
  // Exercise hosted owner/reviewer flows with the three isolated contexts.
} finally {
  await auth.cleanup();
  await browser.close();
}
```

All three authenticated states stay only in their in-memory browser contexts.
`cleanup()` signs out each established RateLoop session and closes all
contexts. Never print the returned OTP, receiving API key, mailbox values, or
browser state.

## Release-run ownership and cleanup

`e2e/hosted/core-journey.spec.ts` is the only hosted release test allowed to
create review responses. It uses the three dedicated synthetic identities
above, creates a new isolated workspace for each run, and records its random
run suffix in the workspace name so an interrupted run can be identified.
Smoke tests are read-only and must never reuse these accounts to mutate hosted
state.

The core journey disconnects its agent integration, requests workspace
deletion, signs every account out, and closes all browser contexts from a
`finally` block. Workspace deletion is asynchronous; evidence integrity and
audit records can remain for their configured retention period even after the
workspace is no longer active. This is expected retention, not a reusable test
fixture. Runtime fixtures must remain disabled in the hosted environment.

If cleanup reports a failure, find the workspace whose name starts with
`Hosted E2E` and the run suffix from the safe Playwright result attachment,
confirm that no concurrent release run is active, then use the normal workspace
deletion control. Do not delete records directly from Postgres. Dedicated
mailboxes may be reused only after the previous run has signed out or its
sessions have expired.

Run the full guarded release journey from the repository checkout with:

```sh
yarn next:e2e:hosted:release
```

The command refuses any branch other than `tokenless`, requires
`E2E_EXPECTED_GIT_SHA` to match the checkout, then runs hosted preflight,
read-only smoke, and the single-worker mutating core journey in order. It stops
at the first failed boundary.
