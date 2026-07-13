import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const model = process.env.PROMO_MUSIC_MODEL ?? "music_v2";
// The promo timeline is 2010 frames / 30fps = 67s. Generate a touch longer so
// the track covers the whole video; the composition trims the tail at 67s.
const lengthMs = Number(process.env.PROMO_MUSIC_LENGTH_MS ?? 68000);

// Candidate moods to audition. Each renders to public/audio/music-test-<name>.mp3.
// These are throwaway test assets — pick a winner, then promote it to music.mp3.
const candidates = [
  {
    name: "warm-optimistic",
    prompt:
      "Warm, optimistic instrumental for a premium AI product promo. Gentle piano and soft " +
      "synth arpeggios over light, understated percussion, building to a hopeful, uplifting " +
      "resolution near the end. Modern tech-startup feel, sincere not cheesy. No vocals. Keep it " +
      "mix-friendly and restrained so a voiceover sits clearly on top.",
  },
  {
    name: "driving-electronic",
    prompt:
      "Sleek, driving electronic instrumental for a modern SaaS product launch. Pulsing synth " +
      "bass, crisp four-on-the-floor beat, bright plucks and confident forward momentum that " +
      "builds energy toward a satisfying lift at the end. Premium and polished, not aggressive. " +
      "No vocals. Leave headroom for a voiceover.",
  },
  {
    name: "cinematic-ambient",
    prompt:
      "Cinematic, minimal ambient instrumental conveying intelligence and trust. Airy pads, a " +
      "subtle piano motif, soft sub-bass and delicate textures that swell gently to a quiet, " +
      "resolved finish. Understated and premium so the voice leads. No vocals. Slow, evolving, " +
      "mix-friendly.",
  },
];

mkdirSync(audioDir, { recursive: true });

const selectedNames = new Set(process.argv.slice(2).filter(arg => !arg.startsWith("--")));
const candidatesToGenerate = selectedNames.size
  ? candidates.filter(candidate => selectedNames.has(candidate.name))
  : candidates;
const unknownNames = [...selectedNames].filter(name => !candidates.some(candidate => candidate.name === name));

if (unknownNames.length) {
  throw new Error(`Unknown music candidate(s): ${unknownNames.join(", ")}`);
}

for (const candidate of candidatesToGenerate) {
  const response = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: model,
      prompt: candidate.prompt,
      music_length_ms: lengthMs,
      force_instrumental: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `ElevenLabs Music failed for ${candidate.name}: ${response.status} ${response.statusText}\n${body}`,
    );
  }

  const mp3Path = join(audioDir, `music-test-${candidate.name}.mp3`);
  writeFileSync(mp3Path, Buffer.from(await response.arrayBuffer()));
  console.log(`Generated music-test-${candidate.name}.mp3 with ${model} (${lengthMs}ms)`);
}

console.log(
  "\nRender a test video for a candidate (production rateloop-promo.mp4 is untouched):\n" +
    "  npx remotion render src/index.ts RateLoopPromo out/rateloop-promo-music-<name>.mp4 \\\n" +
    '    --props=\'{"musicSrc":"audio/music-test-<name>.mp3"}\'',
);
