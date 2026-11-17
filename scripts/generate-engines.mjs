import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "engines");

/** Reference RPM for each loop. Must match src/lib/evvroom/engines.ts */
const LAYERS = {
  v8: [900, 2800, 5000],
  v8modern: [800, 3000, 5600],
  v6: [900, 2800, 5200],
  v10: [1000, 3400, 6400],
  sport: [1100, 3600, 6800],
  diesel: [700, 1600, 2800],
  rotary: [1400, 4000, 7200],
  v12: [800, 3000, 5800],
  inline4: [1000, 3200, 6000],
  flat6: [1000, 3400, 6400],
  muscle: [850, 2600, 4800],
  viper10: [1000, 3600, 6800],
  enzo: [1100, 3800, 7000],
  countach: [950, 3400, 6600],
  audi10: [1000, 3400, 6400],
};

const TONE = {
  v8: { cyl: 8, exhaust: 78, body: 240, bite: 1400, lope: 0.62, noise: 0.7, rasp: 0.35, sub: 1, seed: 3 },
  v8modern: { cyl: 8, exhaust: 92, body: 310, bite: 1800, lope: 0.22, noise: 0.42, rasp: 0.48, sub: 0.7, seed: 5 },
  v6: { cyl: 6, exhaust: 110, body: 360, bite: 1600, lope: 0.28, noise: 0.5, rasp: 0.42, sub: 0.65, seed: 7 },
  v10: { cyl: 10, exhaust: 128, body: 480, bite: 2200, lope: 0.12, noise: 0.36, rasp: 0.72, sub: 0.45, seed: 9 },
  sport: { cyl: 4, exhaust: 150, body: 620, bite: 2600, lope: 0.18, noise: 0.4, rasp: 0.8, sub: 0.4, whistle: 2400, seed: 13 },
  diesel: { cyl: 6, exhaust: 62, body: 180, bite: 900, lope: 0.35, noise: 0.9, rasp: 0.2, sub: 1.2, click: 1, seed: 17 },
  rotary: { cyl: 2, exhaust: 190, body: 900, bite: 3200, lope: 0.08, noise: 0.38, rasp: 1, sub: 0.25, seed: 19 },
  v12: { cyl: 12, exhaust: 100, body: 420, bite: 1900, lope: 0.04, noise: 0.28, rasp: 0.4, sub: 0.55, seed: 23 },
  inline4: { cyl: 4, exhaust: 140, body: 540, bite: 2100, lope: 0.2, noise: 0.46, rasp: 0.66, sub: 0.4, whistle: 3100, seed: 29 },
  flat6: { cyl: 6, exhaust: 120, body: 520, bite: 2400, lope: 0.08, noise: 0.34, rasp: 0.7, sub: 0.4, seed: 31 },
  muscle: { cyl: 8, exhaust: 58, body: 170, bite: 820, lope: 0.2, noise: 0.9, rasp: 0.2, sub: 1.4, seed: 41, exHold: 0.09, pattern: [1, 0.32, 0.88, 0.38] },
  viper10: { cyl: 10, exhaust: 102, body: 620, bite: 2900, lope: 0.1, noise: 0.62, rasp: 1, sub: 0.48, seed: 43, pattern: [1, 0.62, 0.4, 0.92, 0.5] },
  enzo: { cyl: 12, exhaust: 175, body: 860, bite: 3600, lope: 0.04, noise: 0.2, rasp: 0.95, sub: 0.22, seed: 47, exHold: 0.026 },
  countach: { cyl: 12, exhaust: 112, body: 680, bite: 2400, lope: 0.18, noise: 0.55, rasp: 0.88, sub: 0.38, seed: 53, exHold: 0.04 },
  audi10: { cyl: 10, exhaust: 138, body: 480, bite: 1900, lope: 0.05, noise: 0.28, rasp: 0.5, sub: 0.42, whistle: 1700, seed: 59 },
};

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function renderCombustion(spec, rpm, layer) {
  const rand = mulberry(spec.seed + layer * 97);
  const firesPerRev = Math.max(1, spec.cyl / 2);
  const fireHz = (rpm / 60) * firesPerRev;
  const samplesPerFire = Math.max(8, Math.round(SR / fireHz));
  const minSamples = Math.round(SR * 0.5);
  let fires = firesPerRev * 2;
  while (samplesPerFire * fires < minSamples) fires += firesPerRev;
  const n = samplesPerFire * fires;
  const out = new Float32Array(n);

  const bright = layer / 2;
  const lope = spec.lope * (1 - bright * 0.75);
  const fEx = spec.exhaust * (1 + bright * 0.18);
  const fBody = spec.body * (1 + bright * 0.55);
  const fBite = spec.bite * (1 + bright * 0.35);
  const dEx = Math.exp(-1 / (SR * ((spec.exHold ?? 0.055) - bright * 0.015)));
  const dBody = Math.exp(-1 / (SR * (spec.click ? 0.004 : 0.014 - bright * 0.004)));
  const dBite = Math.exp(-1 / (SR * (spec.click ? 0.0016 : 0.0035)));

  let envEx = 0;
  let envBody = 0;
  let envBite = 0;
  let phEx = 0;
  let phBody = 0;
  let phSub = 0;
  let phWh = 0;
  let prev = 0;
  let hp = 0;

  for (let i = 0; i < n; i++) {
    if (i % samplesPerFire === 0) {
      const fireIndex = Math.floor(i / samplesPerFire);
      const alt = spec.pattern
        ? spec.pattern[fireIndex % spec.pattern.length]
        : fireIndex % 2 === 0
          ? 1
          : 1 - lope;
      const hit = alt * (0.92 + rand() * 0.08);
      envEx = hit;
      envBody = hit * (0.55 + spec.rasp * 0.5);
      envBite = hit * spec.noise * (0.45 + bright * 0.4);
    }
    envEx *= dEx;
    envBody *= dBody;
    envBite *= dBite;
    phEx += (2 * Math.PI * fEx) / SR;
    phBody += (2 * Math.PI * fBody) / SR;
    phSub += (2 * Math.PI * (fEx * 0.5)) / SR;
    if (spec.whistle) phWh += (2 * Math.PI * spec.whistle * (1 + bright * 0.15)) / SR;

    const white = rand() * 2 - 1;
    let s = 0;
    s += Math.sin(phEx) * envEx * 0.85;
    s += Math.sin(phEx * 2) * envEx * 0.28 * (0.4 + spec.rasp);
    s += Math.sin(phSub) * envEx * spec.sub * 0.55;
    s += Math.sin(phBody) * envBody * (0.35 + spec.rasp * 0.4);
    s += white * envBite * 0.55;
    if (spec.whistle) s += Math.sin(phWh) * (0.04 + bright * 0.05 + envBody * 0.04);

    hp = 0.996 * (hp + s - prev);
    prev = s;
    out[i] = Math.tanh(hp * (1.6 + bright * 0.5));
  }
  seam(out, Math.round(SR * 0.008));
  normalize(out, 0.9);
  return out;
}

function renderWhine(spec) {
  const f = spec.f;
  const periods = 48;
  const per = Math.round(SR / f);
  const n = per * periods;
  const out = new Float32Array(n);
  const harms = spec.harms;
  const amps = spec.amps;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const w = (2 * Math.PI * i) / per;
    const trem = 0.84 + 0.16 * Math.sin(2 * Math.PI * spec.trem * t);
    let s = 0;
    for (let h = 0; h < harms.length; h++) s += Math.sin(w * harms[h]) * amps[h];
    if (spec.beat) s += Math.sin(w * spec.beat) * spec.beatAmp * Math.sin(2 * Math.PI * spec.trem * t);
    if (spec.noise) {
      const hash = Math.sin(i * 12.9898) * 43758.5453;
      s += (hash - Math.floor(hash) - 0.5) * spec.noise;
    }
    out[i] = Math.tanh(s * 1.35 * trem);
  }
  normalize(out, 0.85);
  return out;
}

function seam(out, fade) {
  const n = out.length;
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const end = n - fade + i;
    out[end] = out[end] * (1 - t) + out[i] * t;
  }
}

function normalize(out, peak) {
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]));
  if (max < 1e-6) return;
  const g = peak / max;
  for (let i = 0; i < out.length; i++) out[i] *= g;
}

function writeWav(path, samples) {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  writeFileSync(path, buf);
}

mkdirSync(OUT, { recursive: true });
const names = ["low", "mid", "high"];
for (const [id, rpms] of Object.entries(LAYERS)) {
  rpms.forEach((rpm, layer) => {
    const samples = renderCombustion(TONE[id], rpm, layer);
    writeWav(join(OUT, `${id}-${names[layer]}.wav`), samples);
  });
}
writeWav(join(OUT, "ev.wav"), renderWhine({ f: 140, trem: 4, harms: [1, 2, 3, 5, 8], amps: [0.52, 0.26, 0.12, 0.06, 0.03], noise: 0.01 }));
writeWav(join(OUT, "evcoast.wav"), renderWhine({ f: 90, trem: 2, harms: [1, 2, 4], amps: [0.72, 0.16, 0.06], noise: 0.02 }));
writeWav(join(OUT, "evsport.wav"), renderWhine({ f: 220, trem: 6, harms: [1, 2, 3, 5, 7], amps: [0.36, 0.34, 0.2, 0.1, 0.07], noise: 0.012 }));
writeWav(join(OUT, "evdual.wav"), renderWhine({ f: 160, trem: 3, harms: [1, 2, 3, 4], amps: [0.42, 0.22, 0.14, 0.06], beat: 5, beatAmp: 0.28, noise: 0.015 }));
writeWav(join(OUT, "evregen.wav"), renderWhine({ f: 70, trem: 1, harms: [1, 2, 3, 6], amps: [0.7, 0.22, 0.12, 0.08], noise: 0.04 }));
console.log("wrote", Object.keys(LAYERS).length * 3 + 5, "loops to", OUT);
