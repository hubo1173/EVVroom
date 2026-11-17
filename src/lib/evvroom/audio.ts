import { getEngine, isElectric, type EngineProfile } from "@/lib/evvroom/engines";

type OscSlot = { osc: OscillatorNode; gain: GainNode; harmonic: number; baseVol: number };
type Layer = { source: AudioBufferSourceNode; gain: GainNode; baseRpm: number };

type SinkAudio = AudioContext & { setSinkId?: (id: string) => Promise<void> };

export type AudioUpdate = {
  rpm: number;
  load: number;
  speedNorm: number;
  engineSound: boolean;
  carSound: boolean;
  engine: EngineProfile;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export class EngineAudio {
  private ctx: SinkAudio | null = null;
  private master: GainNode | null = null;
  private bass: BiquadFilterNode | null = null;
  private cabin: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private dist: WaveShaperNode | null = null;
  private exhaustGain: GainNode | null = null;
  private intakeGain: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private lfoGain: GainNode | null = null;
  private popGain: GainNode | null = null;
  private sampleFilter: BiquadFilterNode | null = null;
  private oscillators: OscSlot[] = [];
  private layers: Layer[] = [];
  private loops: { buffer: AudioBuffer; rpm: number }[] = [];
  private sampleBuffer: AudioBuffer | null = null;
  private usingSample = false;
  private engineId = "v8";
  private sampleAbort: AbortController | null = null;
  private lastLoad = 0;
  volume = 0.55;
  exhaustTrim = 0.7;
  boombox = false;
  /** Output chosen with the browser speaker picker. Empty means cabin speakers. */
  private sinkId = "";
  private sinkEl: HTMLAudioElement | null = null;
  private mediaEl: HTMLAudioElement | null = null;
  private mediaDest: MediaStreamAudioDestinationNode | null = null;

  get running() {
    return !!this.ctx;
  }

  async start(engineId: string): Promise<string | null> {
    if (this.ctx) return null;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx() as SinkAudio;
    if (ctx.state === "suspended") await ctx.resume();
    this.ctx = ctx;
    this.engineId = engineId;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume * 0.35;

    this.bass = ctx.createBiquadFilter();
    this.bass.type = "lowshelf";
    this.bass.frequency.value = 120;
    this.bass.gain.value = this.boombox ? 9 : 0;
    this.master.connect(this.bass);
    this.cabin = ctx.createGain();
    this.cabin.gain.value = 1;
    this.bass.connect(this.cabin);
    this.cabin.connect(ctx.destination);

    this.dist = ctx.createWaveShaper();
    this.dist.curve = distortionCurve(18);
    this.dist.oversample = "2x";
    this.dist.connect(this.master);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 800;
    this.filter.Q.value = 0.8;
    this.filter.connect(this.dist);

    const exhaustFilter = ctx.createBiquadFilter();
    exhaustFilter.type = "lowpass";
    exhaustFilter.frequency.value = 800;
    exhaustFilter.Q.value = 1.2;
    exhaustFilter.connect(this.filter);
    this.exhaustGain = ctx.createGain();
    this.exhaustGain.gain.value = 0.15;
    this.exhaustGain.connect(exhaustFilter);

    const intakeFilter = ctx.createBiquadFilter();
    intakeFilter.type = "highpass";
    intakeFilter.frequency.value = 200;
    intakeFilter.connect(this.filter);
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0.1;
    this.intakeGain.connect(intakeFilter);

    this.noiseSource = ctx.createBufferSource();
    this.noiseSource.buffer = noiseBuffer(ctx);
    this.noiseSource.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 180;
    noiseFilter.Q.value = 0.6;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noiseSource.connect(noiseFilter);
    noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.filter);
    this.noiseSource.start();

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.5;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 8;
    lfo.connect(this.lfoGain);
    lfo.start();

    const popFilter = ctx.createBiquadFilter();
    popFilter.type = "highpass";
    popFilter.frequency.value = 1200;
    popFilter.connect(this.filter);
    this.popGain = ctx.createGain();
    this.popGain.gain.value = 0;
    this.popGain.connect(popFilter);

    this.sampleFilter = ctx.createBiquadFilter();
    this.sampleFilter.type = "lowpass";
    this.sampleFilter.frequency.value = 2800;
    this.sampleFilter.Q.value = 0.6;
    const sampleBus = ctx.createGain();
    sampleBus.gain.value = 1.15;
    this.sampleFilter.connect(sampleBus);
    sampleBus.connect(this.master);

    const engine = getEngine(engineId);
    let note: string | null = null;
    if (engine.loops?.length) {
      const ok = await this.loadLoops(engine);
      if (!ok) {
        this.buildOscillators(engine);
        note = "Engine loop failed — using a synth fallback";
      }
    } else if (engine.group === "sample" && engine.sampleUrl) {
      const ok = await this.loadSample(engine);
      if (!ok) {
        this.buildOscillators(getEngine(engine.host || "v8"));
        note = "Recording failed — using a synth fallback";
      }
    } else {
      this.buildOscillators(engine);
    }
    this.playCrank(isElectric(engine));
    await this.attachMedia(engine.name);
    if (this.boombox && this.sinkId) {
      try {
        await this.applySink(this.sinkId);
      } catch {
        note = note ?? "Speaker didn't stick. Bass boost is on the cabin speakers.";
      }
    }
    return note;
  }

  stop() {
    this.stopLayers();
    this.oscillators.forEach((o) => {
      try {
        o.osc.stop();
      } catch {
        /* already stopped */
      }
    });
    this.oscillators = [];
    try {
      this.noiseSource?.stop();
    } catch {
      /* already stopped */
    }
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.filter = null;
    this.sampleFilter = null;
    this.sampleBuffer = null;
    this.loops = [];
    this.usingSample = false;
    if (this.sinkEl) {
      this.sinkEl.pause();
      this.sinkEl.srcObject = null;
      this.sinkEl = null;
    }
    if (this.mediaEl) {
      this.mediaEl.pause();
      this.mediaEl.srcObject = null;
      this.mediaEl.remove();
      this.mediaEl = null;
    }
    this.mediaDest = null;
    this.cabin = null;
    this.setSession("", "none");
    void ctx?.close();
  }

  setVolume(value: number) {
    this.volume = value;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(value * 0.35, this.ctx.currentTime, 0.03);
  }

  setExhaust(value: number) {
    this.exhaustTrim = value;
  }

  /** Bass boost, and move the engine to a speaker the user just picked. */
  async enableBoombox(device?: { deviceId: string; label: string }): Promise<string> {
    this.boombox = true;
    if (this.bass && this.ctx) this.bass.gain.setTargetAtTime(9, this.ctx.currentTime, 0.08);
    if (!device) {
      const listed = await this.attachMedia(getEngine(this.engineId).name);
      return listed
        ? "Park first. Then Toybox → Boombox → EVVroom. The site cannot turn the outside speaker on by itself."
        : "The car blocked playback. Tap Boombox again, then Toybox → Boombox → EVVroom while parked.";
    }
    this.sinkId = device.deviceId;
    if (!this.ctx) return `Speaker saved (${device.label}). Start the engine.`;
    try {
      await this.applySink(device.deviceId);
    } catch {
      return "That speaker was blocked. Bass boost stays on the cabin speakers.";
    }
    if (isCabinSpeaker(device.label)) {
      return "That output is the cabin speakers. The outside Tesla speaker is Toybox → Boombox only. Bass boost is on.";
    }
    return `Boombox: ${device.label}`;
  }

  async disableBoombox(): Promise<string> {
    this.boombox = false;
    this.sinkId = "";
    if (this.bass && this.ctx) this.bass.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    if (this.cabin) this.cabin.gain.value = 1;
    if (this.ctx?.setSinkId) {
      try {
        await this.ctx.setSinkId("");
      } catch {
        /* already on the default output */
      }
    }
    if (this.mediaEl && typeof this.mediaEl.setSinkId === "function") {
      try {
        await this.mediaEl.setSinkId("");
      } catch {
        /* default output */
      }
    }
    if (this.sinkEl) {
      this.sinkEl.pause();
      this.sinkEl.srcObject = null;
      this.sinkEl = null;
    }
    return "Boombox off";
  }

  /** Send a file player to the speaker chosen for Boombox, if there is one. */
  async routeElement(el: HTMLAudioElement) {
    if (!this.sinkId) return;
    const media = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (typeof media.setSinkId !== "function") return;
    await media.setSinkId(this.sinkId);
  }

  private async applySink(deviceId: string) {
    const media = this.mediaEl as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (media && typeof media.setSinkId === "function") {
      await media.setSinkId(deviceId);
      if (this.cabin) this.cabin.gain.value = 0;
      return;
    }
    const ctx = this.ctx;
    const bass = this.bass;
    if (!ctx || !bass) throw new Error("audio not running");
    if (typeof ctx.setSinkId === "function") {
      await ctx.setSinkId(deviceId);
      if (this.cabin) this.cabin.gain.value = 1;
      return;
    }
    const el = this.sinkEl ?? new Audio();
    if (!this.sinkEl) {
      const dest = ctx.createMediaStreamDestination();
      bass.connect(dest);
      el.srcObject = dest.stream;
      el.autoplay = true;
      this.sinkEl = el;
    }
    const sinkMedia = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (typeof sinkMedia.setSinkId !== "function") throw new Error("no output select");
    await sinkMedia.setSinkId(deviceId);
    if (this.cabin) this.cabin.gain.value = 0;
    await el.play();
  }

  /** Play the engine through a media element so the car lists it as the current track. */
  private async attachMedia(title: string): Promise<boolean> {
    const ctx = this.ctx;
    const bass = this.bass;
    if (!ctx || !bass) return false;
    if (!this.mediaDest) {
      this.mediaDest = ctx.createMediaStreamDestination();
      bass.connect(this.mediaDest);
    }
    if (!this.mediaEl) {
      const el = document.createElement("audio");
      el.className = "evv-now-playing";
      el.setAttribute("playsinline", "");
      el.autoplay = true;
      el.srcObject = this.mediaDest.stream;
      document.body.appendChild(el);
      this.mediaEl = el;
    }
    try {
      await this.mediaEl.play();
      if (this.cabin) this.cabin.gain.value = 0;
      this.setSession(title, "playing");
      return true;
    } catch {
      if (this.cabin) this.cabin.gain.value = 1;
      return false;
    }
  }

  setSession(title: string, state: "playing" | "paused" | "none") {
    if (typeof document !== "undefined") document.title = state === "playing" && title ? `EVVroom · ${title}` : "EVVroom";
    const session = navigator.mediaSession;
    if (!session || typeof MediaMetadata === "undefined") return;
    if (state === "none") {
      session.playbackState = "none";
      session.metadata = null;
      return;
    }
    session.metadata = new MediaMetadata({ title: title || "EVVroom", artist: "EVVroom", album: "Engine" });
    session.playbackState = state;
    if (state === "playing" && session.setPositionState) {
      try {
        session.setPositionState({ duration: 3600, playbackRate: 1, position: 0 });
      } catch {
        /* this browser has no timeline */
      }
    }
  }

  async setEngine(engineId: string): Promise<string | null> {
    this.engineId = engineId;
    if (!this.ctx) return null;
    const engine = getEngine(engineId);
    this.setSession(engine.name, "playing");
    this.stopLayers();
    this.sampleBuffer = null;
    this.loops = [];
    this.usingSample = false;
    this.oscillators.forEach((o) => {
      try {
        o.osc.stop();
      } catch {
        /* already stopped */
      }
    });
    this.oscillators = [];
    if (engine.loops?.length) {
      const ok = await this.loadLoops(engine);
      if (!ok) {
        this.buildOscillators(engine);
        return "Engine loop failed — using a synth fallback";
      }
      return null;
    }
    if (engine.group === "sample" && engine.sampleUrl) {
      const ok = await this.loadSample(engine);
      if (!ok) {
        this.buildOscillators(getEngine(engine.host || "v8"));
        return "Recording failed — using a synth fallback";
      }
      return `Recording loaded: ${engine.name}`;
    }
    this.buildOscillators(engine);
    return null;
  }

  blipShift() {
    this.playShift();
  }

  update(frame: AudioUpdate) {
    const ctx = this.ctx;
    const filter = this.filter;
    if (!ctx || !filter) return;
    const now = ctx.currentTime;
    const { rpm, load, speedNorm, engineSound, carSound, engine } = frame;

    if (this.popGain && engineSound && this.lastLoad > 40 && load < this.lastLoad - 8 && rpm > 2200 && engine.firing > 1) {
      this.popGain.gain.cancelScheduledValues(now);
      this.popGain.gain.setValueAtTime(0.12 + Math.random() * 0.08, now);
      this.popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08 + Math.random() * 0.05);
    }
    this.lastLoad = load;

    if (this.usingSample && this.loops.length) {
      const gains = loopGains(
        rpm,
        this.loops.map((l) => l.rpm),
      );
      const audible =
        (engineSound ? 1 : 0) * (0.7 + load / 220) * (0.55 + this.exhaustTrim * 0.7) * (carSound ? 1 : 0.62);
      const electric = isElectric(engine);
      this.layers.forEach((layer, i) => {
        const base = this.loops[i]?.rpm || 1;
        const rate = clamp(rpm / base, electric ? 0.3 : 0.62, electric ? 4 : 1.75);
        layer.source.playbackRate.setTargetAtTime(rate, now, 0.045);
        layer.gain.gain.setTargetAtTime((gains[i] || 0) * audible, now, 0.04);
      });
      const open = electric ? 2400 + rpm * 0.4 : 2200 + rpm * 0.7 + load * 22;
      this.sampleFilter?.frequency.setTargetAtTime(clamp(open, 500, 8800), now, 0.05);
      return;
    }

    if (this.usingSample && this.sampleBuffer) {
      this.ensureLayers();
      const ratio = clamp(rpm / 900, 0.65, 1.9);
      const loadGain = (engineSound ? 1 : 0.15) * (0.55 + load / 180) * (0.65 + this.exhaustTrim);
      const blend = Math.min(0.45, Math.max(0, (rpm - 800) / 4000));
      const cabin = carSound ? 1 : 0.35;
      if (this.layers[0]) {
        this.layers[0].source.playbackRate.setTargetAtTime(ratio, now, 0.05);
        this.layers[0].gain.gain.setTargetAtTime((1 - blend) * loadGain * cabin, now, 0.04);
      }
      if (this.layers[1]) {
        this.layers[1].source.playbackRate.setTargetAtTime(ratio * 1.035, now, 0.05);
        this.layers[1].gain.gain.setTargetAtTime(blend * loadGain * cabin, now, 0.04);
      }
      filter.frequency.setTargetAtTime(clamp(800 + rpm * 0.35 + load * 8, 200, 4800), now, 0.04);
      return;
    }

    if (!this.oscillators.length) return;
    const electric = isElectric(engine);
    const span = Math.max(1, engine.redline - Math.max(engine.idle, 1));
    const rpmRatio = electric
      ? 0.42 + clamp((rpm - engine.idle) / span, 0, 1) * 7.4
      : clamp(rpm / Math.max(engine.idle, 1), 0.4, 9);
    const loadFactor = 0.42 + load / 120;
    const pulseAmp = electric ? 0.035 : 0.2;
    const wobble = 0.75 + Math.random() * 0.25;
    const pulse = 1 - pulseAmp + pulseAmp * Math.sin(now * engine.firing * rpm * 0.02) * wobble;

    for (const o of this.oscillators) {
      o.osc.frequency.setTargetAtTime(engine.base * o.harmonic * rpmRatio, now, 0.012);
      o.gain.gain.setTargetAtTime(o.baseVol * loadFactor * pulse, now, 0.02);
    }
    const cutoff = engine.filterBase + rpm * engine.filterMod * (electric ? 0.22 : 1.1) + load * 5;
    filter.frequency.setTargetAtTime(clamp(cutoff, 180, electric ? 6200 : 4800), now, 0.02);
    filter.Q.setTargetAtTime(0.6 + load / 150, now, 0.03);
    this.noiseGain?.gain.setTargetAtTime(
      engineSound ? engine.noise * (0.55 + speedNorm * 0.9) * (0.65 + load / 180) : 0,
      now,
      0.03,
    );
    this.lfoGain?.gain.setTargetAtTime(engine.roughness * 11 * (1 - speedNorm * 0.65), now, 0.03);
    this.exhaustGain?.gain.setTargetAtTime(
      engineSound ? 0.5 * engine.exhaustBoost * (0.5 + load / 100) * (0.35 + this.exhaustTrim) : 0,
      now,
      0.02,
    );
    this.intakeGain?.gain.setTargetAtTime(carSound ? 0.36 * (0.45 + load / 140) : 0, now, 0.02);
  }

  private buildOscillators(engine: EngineProfile) {
    const ctx = this.ctx;
    if (!ctx || !this.exhaustGain || !this.intakeGain) return;
    engine.harmonics.forEach((h, i) => {
      const osc = ctx.createOscillator();
      osc.type = engine.wave[i] || "sawtooth";
      osc.frequency.value = engine.base * h;
      osc.detune.value = (Math.random() - 0.5) * engine.detune * 8;
      const gain = ctx.createGain();
      const baseVol = (i === 0 ? 0.34 : 0.16 / engine.harmonics.length) * (i < 3 ? 1 : 0.6);
      gain.gain.value = baseVol * 0.2;
      if (i < 2 && this.lfoGain) this.lfoGain.connect(osc.frequency);
      osc.connect(gain);
      gain.connect(i < 3 ? this.exhaustGain! : this.intakeGain!);
      osc.start();
      this.oscillators.push({ osc, gain, harmonic: h, baseVol });
    });
  }

  private async loadLoops(engine: EngineProfile) {
    if (!this.ctx || !engine.loops?.length || !this.sampleFilter) return false;
    this.sampleAbort?.abort();
    const ac = new AbortController();
    this.sampleAbort = ac;
    try {
      const decoded: { buffer: AudioBuffer; rpm: number }[] = [];
      for (const loop of engine.loops) {
        const res = await fetch(loop.url, { signal: ac.signal });
        if (!res.ok) return false;
        const arr = await res.arrayBuffer();
        if (!this.ctx || this.engineId !== engine.id || ac.signal.aborted) return false;
        const buffer = await this.ctx.decodeAudioData(arr.slice(0));
        decoded.push({ buffer, rpm: loop.rpm });
      }
      this.stopLayers();
      this.loops = decoded;
      this.usingSample = true;
      this.sampleBuffer = null;
      for (const loop of decoded) {
        const source = this.ctx.createBufferSource();
        source.buffer = loop.buffer;
        source.loop = true;
        const gain = this.ctx.createGain();
        gain.gain.value = 0.0001;
        source.connect(gain);
        gain.connect(this.sampleFilter);
        source.start();
        this.layers.push({ source, gain, baseRpm: loop.rpm });
      }
      return true;
    } catch {
      this.usingSample = false;
      this.loops = [];
      return false;
    }
  }

  private async loadSample(engine: EngineProfile) {
    if (!this.ctx || !engine.sampleUrl) return false;
    this.sampleAbort?.abort();
    const ac = new AbortController();
    this.sampleAbort = ac;
    const timer = window.setTimeout(() => ac.abort(), 8000);
    try {
      const res = await fetch(engine.sampleUrl, { signal: ac.signal });
      if (!res.ok) return false;
      const arr = await res.arrayBuffer();
      if (!this.ctx || this.engineId !== engine.id || ac.signal.aborted) return false;
      this.sampleBuffer = await this.ctx.decodeAudioData(arr.slice(0));
      this.usingSample = true;
      this.oscillators.forEach((o) => {
        try {
          o.osc.stop();
        } catch {
          /* already stopped */
        }
      });
      this.oscillators = [];
      this.ensureLayers();
      return true;
    } catch {
      this.usingSample = false;
      this.sampleBuffer = null;
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  }

  private ensureLayers() {
    const ctx = this.ctx;
    const filter = this.filter;
    if (!ctx || !filter || !this.sampleBuffer || this.layers.length >= 2) return;
    this.stopLayers();
    for (let i = 0; i < 2; i++) {
      const source = ctx.createBufferSource();
      source.buffer = this.sampleBuffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = i === 0 ? 0.7 : 0.1;
      source.connect(gain);
      gain.connect(filter);
      source.start();
      this.layers.push({ source, gain, baseRpm: 900 });
    }
  }

  private stopLayers() {
    this.layers.forEach((l) => {
      try {
        l.source.stop();
      } catch {
        /* already stopped */
      }
    });
    this.layers = [];
  }

  private playShift() {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(90, now);
    thump.frequency.exponentialRampToValueAtTime(40, now + 0.12);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.35, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    thump.connect(thumpGain);
    thumpGain.connect(master);
    thump.start(now);
    thump.stop(now + 0.2);

    const click = ctx.createOscillator();
    click.type = "square";
    click.frequency.setValueAtTime(720, now);
    click.frequency.exponentialRampToValueAtTime(180, now + 0.05);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.12, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    click.connect(clickGain);
    clickGain.connect(master);
    click.start(now);
    click.stop(now + 0.08);
  }

  private playCrank(electric: boolean) {
    const ctx = this.ctx;
    const filter = this.filter;
    if (!ctx || !filter) return;
    const now = ctx.currentTime;
    if (electric) {
      const tone = ctx.createOscillator();
      tone.type = "sine";
      tone.frequency.setValueAtTime(180, now);
      tone.frequency.exponentialRampToValueAtTime(640, now + 0.45);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.12, now + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      tone.connect(g);
      g.connect(filter);
      tone.start(now);
      tone.stop(now + 0.75);
      return;
    }
    const starter = ctx.createOscillator();
    starter.type = "sawtooth";
    starter.frequency.setValueAtTime(70, now);
    starter.frequency.exponentialRampToValueAtTime(170, now + 0.55);
    const starterGain = ctx.createGain();
    starterGain.gain.setValueAtTime(0.0001, now);
    starterGain.gain.exponentialRampToValueAtTime(0.22, now + 0.06);
    starterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    starter.connect(starterGain);
    starterGain.connect(filter);
    starter.start(now);
    starter.stop(now + 0.75);
  }
}

function loopGains(rpm: number, centers: number[]) {
  const g = centers.map(() => 0);
  if (!centers.length) return g;
  if (centers.length === 1 || rpm <= centers[0]) {
    g[0] = 1;
    return g;
  }
  const last = centers.length - 1;
  if (rpm >= centers[last]) {
    g[last] = 1;
    return g;
  }
  for (let i = 0; i < last; i++) {
    if (rpm >= centers[i] && rpm <= centers[i + 1]) {
      const t = (rpm - centers[i]) / (centers[i + 1] - centers[i]);
      g[i] = Math.cos(t * Math.PI * 0.5);
      g[i + 1] = Math.sin(t * Math.PI * 0.5);
      return g;
    }
  }
  g[0] = 1;
  return g;
}

function isCabinSpeaker(label: string) {
  const name = label.trim();
  if (!name) return true;
  return /default|communications|built-in|internal|cabin/i.test(name);
}

function noiseBuffer(ctx: AudioContext) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 0.9;
  }
  return buf;
}

function distortionCurve(amount: number) {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
