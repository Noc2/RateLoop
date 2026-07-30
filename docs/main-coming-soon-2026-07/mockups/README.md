# Mock-up notes

## Final references

- `coming-soon.html` is the implementation reference. It is self-contained, responsive, keyboard accessible, and
  includes a CSS-only approximation of the current 30-ellipse hero motion.
- `coming-soon-desktop.png` is captured at 1440 × 900.
- `coming-soon-mobile.png` is captured at 390 × 844.
- `x-announcement-card.html` is the exact-text source for the 16:9 announcement asset.
- `x-announcement-card.png` is captured at 1600 × 900.

The HTML files use system font fallbacks when opened directly. The live implementation should use the already
configured Space Grotesk and Inter fonts through the main app’s root layout.

`concept-orb-layout.png` is an exploratory concept produced with the built-in image-generation workflow. It helped
confirm the split-copy/orb composition, but the deterministic HTML and screenshots are the source of truth for text,
links, footer year, spacing, and accessibility.

## Image-generation prompt

The exploratory concept used the current full landing screenshot as a design-system reference and the following
prompt:

```text
Use case: ui-mockup
Asset type: high-fidelity desktop website concept, 16:9 viewport
Primary request: Create a new RateLoop coming-soon homepage concept based on the supplied current-site screenshot.
Input images: Image 1 is a design-system reference only; do not reproduce its long-page content.
Scene/backdrop: A single above-the-fold desktop web page on near-black #0a0a0a.
Subject: Preserve the fixed black left rail with the circular spectrum RateLoop mark, RateLoop wordmark, and “Human
Assurance” tagline. In the main area, place a restrained animated-orb-inspired field of thin concentric/deformed
ellipse lines on the right. On the left, show the exact copy below.
Style/medium: polished production UI mockup, faithful to the existing RateLoop website, no browser chrome.
Composition/framing: 1440×900-like desktop viewport; compact 208px left rail; generous negative space; headline left,
orb right; small footer legal links.
Lighting/mood: calm, appreciative, forward-looking, precise.
Color palette: #0a0a0a, warm white #f5f5f5, muted #a3a3a3, spectrum accents #359EEE #03CEA4 #FFC43D #EF476F.
Text (verbatim): “COMING SOON” / “RateLoop will relaunch.” / “We’re preparing the next chapter of the project. Thank
you to everyone who contributed, tested early ideas, and shared thoughtful feedback. You helped shape what comes
next.” / “Follow the relaunch” / “We’ll share more when it’s ready.”
Constraints: Use the current site’s bold display typography, spectrum-gradient word treatment, thin borders, 8px
corners, and economical layout. Keep the orb behind/right of content, decorative and non-obscuring. Ensure all exact
text is legible.
Avoid: extra product claims, dates, countdowns, waitlist/email form, pricing, cards, fake testimonials, photography,
glassmorphism, gradients outside the established spectrum, excessive navigation, magenta screen blocks, watermarks.
```

Built-in image generation was used; no CLI or API fallback was used.
