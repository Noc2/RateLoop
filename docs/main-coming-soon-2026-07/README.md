# RateLoop main-site coming-soon package

Status: **design and rollout plan only**. This package does not change either live site.

The recommended direction replaces the legacy `main` landing experience with one focused message:

> **RateLoop will relaunch.**
>
> We’re preparing RateLoop for its next chapter. Thank you to everyone who contributed, tested early ideas, and shared
> thoughtful feedback. You helped shape what comes next.

It keeps the current site recognizable through its black canvas, compact brand rail, Space Grotesk display type,
four-color spectrum, and existing animated orb. Product navigation, wallet controls, pricing, search, and other
actions that no longer help with the placeholder’s one task are removed.

## Package contents

- [`design-and-copy.md`](design-and-copy.md): recommended layout, copy, visual rules, alternatives, and accessibility
  behavior.
- [`integration-plan.md`](integration-plan.md): main-branch implementation, route safety, verification, release, and
  rollback.
- [`announcement.md`](announcement.md): X announcement copy, publishing order, and image alt text.
- [`mockups/coming-soon.html`](mockups/coming-soon.html): responsive, self-contained animated page mock-up.
- [`mockups/coming-soon-desktop.png`](mockups/coming-soon-desktop.png): 1440 × 900 desktop reference.
- [`mockups/coming-soon-mobile.png`](mockups/coming-soon-mobile.png): 390 × 844 mobile reference.
- [`mockups/x-announcement-card.html`](mockups/x-announcement-card.html): self-contained 16:9 social-card source.
- [`mockups/x-announcement-card.png`](mockups/x-announcement-card.png): 1600 × 900 announcement image.
- [`mockups/concept-orb-layout.png`](mockups/concept-orb-layout.png): exploratory image-generation concept.
- [`mockups/README.md`](mockups/README.md): rendering notes and the image-generation prompt.

## Decision needed before implementation

Replacing the front page and disabling the legacy service are different decisions. The `main` deployment also hosts
APIs, callbacks, webhooks, cron jobs, and recovery/claim flows. The recommended default is therefore:

1. replace `/` with the placeholder;
2. keep legal and operational routes available;
3. stop or redirect other browser journeys only after approving the route-disposition table in the integration plan.

The live implementation must be created later from a clean worktree based on `origin/main` and linked to the legacy
`rate-loop-nextjs` Vercel project. The current checkout and its Vercel links are isolated to `rateloop-tokenless` and
must not be used to deploy `rateloop.ai`.
