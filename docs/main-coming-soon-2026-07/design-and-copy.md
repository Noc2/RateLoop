# Coming-soon design and copy

## Recommended direction: The next chapter

Use a simplified version of the current split hero. The message occupies the left half of the viewport and the
existing RateLoop orb remains oversized on the right. On desktop, a compact fixed rail carries only the brand and
durable project/legal links. On mobile, that rail becomes the current compact header pattern and the orb moves below
the copy.

This direction is immediately recognizable as RateLoop without making the placeholder behave like the old product.
The moving loop also supports the relaunch idea without adding a new metaphor or illustration.

## Final page copy

**Brand subtitle**

> Coming soon

**Eyebrow**

> COMING SOON

**Headline**

> RateLoop will relaunch.

Apply the established spectrum gradient to “relaunch.”

**Body**

> We’re preparing RateLoop for its next chapter. Thank you to everyone who contributed, tested early ideas, and
> shared thoughtful feedback. You helped shape what comes next.

**Primary link**

> Follow the relaunch

Target: `https://x.com/RateLoop`

**Secondary link**

> View the project

Target: `https://github.com/Noc2/RateLoop`

**Status**

> We’ll share more when it’s ready.

Do not add a date, countdown, email form, “join the waitlist” action, or a product promise until the corresponding
date, subscription operation, or release scope is real and approved.

## Visual system

The implementation should reuse existing `main` primitives wherever they are free of obsolete product behavior:

| Element      | Specification                                  | Existing reference                                           |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------ |
| Canvas       | Pure black `#000000`                           | `packages/nextjs/styles/globals.css` on `main`               |
| Text         | Warm white `#F5F5F5`; secondary copy at 68–72% | Existing global tokens                                       |
| Spectrum     | `#359EEE` → `#03CEA4` → `#FFC43D` → `#EF476F`  | Logo and `--rateloop-spectrum-gradient`                      |
| Display type | Space Grotesk 700, line-height near 1          | Root layout and `.hero-headline`                             |
| Body type    | Inter 400/600                                  | Root layout                                                  |
| Corners      | `0.5rem`                                       | Existing controls and surfaces                               |
| Dividers     | White at 10–14% opacity                        | Existing shell borders                                       |
| Orb          | Existing 30-ellipse `OrbAnimation`             | `packages/nextjs/components/home/OrbAnimation.tsx` on `main` |
| Logo         | Existing `RateLoopLogo` and SVG                | `packages/nextjs/components/RateLoopLogo.tsx`                |

The current orb already lazy-loads GSAP, starts near the viewport, and checks `prefers-reduced-motion`. Reuse that
component unchanged and retain its third-party notice. The HTML mock-up uses a dependency-free CSS approximation so it
can be opened directly from this documentation folder.

## Desktop layout

- Viewport reference: 1440 × 900.
- Fixed rail: 13rem wide, black, one subtle right border and shadow.
- Rail top: logo, “RateLoop,” and “Coming soon.”
- Rail bottom: X, GitHub, Privacy, and Imprint.
- Content region: maximum width about 74rem with 4–4.5rem outer padding.
- Headline: approximately 5–6.2rem, left aligned, maximum 10 characters per line.
- Orb: 58–68rem, absolutely positioned beyond the right edge so it remains atmospheric.
- Primary path: one visible gradient-border link to X. GitHub remains a quieter text link.

Do not keep search, wallet/session controls, the beta banner, pricing, app navigation, or product CTAs. They compete
with the only useful action and imply that the old product remains active.

## Mobile layout

- Viewport reference: 390 × 844, with checks down to 320px.
- Sticky 4.5rem header: compact logo/brand at left and “Follow on X” at right.
- Centered copy with a 3.05–4rem headline.
- Full-width primary link, followed by the GitHub text link.
- Orb below the message at roughly 150% of the content width and cropped by the viewport.
- GitHub, Privacy, and Imprint remain visible in a compact footer.

There should be no menu: the placeholder has too few justified destinations to require one.

## Motion and accessibility

- Treat the orb as decorative with `aria-hidden="true"`.
- Preserve a visible static orb when the user prefers reduced motion; do not remove the visual entirely.
- Keep exactly one `h1`.
- Maintain a skip link and visible keyboard focus for all links.
- Use real anchor elements, not clickable containers.
- The gradient headline must remain legible if background clipping is unavailable.
- Do not place text over the high-contrast part of the orb.
- Verify no horizontal overflow at 320, 390, 768, 1024, 1280, and 1536 pixels.
- Use concise image alt text when the social card is posted:

  > RateLoop logo beside the words “RateLoop will relaunch,” with a multicolor loop on a black background.

## Alternatives considered

### Closing this loop

Headline:

> Closing this loop. Opening the next.

Place the orb behind or directly above the headline. This is more cinematic and works well as campaign art, but it is
less direct than the recommended relaunch statement.

### Built with your feedback

Headline:

> Built with your feedback. Returning soon.

Use a smaller orb and a four-color vertical rule beside the message. This is warmer and contributor-led, but it makes
the current status less immediate.

The recommended direction combines the clarity of a status page with the visual continuity of the existing website.
