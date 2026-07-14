import React from "react";
import { QuestionMedia } from "./QuestionMedia";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};
(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("image context renders only same-origin moderated asset routes with meaningful alternatives", () => {
  const html = renderToStaticMarkup(
    <QuestionMedia
      media={{
        kind: "images",
        items: [
          {
            alt: "Mobile checkout confirmation",
            assetId: `pqm_${"A".repeat(24)}`,
            digest: `sha256:${"ab".repeat(32)}`,
          },
        ],
      }}
    />,
  );

  assert.match(html, /\/api\/public-media\/images\/pqm_/);
  assert.match(html, /alt="Mobile checkout confirmation"/);
  assert.match(html, /aria-label="Open image 1: Mobile checkout confirmation"/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("YouTube context is click-to-load and starts without a third-party request", () => {
  const html = renderToStaticMarkup(<QuestionMedia media={{ kind: "youtube", videoId: "dQw4w9WgXcQ" }} />);

  assert.match(html, /Load YouTube video/);
  assert.doesNotMatch(html, /iframe|youtube-nocookie/);
});
