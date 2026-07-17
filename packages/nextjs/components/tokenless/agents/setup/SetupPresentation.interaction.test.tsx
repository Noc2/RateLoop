import React from "react";
import { Button } from "../../ui/Button";
import { AgentSetupProgress } from "./AgentSetupProgress";
import { SetupActionBar } from "./SetupActionBar";
import { SetupChoiceGroup, SetupRadioChoice } from "./SetupChoiceGroup";
import { SetupStageHeader } from "./SetupStageHeader";
import axe from "axe-core";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

const actionBarSource = readFileSync(new URL("./SetupActionBar.tsx", import.meta.url), "utf8");
const choiceGroupSource = readFileSync(new URL("./SetupChoiceGroup.tsx", import.meta.url), "utf8");
const globalsSource = readFileSync(new URL("../../../../styles/globals.css", import.meta.url), "utf8");
const progressSource = readFileSync(new URL("./AgentSetupProgress.tsx", import.meta.url), "utf8");
const stageHeaderSource = readFileSync(new URL("./SetupStageHeader.tsx", import.meta.url), "utf8");

test("setup uses the homepage palette in its canonical order", () => {
  const homepageColors = [
    ["--rateloop-blue", "#359eee"],
    ["--rateloop-green", "#03cea4"],
    ["--rateloop-yellow", "#ffc43d"],
    ["--rateloop-pink", "#ef476f"],
  ] as const;

  for (const [token, value] of homepageColors) {
    assert.match(globalsSource, new RegExp(`${token}: ${value}`));
  }
  assert.match(
    globalsSource,
    /--rateloop-spectrum-gradient:\s*linear-gradient\(\s*90deg,\s*var\(--rateloop-blue\),\s*var\(--rateloop-green\),\s*var\(--rateloop-yellow\),\s*var\(--rateloop-pink\)\s*\)/,
  );
  const stageColors = ["blue", "green", "yellow", "pink"];
  let previousIndex = -1;
  for (const color of stageColors) {
    const index = progressSource.indexOf(`color: "var(--rateloop-${color})"`);
    assert.ok(index > previousIndex, `${color} should follow the homepage spectrum order`);
    previousIndex = index;
  }
  assert.match(progressSource, /people:[\s\S]*color: "var\(--rateloop-warm-white\)"/);
  assert.doesNotMatch(progressSource, /#[\da-f]{3,8}/iu);
});

test("setup primitives retain compact responsive behavior", () => {
  assert.match(progressSource, /grid grid-cols-5/);
  assert.match(progressSource, /hidden font-mono text-xs sm:block/);
  assert.match(stageHeaderSource, /text-3xl[\s\S]*sm:text-4xl/);
  assert.match(actionBarSource, /flex flex-col/);
  assert.match(actionBarSource, /sm:flex-row/);
  assert.match(actionBarSource, /sm:justify-end/);
  assert.match(choiceGroupSource, /min-h-16/);
  assert.match(choiceGroupSource, /overflow-hidden/);
});

test("shared setup presentation passes a rendered semantic audit", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const markup = renderToStaticMarkup(
    <main>
      <AgentSetupProgress
        currentStep="reviews"
        stages={[
          { key: "workspace", status: "complete" },
          { key: "connect", status: "complete" },
          { key: "agent", status: "complete" },
          { key: "reviews", status: "current" },
          { key: "people", status: "not_started" },
        ]}
        onNavigate={() => undefined}
      />
      <form>
        <SetupStageHeader
          step="reviews"
          title="Set review behavior"
          description="Choose when this workflow needs human review."
        />
        <fieldset>
          <legend>Review frequency</legend>
          <SetupChoiceGroup>
            <SetupRadioChoice
              id="adaptive"
              name="frequency"
              value="adaptive"
              label="Adaptive"
              description="Learns from review results."
              badge="Recommended"
              checked
              onChange={() => undefined}
            />
            <SetupRadioChoice
              id="always"
              name="frequency"
              value="always"
              label="Every output"
              description="Reviews every eligible output."
              checked={false}
              onChange={() => undefined}
            />
          </SetupChoiceGroup>
        </fieldset>
        <SetupActionBar>
          <Button variant="secondary">Back</Button>
          <Button type="submit">Continue</Button>
        </SetupActionBar>
      </form>
    </main>,
  );
  const dom = new JSDOM(
    `<!doctype html><html lang="en"><head><title>Setup</title></head><body>${markup}</body></html>`,
    {
      runScripts: "outside-only",
    },
  );
  dom.window.eval(axe.source);
  const browserAxe = (dom.window as unknown as { axe: typeof axe }).axe;
  const result = await browserAxe.run(dom.window.document, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
    },
  });
  assert.equal(
    result.violations.length,
    0,
    JSON.stringify(result.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.length }))),
  );
  dom.window.close();
});
