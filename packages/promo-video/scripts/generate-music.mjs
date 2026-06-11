import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(rootDir, "public/audio/music.m4a");
const wavFile = join(tmpdir(), `rateloop-promo-music-${process.pid}.wav`);

const sampleRate = 44100;
const durationSeconds = 67.5;
const bpm = 104;
const beat = 60 / bpm;
const totalSamples = Math.ceil(durationSeconds * sampleRate);
const left = new Float32Array(totalSamples);
const right = new Float32Array(totalSamples);

let seed = 123456789;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
};

const midiToHz = midi => 440 * 2 ** ((midi - 69) / 12);
const clamp01 = value => Math.max(0, Math.min(1, value));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const panGains = pan => {
  const angle = (pan + 1) * (Math.PI / 4);
  return [Math.cos(angle), Math.sin(angle)];
};

const add = (index, value, pan = 0) => {
  if (index < 0 || index >= totalSamples) return;
  const [l, r] = panGains(pan);
  left[index] += value * l;
  right[index] += value * r;
};

const sectionGain = time => {
  const intro = smoothstep(0, 3.5, time);
  const firstLift = 0.72 + 0.16 * smoothstep(13, 22, time);
  const settleLift = 1 + 0.16 * smoothstep(34, 43, time);
  const outroLift = 1 + 0.2 * smoothstep(54, 61, time);
  const fadeOut = 1 - smoothstep(64.5, durationSeconds, time);
  return intro * firstLift * settleLift * outroLift * fadeOut;
};

const addTone = ({ time, duration, midi, gain, pan = 0, harmonics = [1], attack = 0.01, release = 0.08 }) => {
  const start = Math.max(0, Math.floor(time * sampleRate));
  const end = Math.min(totalSamples, Math.floor((time + duration) * sampleRate));
  const freq = midiToHz(midi);
  for (let i = start; i < end; i++) {
    const t = (i - start) / sampleRate;
    const local = t / duration;
    const env = Math.min(1, t / attack) * Math.min(1, (duration - t) / release) * Math.exp(-local * 2.1);
    let value = 0;
    for (const [multiple, amount] of harmonics) {
      value += Math.sin(2 * Math.PI * freq * multiple * t) * amount;
    }
    add(i, value * gain * env * sectionGain(time + t), pan);
  }
};

const addPad = (time, notes, duration, gain) => {
  notes.forEach((midi, index) => {
    addTone({
      time,
      duration,
      midi,
      gain: gain * (0.8 + index * 0.08),
      pan: [-0.45, 0.35, -0.18, 0.52][index % 4],
      harmonics: [
        [1, 0.8],
        [2, 0.16],
        [3, 0.08],
      ],
      attack: 0.8,
      release: 1.4,
    });
  });
};

const addPluck = (time, midi, gain, pan) => {
  addTone({
    time,
    duration: 0.48,
    midi,
    gain,
    pan,
    harmonics: [
      [1, 0.85],
      [2, 0.28],
      [4, 0.08],
    ],
    attack: 0.006,
    release: 0.22,
  });
  addTone({
    time: time + beat * 0.28,
    duration: 0.36,
    midi,
    gain: gain * 0.18,
    pan: -pan,
    harmonics: [[1, 1]],
    attack: 0.005,
    release: 0.16,
  });
};

const addBass = (time, midi, duration, gain) => {
  addTone({
    time,
    duration,
    midi,
    gain,
    pan: 0,
    harmonics: [
      [1, 0.9],
      [2, 0.35],
      [3, 0.14],
    ],
    attack: 0.012,
    release: 0.16,
  });
};

const addKick = (time, gain) => {
  const start = Math.floor(time * sampleRate);
  const len = Math.floor(0.42 * sampleRate);
  for (let n = 0; n < len; n++) {
    const t = n / sampleRate;
    const freq = 46 + 76 * Math.exp(-t * 26);
    const env = Math.exp(-t * 8.5);
    const click = Math.exp(-t * 120) * Math.sin(2 * Math.PI * 1400 * t) * 0.08;
    add(start + n, (Math.sin(2 * Math.PI * freq * t) * env + click) * gain * sectionGain(time + t), 0);
  }
};

const addSnare = (time, gain) => {
  const start = Math.floor(time * sampleRate);
  const len = Math.floor(0.22 * sampleRate);
  for (let n = 0; n < len; n++) {
    const t = n / sampleRate;
    const env = Math.exp(-t * 18);
    const tone = Math.sin(2 * Math.PI * 190 * t) * 0.3;
    const noise = (random() * 2 - 1) * 0.75;
    add(start + n, (noise + tone) * env * gain * sectionGain(time + t), 0.08);
  }
};

const addHat = (time, gain, open = false) => {
  const start = Math.floor(time * sampleRate);
  const len = Math.floor((open ? 0.22 : 0.07) * sampleRate);
  for (let n = 0; n < len; n++) {
    const t = n / sampleRate;
    const env = Math.exp(-t * (open ? 12 : 42));
    const metallic = Math.sin(2 * Math.PI * 7600 * t) * 0.35 + Math.sin(2 * Math.PI * 10200 * t) * 0.2;
    const noise = (random() * 2 - 1) * 0.6;
    add(start + n, (noise + metallic) * env * gain * sectionGain(time + t), 0.62);
  }
};

const addRise = (time, duration, gain) => {
  const start = Math.floor(time * sampleRate);
  const len = Math.floor(duration * sampleRate);
  for (let n = 0; n < len; n++) {
    const t = n / sampleRate;
    const p = t / duration;
    const freq = 520 + p * 2200;
    const env = smoothstep(0, 0.35, p) * (1 - smoothstep(0.82, 1, p));
    const value = Math.sin(2 * Math.PI * freq * t) * env * gain * sectionGain(time + t);
    add(start + n, value, -0.15);
  }
};

const chords = [
  { root: 42, notes: [54, 57, 61, 66] }, // F#m
  { root: 38, notes: [50, 57, 62, 66] }, // D
  { root: 45, notes: [52, 57, 61, 64] }, // A
  { root: 40, notes: [52, 56, 59, 64] }, // E
];

const barLength = beat * 4;
const bars = Math.ceil(durationSeconds / barLength);

for (let bar = 0; bar < bars; bar++) {
  const barTime = bar * barLength;
  const chord = chords[bar % chords.length];
  const full = barTime >= 13;
  const high = barTime >= 34;
  const outro = barTime >= 54;

  addPad(barTime, chord.notes, barLength * 1.08, outro ? 0.06 : 0.045);

  if (barTime >= 5.5) {
    addBass(barTime, chord.root, beat * 1.6, high ? 0.12 : 0.1);
    addBass(barTime + beat * 2, chord.root + 7, beat * 0.8, high ? 0.08 : 0.06);
    addBass(barTime + beat * 3, chord.root + 12, beat * 0.72, high ? 0.07 : 0.05);
  }

  const arp = [chord.notes[0], chord.notes[2], chord.notes[3], chord.notes[2], chord.notes[1], chord.notes[2], chord.notes[3], chord.notes[2]];
  for (let step = 0; step < 8; step++) {
    const stepTime = barTime + step * beat * 0.5;
    const introGain = barTime < 6 ? 0.035 : 0.05;
    addPluck(stepTime, arp[step] + (outro ? 12 : 0), high ? introGain * 1.22 : introGain, step % 2 ? 0.36 : -0.3);
    if (full && high && step % 2 === 1) {
      addPluck(stepTime + beat * 0.25, arp[(step + 2) % arp.length] + 12, 0.026, step % 4 === 1 ? -0.52 : 0.48);
    }
  }

  if (barTime >= 6) {
    for (let b = 0; b < 4; b++) {
      addKick(barTime + b * beat, high ? 0.3 : 0.25);
    }
    addSnare(barTime + beat, full ? 0.12 : 0.08);
    addSnare(barTime + beat * 3, full ? 0.13 : 0.09);
  }

  if (barTime >= 10) {
    const hatSteps = high ? 16 : 8;
    for (let step = 0; step < hatSteps; step++) {
      addHat(barTime + step * (barLength / hatSteps), step % 4 === 0 ? 0.035 : 0.024, high && step % 8 === 6);
    }
  }
}

addRise(31.6, 2.2, 0.045);
addRise(52.4, 2.4, 0.052);

let peak = 0;
for (let i = 0; i < totalSamples; i++) {
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}
const normalize = peak > 0 ? 0.88 / peak : 1;

const wav = Buffer.alloc(44 + totalSamples * 4);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(totalSamples * 4, 40);

for (let i = 0; i < totalSamples; i++) {
  const l = Math.max(-1, Math.min(1, left[i] * normalize));
  const r = Math.max(-1, Math.min(1, right[i] * normalize));
  wav.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
  wav.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
}

writeFileSync(wavFile, wav);

const result = spawnSync("afconvert", ["-f", "m4af", "-d", "aac", "-q", "127", wavFile, outFile], {
  stdio: "inherit",
});
rmSync(wavFile, { force: true });

if (result.status !== 0) {
  throw new Error(`afconvert failed with exit code ${result.status}`);
}

console.log(`Generated ${outFile}`);
