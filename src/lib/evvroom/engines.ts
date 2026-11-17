export type Wave = OscillatorType;

export type LoopLayer = { url: string; rpm: number };

export type EngineProfile = {
  id: string;
  name: string;
  group: "synth" | "sample";
  idle: number;
  redline: number;
  base: number;
  harmonics: number[];
  wave: Wave[];
  detune: number;
  filterBase: number;
  filterMod: number;
  noise: number;
  roughness: number;
  color: string;
  exhaustBoost: number;
  firing: number;
  /** Sample engines borrow a synth body for RPM, gears, and fallback tone. */
  host?: string;
  sampleUrl?: string;
  /** Original seamless loops. RPM is the speed the take was rendered at. */
  loops?: LoopLayer[];
};

const synth = {
  v8: {
    name: "V8 Muscle",
    idle: 780,
    redline: 6500,
    base: 38,
    harmonics: [1, 1.5, 2, 2.5, 3, 4],
    wave: ["sawtooth", "square", "sawtooth", "square", "triangle", "sine"] as Wave[],
    detune: 12,
    filterBase: 380,
    filterMod: 0.32,
    noise: 0.28,
    roughness: 0.22,
    color: "#ff3b30",
    exhaustBoost: 1.55,
    firing: 4,
  },
  v8modern: {
    name: "V8 Modern",
    idle: 650,
    redline: 7200,
    base: 42,
    harmonics: [1, 1.5, 2, 2.5, 3],
    wave: ["sawtooth", "square", "triangle", "sine", "sine"] as Wave[],
    detune: 6,
    filterBase: 480,
    filterMod: 0.36,
    noise: 0.16,
    roughness: 0.08,
    color: "#ff453a",
    exhaustBoost: 1.2,
    firing: 4,
  },
  v6: {
    name: "V6",
    idle: 750,
    redline: 6800,
    base: 55,
    harmonics: [1, 1.5, 2, 3],
    wave: ["sawtooth", "square", "triangle", "sine"] as Wave[],
    detune: 8,
    filterBase: 520,
    filterMod: 0.35,
    noise: 0.18,
    roughness: 0.12,
    color: "#5ac8fa",
    exhaustBoost: 1.25,
    firing: 3,
  },
  v10: {
    name: "V10",
    idle: 820,
    redline: 8500,
    base: 62,
    harmonics: [1, 1.5, 2, 2.5, 3, 4],
    wave: ["sawtooth", "square", "triangle", "sine", "square", "sine"] as Wave[],
    detune: 5,
    filterBase: 740,
    filterMod: 0.4,
    noise: 0.11,
    roughness: 0.06,
    color: "#ff9f0a",
    exhaustBoost: 1.05,
    firing: 5,
  },
  sport: {
    name: "Sports Coupe",
    idle: 920,
    redline: 8200,
    base: 72,
    harmonics: [1, 2, 3, 4, 5],
    wave: ["sawtooth", "square", "sawtooth", "triangle", "sine"] as Wave[],
    detune: 5,
    filterBase: 850,
    filterMod: 0.42,
    noise: 0.14,
    roughness: 0.09,
    color: "#64d2ff",
    exhaustBoost: 1.15,
    firing: 4,
  },
  ev: {
    name: "EV Whine",
    idle: 400,
    redline: 16000,
    base: 220,
    harmonics: [1, 1.02, 2.05, 3.1],
    wave: ["sine", "triangle", "sine", "sine"] as Wave[],
    detune: 0.8,
    filterBase: 1400,
    filterMod: 0.55,
    noise: 0.03,
    roughness: 0.015,
    color: "#30d158",
    exhaustBoost: 0.45,
    firing: 1,
  },
  evcoast: {
    name: "EV Coast",
    idle: 250,
    redline: 8000,
    base: 120,
    harmonics: [1, 2, 3],
    wave: ["sine", "sine", "triangle"] as Wave[],
    detune: 0.4,
    filterBase: 800,
    filterMod: 0.28,
    noise: 0.02,
    roughness: 0.01,
    color: "#5eead4",
    exhaustBoost: 0.3,
    firing: 1,
  },
  evsport: {
    name: "EV Sport",
    idle: 700,
    redline: 18000,
    base: 280,
    harmonics: [1, 2, 3, 5],
    wave: ["sine", "sawtooth", "triangle", "sine"] as Wave[],
    detune: 1.2,
    filterBase: 1800,
    filterMod: 0.7,
    noise: 0.04,
    roughness: 0.02,
    color: "#34d399",
    exhaustBoost: 0.55,
    firing: 1,
  },
  evdual: {
    name: "Dual Motor",
    idle: 500,
    redline: 16000,
    base: 200,
    harmonics: [1, 1.5, 2, 3.5],
    wave: ["sine", "triangle", "sine", "sine"] as Wave[],
    detune: 6,
    filterBase: 1200,
    filterMod: 0.5,
    noise: 0.035,
    roughness: 0.03,
    color: "#22d3ee",
    exhaustBoost: 0.5,
    firing: 1,
  },
  evregen: {
    name: "Regen",
    idle: 180,
    redline: 6000,
    base: 90,
    harmonics: [1, 2, 3, 4],
    wave: ["sine", "triangle", "sine", "sine"] as Wave[],
    detune: 0.6,
    filterBase: 600,
    filterMod: 0.22,
    noise: 0.05,
    roughness: 0.02,
    color: "#86efac",
    exhaustBoost: 0.35,
    firing: 1,
  },
  diesel: {
    name: "Diesel Truck",
    idle: 620,
    redline: 4000,
    base: 28,
    harmonics: [1, 1.25, 2, 2.5],
    wave: ["sawtooth", "square", "sawtooth", "triangle"] as Wave[],
    detune: 28,
    filterBase: 240,
    filterMod: 0.22,
    noise: 0.42,
    roughness: 0.35,
    color: "#ff9500",
    exhaustBoost: 1.75,
    firing: 6,
  },
  rotary: {
    name: "Rotary",
    idle: 1150,
    redline: 9000,
    base: 105,
    harmonics: [1, 1.5, 2.5, 4],
    wave: ["sawtooth", "square", "triangle", "sine"] as Wave[],
    detune: 7,
    filterBase: 1600,
    filterMod: 0.48,
    noise: 0.18,
    roughness: 0.14,
    color: "#bf5af2",
    exhaustBoost: 1.25,
    firing: 2,
  },
  v12: {
    name: "V12 Grand Tourer",
    idle: 720,
    redline: 7800,
    base: 48,
    harmonics: [1, 1.5, 2, 2.5, 3, 4],
    wave: ["sine", "sawtooth", "triangle", "sine", "square", "sine"] as Wave[],
    detune: 3,
    filterBase: 620,
    filterMod: 0.28,
    noise: 0.09,
    roughness: 0.04,
    color: "#ffd60a",
    exhaustBoost: 0.85,
    firing: 6,
  },
  inline4: {
    name: "Inline-4 Turbo",
    idle: 850,
    redline: 7200,
    base: 85,
    harmonics: [1, 2, 3, 4],
    wave: ["sawtooth", "square", "triangle", "sine"] as Wave[],
    detune: 6,
    filterBase: 920,
    filterMod: 0.45,
    noise: 0.16,
    roughness: 0.1,
    color: "#64d2ff",
    exhaustBoost: 1.2,
    firing: 4,
  },
  flat6: {
    name: "Flat-6",
    idle: 880,
    redline: 8000,
    base: 68,
    harmonics: [1, 1.5, 2, 3, 4],
    wave: ["sawtooth", "triangle", "square", "sine", "triangle"] as Wave[],
    detune: 4,
    filterBase: 780,
    filterMod: 0.38,
    noise: 0.12,
    roughness: 0.07,
    color: "#ff375f",
    exhaustBoost: 1.1,
    firing: 6,
  },
} satisfies Record<string, Omit<EngineProfile, "id" | "group">>;

const EXTRAS: Record<string, { name: string; host: keyof typeof synth; loop: string }> = {
  "sample-mustang": { name: "Lumpy V8", host: "v8", loop: "muscle" },
  "sample-viper": { name: "Odd-fire V10", host: "v10", loop: "viper10" },
  "sample-ferrari": { name: "Scream V12", host: "v12", loop: "enzo" },
  "sample-lambo": { name: "Bark V12", host: "v12", loop: "countach" },
  "sample-audi": { name: "Even V10", host: "v10", loop: "audi10" },
};

function withId(id: string, group: "synth" | "sample", extra?: Partial<EngineProfile>): EngineProfile {
  const hostId = (extra?.host as keyof typeof synth) || (id as keyof typeof synth);
  const base = synth[hostId] ?? synth.v8;
  return { id, group, ...base, ...extra, host: group === "sample" ? hostId : undefined };
}

function loopsFor(id: string): LoopLayer[] | undefined {
  if (id === "ev" || id.startsWith("ev")) return [{ url: `/engines/${id}.wav`, rpm: 4000 }];
  const rpms: Record<string, number[]> = {
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
  const row = rpms[id];
  if (!row) return undefined;
  const names = ["low", "mid", "high"];
  return row.map((rpm, i) => ({ url: `/engines/${id}-${names[i]}.wav`, rpm }));
}

export const ENGINES: EngineProfile[] = [
  ...Object.entries(synth).map(([id, profile]) => withId(id, "synth", { ...profile, loops: loopsFor(id) })),
  ...Object.entries(EXTRAS).map(([id, meta]) =>
    withId(id, "sample", {
      ...synth[meta.host],
      name: meta.name,
      host: meta.host,
      loops: loopsFor(meta.loop),
    }),
  ),
];

const BY_ID = new Map(ENGINES.map((e) => [e.id, e]));

export function getEngine(id: string): EngineProfile {
  return BY_ID.get(id) ?? BY_ID.get("v8")!;
}

export function isElectric(engine: EngineProfile): boolean {
  return engine.firing <= 1;
}

/** km/h bands. Upshift just under the top of a gear; downshift with a gap so it doesn't hunt. */
const GEAR_LO = [0, 14, 38, 68, 108, 152];
const GEAR_HI = [22, 48, 82, 122, 172, 240];
const UPSHIFT_AT = [18, 42, 74, 114, 162];
const DOWNSHIFT_AT = [12, 34, 62, 100, 146];

export function stepGear(speedKmh: number, gear: number, electric: boolean): number {
  if (electric) return 1;
  if (gear < 6 && speedKmh > UPSHIFT_AT[gear - 1]) return gear + 1;
  if (gear > 1 && speedKmh < DOWNSHIFT_AT[gear - 2]) return gear - 1;
  return gear;
}

export function targetRpm(speedKmh: number, gear: number, engine: EngineProfile, electric: boolean): number {
  if (electric) {
    const t = Math.min(1, Math.max(0, speedKmh / 180));
    return engine.idle + t * (engine.redline - engine.idle);
  }
  const g = Math.min(6, Math.max(1, gear)) - 1;
  const span = GEAR_HI[g] - GEAR_LO[g];
  const t = Math.min(1, Math.max(0, (speedKmh - GEAR_LO[g]) / span));
  const swept = 0.1 + t * 0.82;
  return engine.idle + swept * (engine.redline - engine.idle);
}
