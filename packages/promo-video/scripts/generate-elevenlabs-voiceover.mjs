import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clips } from "./voiceover-clips.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageDir = join(rootDir, "packages/promo-video");
const audioDir = join(packageDir, "public/audio");
const envPath = join(rootDir, ".env.elevenlabs.local");

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

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  throw new Error("ELEVENLABS_API_KEY is missing. Add it to .env.elevenlabs.local or the shell environment.");
}

const model = process.env.PROMO_ELEVENLABS_MODEL ?? "eleven_multilingual_v2";
// "Brian" — warm, mid-deep American male from the ElevenLabs premade library.
// Run `npm run generate:elevenlabs-voiceover -- --list-voices` to browse alternatives.
const voiceId = process.env.PROMO_ELEVENLABS_VOICE_ID ?? "nPczCjzI2devNBz1zQrb";
const voiceSettings = {
  stability: Number(process.env.PROMO_ELEVENLABS_STABILITY ?? 0.4),
  similarity_boost: Number(process.env.PROMO_ELEVENLABS_SIMILARITY ?? 0.75),
  style: Number(process.env.PROMO_ELEVENLABS_STYLE ?? 0.25),
  use_speaker_boost: true,
};

const cliArgs = process.argv.slice(2);

if (cliArgs.includes("--list-voices")) {
  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs voice listing failed: ${response.status} ${response.statusText}`);
  }
  const { voices } = await response.json();
  for (const voice of voices) {
    const labels = Object.values(voice.labels ?? {}).join(", ");
    console.log(`${voice.voice_id}  ${voice.name}${labels ? `  (${labels})` : ""}`);
  }
  process.exit(0);
}

// Keep in sync with PROMO_FPS in src/RateLoopPromo.tsx.
const PROMO_FPS = 30;

// After conversion, report each clip's length in frames so voDurationInFrames
// in src/RateLoopPromo.tsx can be updated to keep the music ducking aligned.
const measureFrames = m4aPath => {
  const info = spawnSync("afinfo", [m4aPath], { encoding: "utf8" });
  const match = info.stdout?.match(/estimated duration:\s*([\d.]+)\s*sec/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return { seconds, frames: Math.ceil(seconds * PROMO_FPS) };
};

mkdirSync(audioDir, { recursive: true });

const selectedClipNames = new Set(cliArgs.filter(arg => !arg.startsWith("--")));
const clipsToGenerate = selectedClipNames.size ? clips.filter(clip => selectedClipNames.has(clip.name)) : clips;
const unknownClipNames = [...selectedClipNames].filter(name => !clips.some(clip => clip.name === name));

if (unknownClipNames.length) {
  throw new Error(`Unknown voiceover clip(s): ${unknownClipNames.join(", ")}`);
}

const measurements = [];

for (const clip of clipsToGenerate) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: model,
        text: clip.text,
        voice_settings: voiceSettings,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs TTS failed for ${clip.name}: ${response.status} ${response.statusText}\n${body}`);
  }

  const mp3Path = join(tmpdir(), `${clip.name}-${process.pid}.mp3`);
  const m4aPath = join(audioDir, `${clip.name}.m4a`);
  writeFileSync(mp3Path, Buffer.from(await response.arrayBuffer()));

  const result = spawnSync("afconvert", ["-f", "m4af", "-d", "aac", "-q", "127", mp3Path, m4aPath], {
    stdio: "inherit",
  });
  rmSync(mp3Path, { force: true });

  if (result.status !== 0) {
    throw new Error(`afconvert failed for ${clip.name} with exit code ${result.status}`);
  }

  const measured = measureFrames(m4aPath);
  measurements.push({ name: clip.name, measured });
  console.log(`Generated ${clip.name}.m4a with ${model}/${voiceId}`);
}

if (measurements.length) {
  console.log("\nMeasured VO durations — update voDurationInFrames in src/RateLoopPromo.tsx:");
  for (const { name, measured } of measurements) {
    if (!measured) {
      console.log(`  ${name.padEnd(14)} (could not measure — check afinfo)`);
      continue;
    }
    console.log(`  ${name.padEnd(14)} ${String(measured.frames).padStart(4)} frames  (${measured.seconds.toFixed(2)}s)`);
  }
}
