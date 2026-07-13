import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clips, formatClipsAsTsv } from "./voiceover-clips.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

test("promo voiceover generators share the same clip source", () => {
  assert.deepEqual(
    clips.map(clip => clip.name),
    [
      "vo-01-hook",
      "vo-02-ask",
      "vo-03-handoff",
      "vo-04-raters",
      "vo-05-settle",
      "vo-06-report",
      "vo-07-outro",
    ],
  );

  const elevenlabsGenerator = readFileSync(join(scriptsDir, "generate-elevenlabs-voiceover.mjs"), "utf8");
  const openaiGenerator = readFileSync(join(scriptsDir, "generate-openai-voiceover.mjs"), "utf8");
  const offlineGenerator = readFileSync(join(scriptsDir, "generate-voiceover.zsh"), "utf8");

  assert.match(elevenlabsGenerator, /import \{ clips \} from "\.\/voiceover-clips\.mjs";/);
  assert.doesNotMatch(elevenlabsGenerator, /const clips = \[/);
  assert.match(openaiGenerator, /import \{ clips \} from "\.\/voiceover-clips\.mjs";/);
  assert.doesNotMatch(openaiGenerator, /const clips = \[/);
  assert.match(offlineGenerator, /voiceover-clips\.mjs" --tsv/);
  assert.doesNotMatch(offlineGenerator, /one sharp RateLoop question/);
  assert.doesNotMatch(offlineGenerator, /Verified humans rate it blind/);
});

test("voiceover clip CLI emits the shared clips as TSV", () => {
  const result = spawnSync(process.execPath, [join(scriptsDir, "voiceover-clips.mjs"), "--tsv"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, formatClipsAsTsv());
  assert.equal(result.stdout.trimEnd().split("\n").length, clips.length);
  assert.match(result.stdout, /^vo-02-ask\tThat's where RateLoop comes in:/m);
  assert.doesNotMatch(result.stdout, /LREP|stake|staking|reputation|token/i);
  assert.match(result.stdout, /submit it sealed/i);
  assert.match(result.stdout, /earns USDC/i);
});
