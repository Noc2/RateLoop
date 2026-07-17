# Tokenless UI consistency plan

Date: 2026-07-17

## Audit scope

This audit covers the public shell, signed-out entry gates, account sign-in, and landing hero on the `tokenless` product line. It compares the current implementation with the live desktop routes and the supplied screenshots.

## Findings

1. The navbar sign-in action is the correct baseline: a compact 40 px action with a spectrum border, 16 px label, and content-sized width.
2. Agent, profile, and settings gates already use the shared `SignInSurface`, but each route assembles its own action row.
3. Human Discover bypasses `SignInSurface`. Its card expands to the 1024 px feed width and its sign-in action becomes 320 by 48 px, so the same destination looks like a different control.
4. `ThirdwebSessionButton` changes height, typography, and width between its compact and default signed-out variants. Layout context should control width; the sign-in treatment itself should not change.
5. Agent docs uses a one-off outline button instead of the shared secondary action primitive.
6. The real `/sign-in` form is a different interaction pattern. Its submit actions should remain full-width; only links that lead to sign-in should match the navbar action.
7. The recent orb fallback changed the established hero from animated uniform circles to pre-distorted ellipses. The resulting shape is visually heavier and should return to the pre-`2320914c9` animation.

## Decisions

- Use one canonical signed-out gate with the same card width, padding, title rhythm, description contrast, preview slot, and action row.
- Support page-centered and embedded placement without changing the card itself.
- Render every sign-in entry link with the navbar treatment. Allow a container to stretch it on small screens without changing height or typography.
- Use the shared secondary button primitive for adjacent actions.
- Keep concise, route-specific titles and descriptions. Do not add permanent helper copy merely to make screens look similar.
- Restore the prior hero animation exactly; keep the current landing copy and CTA order.

## Commit plan

1. `docs: record tokenless UI consistency plan`
2. `landing: restore the established hero orb`
3. `auth-ui: unify signed-out gate primitives`
4. `auth-ui: align agent and account entry gates`
5. `human-ui: align the discover sign-in gate`
6. `test: lock signed-out UI consistency`

Each implementation commit must pass its targeted tests. The finished series must pass app tests, type checking, linting, production build, accessibility checks, and browser journeys before the guarded `tokenless` push and isolated Vercel deployment.
