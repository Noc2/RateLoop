import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clips } from "./voiceover-clips.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageDir = join(rootDir, "packages/promo-video");
const audioDir = join(packageDir, "public/audio");
const envPath = join(rootDir, ".env.openai.local");

const loadEnvFile = path => {
  try {
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const rawValue = trimmed.slice(eq + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Environment variables may already be provided by the shell.
  }
};

loadEnvFile(envPath);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is missing. Add it to .env.openai.local or the shell environment.");
}

const model = process.env.PROMO_OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const voice = process.env.PROMO_OPENAI_TTS_VOICE ?? "marin";
const responseFormat = "wav";
const instructions =
  "Warm, human founder voice for a premium SaaS product video. Conversational and lightly excited, " +
  "with natural pauses, subtle breath, and a slight smile. Do not sound like an announcer, robot, " +
  "crypto trailer, corporate training video, or radio ad. Keep the pacing crisp enough for a 66 second video.";

mkdirSync(audioDir, { recursive: true });

const selectedClipNames = new Set(process.argv.slice(2));
const clipsToGenerate = selectedClipNames.size ? clips.filter(clip => selectedClipNames.has(clip.name)) : clips;
const unknownClipNames = [...selectedClipNames].filter(name => !clips.some(clip => clip.name === name));

if (unknownClipNames.length) {
  throw new Error(`Unknown voiceover clip(s): ${unknownClipNames.join(", ")}`);
}

for (const clip of clipsToGenerate) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: clip.text,
      instructions,
      response_format: responseFormat,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI TTS failed for ${clip.name}: ${response.status} ${response.statusText}\n${body}`);
  }

  const wavPath = join(tmpdir(), `${clip.name}-${process.pid}.wav`);
  const m4aPath = join(audioDir, `${clip.name}.m4a`);
  writeFileSync(wavPath, Buffer.from(await response.arrayBuffer()));

  const result = spawnSync("afconvert", ["-f", "m4af", "-d", "aac", "-q", "127", wavPath, m4aPath], {
    stdio: "inherit",
  });
  rmSync(wavPath, { force: true });

  if (result.status !== 0) {
    throw new Error(`afconvert failed for ${clip.name} with exit code ${result.status}`);
  }

  console.log(`Generated ${clip.name}.m4a with ${model}/${voice}`);
}
