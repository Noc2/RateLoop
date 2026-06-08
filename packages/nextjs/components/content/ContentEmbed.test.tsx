import React from "react";
import { ContentEmbed } from "./ContentEmbed";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

const uploadedImageUrl =
  "https://www.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("ContentEmbed renders uploaded question images as lightbox triggers when enabled", () => {
  const html = renderToStaticMarkup(
    <ContentEmbed url={uploadedImageUrl} title="Mockup" enableImageLightbox imageFit="contain" />,
  ).replace(/\s+/g, " ");

  assert.match(html, /<button/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /cursor-zoom-in/);
  assert.match(
    html,
    /src="https:\/\/www\.rateloop\.ai\/api\/attachments\/images\/att_abcdefghijklmnop\.webp#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/,
  );
  assert.doesNotMatch(html, /<a\b/);
});
