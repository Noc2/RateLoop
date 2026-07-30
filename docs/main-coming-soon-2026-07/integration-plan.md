# Main-site integration and release plan

## Scope boundary

This document is stored on `tokenless`, but the future website change belongs exclusively to `main` and the legacy
`rate-loop-nextjs` Vercel project.

Do not implement or deploy the live placeholder from the current tokenless checkout. Its root and
`packages/nextjs/.vercel/project.json` links identify the isolated `rateloop-tokenless` project
(`prj_H6C2pfWKEAupFroHbLfzhquaNCLm`). A future implementation must start in a clean worktree from the latest
`origin/main`, use a separate branch such as `codex/main-coming-soon`, and verify the legacy project link before any
preview or production operation.

## Why this is not only a headline replacement

On `origin/main`, the root page:

- fetches Ponder statistics every 300 seconds;
- is wrapped in public providers for wallets, terms, and funding;
- inherits a shell containing beta, search, navigation, referral, and wallet behavior; and
- shares its Next.js deployment with APIs, OAuth and well-known endpoints, callbacks, webhooks, recovery/claim flows,
  social images, and six Vercel cron routes.

A copy-only edit would leave obsolete actions, claims, and backend dependencies visible. Conversely, a broad redirect
could accidentally replace JSON/API responses with HTML or interrupt work that still has a terminal obligation.

## Phase 1: approve route disposition

Before coding, record an explicit decision for each group:

| Route group                                                            | Recommended default                                              | Decision owner        |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------- |
| `/`                                                                    | Render the coming-soon page                                      | Product               |
| Legal pages                                                            | Keep available                                                   | Product/legal         |
| Existing claim, reveal, recovery, handoff, and signing journeys        | Keep available until obligations are audited                     | Engineering/legal     |
| Browser pages that initiate new work                                   | Decide individually: keep, redirect, or return maintenance state | Product/engineering   |
| `/api/**`                                                              | Preserve; never redirect to HTML                                 | Engineering           |
| Cron and webhook routes                                                | Preserve and monitor                                             | Engineering           |
| OAuth callbacks and `/.well-known/**`                                  | Preserve unless the integration is formally retired              | Engineering           |
| `/_next/**`, images, icons, OG routes, `robots.txt`, and `sitemap.xml` | Preserve with correct content types                              | Engineering/marketing |

If an API is intentionally paused, return an explicit JSON `503` response with a useful error code and
`Retry-After`. Do not send an API consumer to the placeholder.

The safe first release changes only the front door while leaving operational routes intact.

## Phase 2: implement on a clean main worktree

1. Fetch the latest `origin/main`.
2. Create a clean `codex/main-coming-soon` branch/worktree from that SHA.
3. Confirm that neither the worktree nor its commits modify `tokenless`.
4. Create a lean route group, for example:

   ```text
   packages/nextjs/app/(coming-soon)/layout.tsx
   packages/nextjs/app/(coming-soon)/page.tsx
   ```

5. Inherit only the root fonts, global visual tokens, CSP behavior, `RateLoopLogo`, and `OrbAnimation`.
6. Do not mount the legacy `PublicShell`, wallet/funding/terms providers, beta banner, search, referral capture, or Ponder
   query on `/`.
7. Implement the exact approved copy and only the justified X, GitHub, Privacy, and Imprint links.
8. Keep the orb decorative and static under reduced motion.
9. Give `/` page-specific metadata such as:

   ```text
   Title: RateLoop — Relaunching
   Description: RateLoop is preparing for its next chapter. Thank you to everyone who contributed and shared feedback.
   ```

10. Replace or version the social image so X does not continue to cache the former homepage card.
11. Align `manifest.json`, `robots.txt`, and `sitemap.xml` with the approved route-disposition table.

If browser routing is gated, define the policy once in an edge-safe helper and import it from middleware and its
tests. Do not re-derive the allow/redirect rule in multiple places. The invariant test must import all consumers
together and cover representative browser, legal, operational, API, well-known, and static-asset boundaries.

## Phase 3: verify

Update existing main-branch tests that assume the former homepage, including landing, smoke, responsive, accessibility,
browser-compatibility, and discovery-file coverage.

Required assertions:

- exact relaunch and contributor/feedback copy;
- one meaningful `h1`;
- no legacy start, ask, connect-wallet, search, pricing, beta, Ponder, or promo-video surface on `/`;
- all retained operational routes keep their expected status and content type;
- APIs never receive an HTML redirect;
- legal links remain reachable;
- static and reduced-motion orb states both work;
- correct title, description, Open Graph, and X metadata;
- no horizontal overflow at 320, 390, 768, 1024, 1280, and 1536 pixels;
- keyboard access, visible focus, and no blocking axe violations;
- no browser console errors or failed wallet/Ponder requests on the placeholder.

Run at minimum from the clean main worktree:

```sh
yarn workspace @rateloop/nextjs test
yarn workspace @rateloop/nextjs lint --max-warnings=0
yarn workspace @rateloop/nextjs check-types
yarn workspace @rateloop/nextjs build
yarn workspace @rateloop/nextjs e2e:ci:smoke
yarn workspace @rateloop/nextjs e2e:responsive
yarn workspace @rateloop/nextjs e2e:a11y
yarn workspace @rateloop/nextjs e2e:compat
```

Keep implementation concerns separate, for example:

1. `feat(nextjs): add RateLoop relaunch placeholder`
2. `chore(web): align maintenance routing and discovery`

## Phase 4: preview and production

1. Verify the clean main worktree’s `.vercel/project.json` and package-level link identify `rate-loop-nextjs`, and
   record the actual legacy project ID. Abort if either identifies `rateloop-tokenless`.
2. Record remote SHAs for `main` and `tokenless`.
3. Record the deployment ID currently serving `https://www.rateloop.ai`.
4. Record the deployment serving `https://rateloop-tokenless.vercel.app/rate`.
5. Deploy a preview only to the legacy project.
6. Verify desktop, mobile, reduced motion, metadata/social card, legal pages, route disposition, APIs, callbacks,
   webhooks, and cron health.
7. Confirm whether Vercel’s Git integration deploys `main` automatically. Use one production mechanism, not an
   automatic merge deployment plus a manual promotion.
8. Merge or promote during a monitored window.
9. Verify both apex and `www`, response headers, social image, legal pages, and every retained operational route.
10. Confirm the tokenless branch SHA, tokenless deployment ID, and tokenless review URL did not move.
11. Observe a short quiet period, then publish the X announcement.

Do not announce before the production alias and social preview are verified.

## Rollback

Rollback triggers include:

- wrong Vercel project or domain;
- any movement of the tokenless deployment;
- API, cron, callback, webhook, claim, or recovery interception;
- CSP or asset failures;
- sustained 5xx responses;
- unreadable or horizontally scrolling mobile layout; or
- stale or inaccurate public claims.

Rollback sequence:

1. Promote the recorded prior `rate-loop-nextjs` deployment only.
2. Verify `rateloop.ai`, retained operational endpoints, and legal pages.
3. Confirm tokenless state remains unchanged.
4. Revert the main placeholder commits with `git revert`; do not reset or force-push.
5. If the announcement was published, unpin it and post a concise correction if visitors could have been misled.
