import React from "react";
import { RatingOrb } from "./RatingOrb";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("RatingOrb uses a white score over the neutral center", () => {
  const html = renderToStaticMarkup(<RatingOrb rating={0} size={96} />).replace(/\s+/g, " ");

  assert.match(html, /--curyo-warm-white/);
  assert.doesNotMatch(html, /text-black/);
  assert.doesNotMatch(html, /text-base-content/);
  assert.doesNotMatch(html, /text-primary/);
  assert.match(html, /stop-color="var\(--curyo-surface-nested\)"/);
});

test("RatingOrb defines the RateLoop gradient for the progress flare", () => {
  const html = renderToStaticMarkup(<RatingOrb rating={50} size={96} />).replace(/\s+/g, " ");

  assert.match(html, /<linearGradient id="[^"]+-progress-gradient" x1="0%" y1="50%" x2="100%" y2="50%">/);
  assert.match(html, /stop-color="var\(--rateloop-blue\)"/);
  assert.match(html, /stop-color="var\(--rateloop-green\)"/);
  assert.match(html, /stop-color="var\(--rateloop-yellow\)"/);
  assert.match(html, /stop-color="var\(--rateloop-pink\)"/);
});

test("RatingOrb omits a fallback outer track when no progress is visible", () => {
  const html = renderToStaticMarkup(<RatingOrb rating={0} size={96} />).replace(/\s+/g, " ");

  assert.doesNotMatch(html, /stroke="#ffffff"/);
  assert.doesNotMatch(html, /rgba\(245,245,245,0\.06\)/);
  assert.doesNotMatch(html, /rgba\(179,52,27,0\.2\)/);
});
