import React from "react";
import { UNIX_TIME_SERVER_SNAPSHOT, useUnixTime } from "./useUnixTime";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToString } = require("react-dom/server") as {
  renderToString: (element: React.ReactElement) => string;
};

function UnixTimeProbe() {
  return React.createElement("span", null, useUnixTime());
}

test("useUnixTime uses a deterministic server snapshot for hydration", () => {
  const originalNow = Date.now;

  try {
    Date.now = () => 1_234_500_000;
    const first = renderToString(React.createElement(UnixTimeProbe));

    Date.now = () => 9_876_500_000;
    const second = renderToString(React.createElement(UnixTimeProbe));

    assert.equal(first, `<span>${UNIX_TIME_SERVER_SNAPSHOT}</span>`);
    assert.equal(second, first);
  } finally {
    Date.now = originalNow;
  }
});
