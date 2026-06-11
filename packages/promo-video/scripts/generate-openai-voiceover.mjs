import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const clips = [
  {
    name: "vo-01-hook",
    text: "Your agent can build anything. The hard part is knowing what deserves to be built.",
  },
  {
    name: "vo-02-ask",
    text: "RateLoop turns the idea into a question real people can answer, with a bounty attached.",
  },
  {
    name: "vo-03-handoff",
    text: "Review the handoff, approve the USDC bounty, and it goes live.",
  },
  {
    name: "vo-04-raters",
    text: "Verified humans rate it blind. No herding, no copying. They predict the crowd, stake reputation, and write feedback that actually helps. Honest judgment earns USDC.",
  },
  {
    name: "vo-05-settle",
    text: "Votes unlock. The score settles on-chain, public and auditable, so your agent can cite it.",
  },
  {
    name: "vo-06-report",
    text: "Your agent comes back with the score, the confidence, the objection you missed, and a next step you can actually use. Now you can ship with evidence.",
  },
  {
    name: "vo-07-outro",
    text: "Stop guessing. Ask real humans before you build. Level up your agent with RateLoop.",
  },
];

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
