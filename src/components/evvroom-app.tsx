import { useEffect, useRef, useState } from "react";
import { Bluetooth, Gauge, Moon, Pause, Play, Share2, SkipBack, SkipForward, Sun, Usb, Zap } from "lucide-react";
import { EngineAudio } from "@/lib/evvroom/audio";
import { ENGINES, getEngine, isElectric, stepGear, targetRpm } from "@/lib/evvroom/engines";

const PREFS_KEY = "evvroom-prefs-v1";

type Prefs = {
  engineId: string;
  volume: number;
  exhaust: number;
  useMph: boolean;
  dark: boolean;
  engineSound: boolean;
  carSound: boolean;
};

const DEFAULT_PREFS: Prefs = {
  engineId: "v8",
  volume: 55,
  exhaust: 70,
  useMph: false,
  dark: true,
  engineSound: true,
  carSound: true,
};

const AUDIO_FILE = /\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4)$/i;
const menuInk = { color: "#12141a", backgroundColor: "#ffffff" };

type UsbTrack = { name: string; url: string };

function isAudioFile(file: File) {
  return file.type.startsWith("audio/") || AUDIO_FILE.test(file.name);
}

type DirEntry = { kind: "file" | "directory"; name: string; getFile: () => Promise<File> };
type DirHandle = { values: () => AsyncIterable<DirEntry> };

async function filesFromDirectory(dir: DirHandle, depth = 0): Promise<File[]> {
  const found: File[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === "file") {
      if (AUDIO_FILE.test(entry.name)) found.push(await entry.getFile());
    } else if (depth < 1) {
      found.push(...(await filesFromDirectory(entry as unknown as DirHandle, depth + 1)));
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return found;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const engineId = ENGINES.some((e) => e.id === parsed.engineId) ? parsed.engineId! : DEFAULT_PREFS.engineId;
    return { ...DEFAULT_PREFS, ...parsed, engineId };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function EvvroomApp() {
  const stickyRef = useRef(false);
  const audioRef = useRef<EngineAudio | null>(null);
  const watchRef = useRef<number | null>(null);
  const prefsRef = useRef(DEFAULT_PREFS);
  const simRef = useRef(false);
  const runRef = useRef(false);
  const revRef = useRef(false);
  const speedRef = useRef(0);
  const targetRef = useRef(0);
  const rpmRef = useRef(0);
  const gearRef = useRef(1);
  const loadRef = useRef(0);
  const shiftLock = useRef(0);
  const usbRef = useRef<HTMLAudioElement | null>(null);
  const usbFileRef = useRef<HTMLInputElement | null>(null);
  const usbListRef = useRef<UsbTrack[]>([]);
  const usbIndexRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [sim, setSim] = useState(false);
  const [boombox, setBoombox] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState("Tap Start when parked");
  const [tone, setTone] = useState<"ok" | "warn" | "">("");
  const [speed, setSpeed] = useState(0);
  const [rpm, setRpm] = useState(0);
  const [load, setLoad] = useState(0);
  const [gear, setGear] = useState(1);
  const [gearPop, setGearPop] = useState(false);
  const [gps, setGps] = useState(false);
  const [simSpeed, setSimSpeed] = useState(0);
  const [usbTracks, setUsbTracks] = useState<UsbTrack[]>([]);
  const [usbIndex, setUsbIndex] = useState(0);
  const [usbPlaying, setUsbPlaying] = useState(false);

  const toggleRef = useRef<() => void>(() => {});

  useEffect(() => {
    const stored = loadPrefs();
    prefsRef.current = stored;
    setPrefs(stored);
    setHydrated(true);
    document.documentElement.dataset.theme = stored.dark ? "dark" : "light";
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    prefsRef.current = prefs;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    document.documentElement.dataset.theme = prefs.dark ? "dark" : "light";
    audioRef.current?.setVolume(prefs.volume / 100);
    audioRef.current?.setExhaust(prefs.exhaust / 100);
    if (usbRef.current) usbRef.current.volume = prefs.volume / 100;
  }, [prefs, hydrated]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!simRef.current) return;
      if (e.key === "ArrowUp") {
        targetRef.current = Math.min(240, targetRef.current + 4);
        setSimSpeed(Math.round(targetRef.current));
      }
      if (e.key === "ArrowDown") {
        targetRef.current = Math.max(0, targetRef.current - 4);
        setSimSpeed(Math.round(targetRef.current));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session?.setActionHandler) return;
    const play = () => {
      if (!runRef.current) void toggleRef.current();
    };
    const pause = () => {
      if (runRef.current) void toggleRef.current();
    };
    try {
      session.setActionHandler("play", play);
      session.setActionHandler("pause", pause);
    } catch {
      /* this browser has no media controls */
    }
    return () => {
      try {
        session.setActionHandler("play", null);
        session.setActionHandler("pause", null);
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let uiAcc = 0;
    const loop = (ts: number) => {
      frame = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;

      const engine = getEngine(prefsRef.current.engineId);
      const electric = isElectric(engine);
      const prev = speedRef.current;
      speedRef.current += (targetRef.current - speedRef.current) * Math.min(1, dt * 8);
      if (speedRef.current < 0.25) speedRef.current = 0;
      const nextGear = stepGear(speedRef.current, gearRef.current, electric);
      if (runRef.current && nextGear !== gearRef.current && !electric && ts - shiftLock.current > 420) {
        shiftLock.current = ts;
        gearRef.current = nextGear;
        audioRef.current?.blipShift();
        setGear(nextGear);
        setGearPop(true);
        window.setTimeout(() => setGearPop(false), 160);
      }

      let goal = targetRpm(speedRef.current, gearRef.current, engine, electric);
      if (revRef.current) goal = Math.max(goal, engine.idle + (engine.redline - engine.idle) * 0.78);
      if (!runRef.current) goal = 0;
      rpmRef.current += (goal - rpmRef.current) * Math.min(1, dt * (revRef.current ? 6 : 4));

      const accel = (speedRef.current - prev) / Math.max(dt, 0.016);
      const speedNorm = Math.min(1, speedRef.current / 180);
      let goalLoad = Math.max(0, Math.min(100, 8 + speedNorm * 55 + accel * 1.6));
      if (revRef.current) goalLoad = Math.max(goalLoad, 82);
      if (!runRef.current) goalLoad = 0;
      loadRef.current += (goalLoad - loadRef.current) * 0.35;

      if (runRef.current) {
        audioRef.current?.update({
          rpm: rpmRef.current,
          load: loadRef.current,
          speedNorm,
          engineSound: prefsRef.current.engineSound,
          carSound: prefsRef.current.carSound,
          engine,
        });
      }

      uiAcc += dt;
      if (uiAcc > 0.08) {
        uiAcc = 0;
        const shown = prefsRef.current.useMph ? speedRef.current * 0.621371 : speedRef.current;
        setSpeed(Math.round(shown));
        setRpm(Math.round(Math.max(0, rpmRef.current)));
        setLoad(Math.round(loadRef.current));
        setGear(gearRef.current);
      }
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  function say(message: string, kind: "ok" | "warn" | "" = "", sticky = false) {
    stickyRef.current = sticky;
    setStatus(message);
    setTone(kind);
  }

  async function toggleEngine() {
    if (!audioRef.current) audioRef.current = new EngineAudio();
    const audio = audioRef.current;
    if (runRef.current) {
      audio.stop();
      runRef.current = false;
      setRunning(false);
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
      setGps(false);
      say("Engine off");
      return;
    }
    let note: string | null = null;
    try {
      note = await ensureRunning();
    } catch {
      say("Audio isn't available in this browser", "warn");
      return;
    }
    if (note === null && !runRef.current) return;
    runRef.current = true;
    setRunning(true);
    const electric = isElectric(getEngine(prefsRef.current.engineId));
    say(note ?? (electric ? "Motor live. Parked, open Toybox → Boombox → current media." : "Engine running. Parked, open Toybox → Boombox → current media."), note ? "warn" : "ok", !note);
    if (!simRef.current) startGps();
    if ("wakeLock" in navigator) {
      try {
        await navigator.wakeLock.request("screen");
      } catch {
        /* optional */
      }
    }
  }

  function startGps() {
    if (!navigator.geolocation) {
      say("No GPS here — use Simulate", "warn");
      return;
    }
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (simRef.current) return;
        const kph = pos.coords.speed;
        if (kph != null && kph >= 0) {
          targetRef.current = kph * 3.6;
          setGps(true);
        }
      },
      () => {
        setGps(false);
        if (stickyRef.current) return;
        say("Location blocked — use Simulate", "warn");
      },
      { enableHighAccuracy: true, maximumAge: 250, timeout: 8000 },
    );
  }

  async function onEngineChange(engineId: string) {
    setPrefs((p) => ({ ...p, engineId }));
    const note = await audioRef.current?.setEngine(engineId);
    if (note) say(note, note.includes("failed") ? "warn" : "ok");
  }

  async function ensureRunning(): Promise<string | null> {
    if (!audioRef.current) audioRef.current = new EngineAudio();
    if (runRef.current) return null;
    const audio = audioRef.current;
    audio.volume = prefsRef.current.volume / 100;
    audio.exhaustTrim = prefsRef.current.exhaust / 100;
    const note = await audio.start(prefsRef.current.engineId);
    runRef.current = true;
    setRunning(true);
    if (!simRef.current) startGps();
    if ("wakeLock" in navigator) {
      try {
        await navigator.wakeLock.request("screen");
      } catch {
        /* optional */
      }
    }
    return note;
  }

  async function toggleBoombox() {
    if (!audioRef.current) audioRef.current = new EngineAudio();
    const audio = audioRef.current;
    if (boombox) {
      setBoombox(false);
      say(await audio.disableBoombox(), "ok");
      return;
    }

    const devices = navigator.mediaDevices as MediaDevices & {
      selectAudioOutput?: () => Promise<MediaDeviceInfo>;
    };
    let picked: MediaDeviceInfo | null = null;
    if (typeof devices?.selectAudioOutput === "function") {
      try {
        picked = await devices.selectAudioOutput();
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "AbortError") {
          say("Speaker list closed", "warn");
          return;
        }
        picked = null;
      }
    }

    setBoombox(true);
    stickyRef.current = true;
    try {
      await ensureRunning();
    } catch {
      setBoombox(false);
      say("Audio isn't available in this browser", "warn");
      return;
    }
    const note = await audio.enableBoombox(
      picked ? { deviceId: picked.deviceId, label: picked.label || "speaker" } : undefined,
    );
    if (usbRef.current) {
      try {
        await audio.routeElement(usbRef.current);
      } catch {
        /* file player stays on the cabin speakers */
      }
    }
    say(note, note.startsWith("Boombox:") ? "ok" : "warn", true);
  }

  async function startUsb(list: UsbTrack[], index: number) {
    const el = usbRef.current;
    const track = list[index];
    if (!el || !track) return;
    el.volume = prefsRef.current.volume / 100;
    el.src = track.url;
    usbIndexRef.current = index;
    setUsbIndex(index);
    try {
      await audioRef.current?.routeElement(el);
    } catch {
      /* cabin speakers */
    }
    try {
      await el.play();
      setUsbPlaying(true);
      say(`USB ${index + 1}/${list.length} · ${track.name}`, "ok", true);
      audioRef.current?.setSession(track.name, "playing");
    } catch {
      setUsbPlaying(false);
      say("Tap play to start the USB file", "warn", true);
    }
  }

  function takeUsbFiles(files: File[]) {
    const audioFiles = files.filter(isAudioFile);
    if (!audioFiles.length) {
      say("No audio files there", "warn");
      return;
    }
    for (const track of usbListRef.current) URL.revokeObjectURL(track.url);
    const list = audioFiles
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
    usbListRef.current = list;
    setUsbTracks(list);
    void startUsb(list, 0);
  }

  async function pickUsb() {
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (typeof picker === "function") {
      try {
        const dir = (await picker()) as unknown as DirHandle;
        const files = await filesFromDirectory(dir);
        if (!files.length) {
          say("No audio files in that folder", "warn");
          return;
        }
        takeUsbFiles(files);
        return;
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        if (name === "AbortError" || name === "NotAllowedError") return;
      }
    }
    usbFileRef.current?.click();
  }

  function toggleUsb() {
    const el = usbRef.current;
    if (!el || !usbListRef.current.length) return;
    if (!el.paused) {
      el.pause();
      setUsbPlaying(false);
      if (runRef.current) audioRef.current?.setSession(getEngine(prefsRef.current.engineId).name, "playing");
      return;
    }
    void startUsb(usbListRef.current, usbIndexRef.current);
  }

  function stepUsb(dir: number) {
    const list = usbListRef.current;
    if (!list.length) return;
    const next = (usbIndexRef.current + dir + list.length) % list.length;
    void startUsb(list, next);
  }

  async function share() {
    const data = { title: "EVVroom", text: "Live engine sound for quiet electric cars.", url: window.location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(window.location.href);
        say("Link copied", "ok");
      }
    } catch {
      /* dismissed */
    }
  }

  const engine = getEngine(prefs.engineId);
  const electric = isElectric(engine);
  const rpmPct = Math.min(1, Math.max(0, rpm / engine.redline));
  const hot = load > 72;
  toggleRef.current = () => void toggleEngine();

  return (
    <main className="cockpit relative h-dvh overflow-hidden text-fg">
      <div className="shell relative z-10 mx-auto flex h-dvh w-full max-w-lg flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] min-[900px]:max-w-none min-[900px]:px-10">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/brand/mark.png" alt="" className="brand-mark h-9 w-auto" />
            <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              EVV<span className="text-primary">room</span>
            </h1>
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Live engine</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void share()}
              className="pad grid size-14 place-items-center backdrop-blur-md"
              aria-label="Share EVVroom"
            >
              <Share2 className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => setPrefs((p) => ({ ...p, dark: !p.dark }))}
              className="pad grid size-14 place-items-center backdrop-blur-md"
              aria-label={prefs.dark ? "Switch to light" : "Switch to dark"}
            >
              {prefs.dark ? <Moon className="size-5" /> : <Sun className="size-5" />}
            </button>
          </div>
        </header>

        <p className="warn-line mt-3 text-center text-xs leading-relaxed text-muted min-[900px]:text-left">
          Entertainment only. Eyes on the road. Don't tap the browser Expand button — Tesla treats that as Theater and asks for Park. This page already fills the window.
        </p>

        <div className="stage flex min-h-0 flex-1 flex-col min-[900px]:grid min-[900px]:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)] min-[900px]:gap-10">
        <div className="relative overflow-hidden">
        <img
          src="/brand/model3.png"
          alt=""
          className="car-ghost pointer-events-none absolute top-1/2 left-1/2 w-[118%] max-w-none -translate-x-1/2 -translate-y-[46%]"
        />
        <section className="relative mt-3 min-[900px]:mt-6" aria-label="Speed and revs">
          <div className="grid grid-cols-2 gap-3 min-[900px]:gap-5">
            <div className="rounded-3xl border border-white/15 bg-surface/50 px-3 pt-2 pb-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_16px_40px_rgba(0,0,0,0.25)] backdrop-blur-md min-[900px]:px-6 min-[900px]:pb-5">
              <Dial pct={Math.min(1, speed / (prefs.useMph ? 160 : 240))} marks={["0", prefs.useMph ? "160" : "240"]} />
              <div className="-mt-2 text-center">
                <div className="font-display text-4xl font-semibold tracking-tight min-[900px]:text-6xl">
                  <Digits value={speed} width={3} />
                </div>
                <div className="mt-1 flex items-center justify-between text-[0.65rem] font-medium tracking-widest text-muted uppercase">
                  <span>{prefs.useMph ? "mph" : "km/h"}</span>
                  <span className={gps && !sim ? "text-good" : ""}>{sim ? "Sim" : gps ? "GPS" : "Park"}</span>
                </div>
              </div>
            </div>
            <div className="rounded-3xl border border-white/15 bg-surface/50 px-3 pt-2 pb-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_16px_40px_rgba(0,0,0,0.25)] backdrop-blur-md min-[900px]:px-6 min-[900px]:pb-5">
              <Dial pct={rpmPct} hot={hot} redFrom={0.84} marks={["0", `${(engine.redline / 1000).toFixed(1)}k`]} />
              <div className="-mt-2 text-center">
                <div className="font-display text-4xl font-semibold text-primary tracking-tight min-[900px]:text-6xl">
                  <Digits value={rpm} width={4} />
                </div>
                <div className="mt-1 flex items-center justify-between text-[0.65rem] font-medium tracking-widest text-muted uppercase">
                  <span>rpm</span>
                  <span className={hot ? "text-hot" : ""}>{load}% load</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2">
            <div className={`rounded-2xl border border-white/10 bg-surface/55 px-2 py-2 text-center backdrop-blur-md ${gearPop ? "scale-105" : ""} transition-transform`}>
              <div className="text-[0.6rem] tracking-[0.16em] text-muted uppercase">Gear</div>
              <div className="font-display text-xl font-semibold tracking-widest min-[900px]:text-2xl">{electric ? "D" : `D${gear}`}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-surface/55 px-2 py-2 text-center backdrop-blur-md">
              <div className="text-[0.6rem] tracking-[0.16em] text-muted uppercase">Power</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fg/10">
                <div className={`h-full rounded-full ${hot ? "bg-hot" : "bg-primary"}`} style={{ width: `${load}%` }} />
              </div>
              <div className="mt-1 font-display text-sm font-semibold tabular-nums">{load}%</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-surface/55 px-2 py-2 text-center backdrop-blur-md">
              <div className="text-[0.6rem] tracking-[0.16em] text-muted uppercase">Limit</div>
              <div className="font-display text-xl font-semibold tabular-nums min-[900px]:text-2xl">{Math.round(engine.redline / 1000)}k</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-surface/55 px-2 py-2 text-center backdrop-blur-md">
              <div className="text-[0.6rem] tracking-[0.16em] text-muted uppercase">Motor</div>
              <div className="font-display text-sm font-semibold leading-tight min-[900px]:text-base">{electric ? "EV" : `${engine.firing} cyl`}</div>
            </div>
          </div>
          <p className="mt-2 text-center text-[0.65rem] font-medium tracking-[0.18em] text-muted uppercase">{engine.name}</p>
        </section>

        <p className={`mt-2 min-h-5 text-center text-sm font-medium min-[900px]:text-left ${tone === "ok" ? "text-good" : tone === "warn" ? "text-warn" : "text-muted"}`} role="status">
          {status}
        </p>
        </div>

        <div className="controls mt-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-1 min-[900px]:mt-6">
          <button
            type="button"
            onClick={() => void toggleEngine()}
            className={`pad dash flex h-24 ${running ? "" : "pad-go"}`}
          >
            <span className="dash-lamp" aria-hidden />
            <span className="dash-copy">
              <span className="dash-kicker">Ignition</span>
              <span className="dash-title">{running ? "Stop engine" : "Start engine"}</span>
            </span>
            <Zap className="size-6" />
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                const next = !sim;
                simRef.current = next;
                setSim(next);
                if (next) {
                  targetRef.current = simSpeed;
                  say("Simulation — GPS paused");
                } else {
                  targetRef.current = 0;
                  say("GPS mode");
                  if (runRef.current) startGps();
                }
              }}
              className={`pad dash flex h-20 ${sim ? "pad-go" : ""}`}
            >
              <span className="dash-lamp" aria-hidden />
              <span className="dash-copy">
                <span className="dash-kicker">Drive</span>
                <span className="dash-title">{sim ? "GPS mode" : "Simulate"}</span>
              </span>
              <Gauge className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => void toggleBoombox()}
              className={`pad dash flex h-20 ${boombox ? "pad-hot" : ""}`}
            >
              <span className="dash-lamp" aria-hidden />
              <span className="dash-copy">
                <span className="dash-kicker">Park</span>
                <span className="dash-title">{boombox ? "Box on" : "Boombox"}</span>
              </span>
              <Bluetooth className="size-5" />
            </button>
          </div>

          <button type="button" onClick={() => void pickUsb()} className="pad dash flex h-20">
            <span className="dash-lamp" aria-hidden />
            <span className="dash-copy">
              <span className="dash-kicker">Media</span>
              <span className="dash-title">{usbTracks.length ? "Change USB" : "USB audio"}</span>
            </span>
            <Usb className="size-5" />
          </button>
          <input
            ref={usbFileRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm,.mp4"
            multiple
            className="hidden"
            onChange={(e) => {
              takeUsbFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <audio
            ref={usbRef}
            className="hidden"
            onEnded={() => {
              const list = usbListRef.current;
              if (list.length < 2) {
                setUsbPlaying(false);
                return;
              }
              void startUsb(list, (usbIndexRef.current + 1) % list.length);
            }}
          />
          {usbTracks.length > 0 && (
            <div className="pad flex items-center gap-2 p-2">
              <button type="button" onClick={() => stepUsb(-1)} className="grid size-14 place-items-center rounded-2xl" aria-label="Previous file">
                <SkipBack className="size-5" />
              </button>
              <button
                type="button"
                onClick={toggleUsb}
                className="pad-go grid size-14 place-items-center rounded-2xl"
                aria-label={usbPlaying ? "Pause USB audio" : "Play USB audio"}
              >
                {usbPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
              </button>
              <p className="min-w-0 flex-1 truncate px-1 text-sm">
                {usbIndex + 1}/{usbTracks.length} {usbTracks[usbIndex]?.name}
              </p>
              <button type="button" onClick={() => stepUsb(1)} className="grid size-14 place-items-center rounded-2xl" aria-label="Next file">
                <SkipForward className="size-5" />
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onPointerDown={() => {
                revRef.current = true;
              }}
              onPointerUp={() => {
                revRef.current = false;
              }}
              onPointerLeave={() => {
                revRef.current = false;
              }}
              onPointerCancel={() => {
                revRef.current = false;
              }}
              className="pad dash flex h-20 touch-none"
            >
              <span className="dash-lamp" aria-hidden />
              <span className="dash-copy">
                <span className="dash-kicker">Hold</span>
                <span className="dash-title">Rev</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => audioRef.current?.blipShift()}
              className="pad dash flex h-20"
            >
              <span className="dash-lamp" aria-hidden />
              <span className="dash-copy">
                <span className="dash-kicker">Manual</span>
                <span className="dash-title">Shift</span>
              </span>
            </button>
          </div>

          <label className="pad dash flex h-20">
            <span className="dash-lamp" aria-hidden />
            <span className="dash-copy">
              <span className="dash-kicker">Sound</span>
              <select
                value={prefs.engineId}
                onChange={(e) => void onEngineChange(e.target.value)}
                className="engine-pick w-full bg-transparent text-base font-bold tracking-wide uppercase outline-none"
                aria-label="Engine"
              >
              <optgroup label="Electric" style={menuInk}>
                {ENGINES.filter((e) => e.group === "synth" && e.firing <= 1).map((e) => (
                  <option key={e.id} value={e.id} style={menuInk}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Original" style={menuInk}>
                {ENGINES.filter((e) => e.group === "synth" && e.firing > 1).map((e) => (
                  <option key={e.id} value={e.id} style={menuInk}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="More originals" style={menuInk}>
                {ENGINES.filter((e) => e.group === "sample").map((e) => (
                  <option key={e.id} value={e.id} style={menuInk}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            </select>
            </span>
          </label>

          <div className="grid grid-cols-3 gap-3">
            <Toggle
              on={prefs.engineSound}
              onClick={() => setPrefs((p) => ({ ...p, engineSound: !p.engineSound }))}
              kicker="Motor"
              title={prefs.engineSound ? "On" : "Off"}
            />
            <Toggle
              on={prefs.carSound}
              onClick={() => setPrefs((p) => ({ ...p, carSound: !p.carSound }))}
              kicker="Cabin"
              title={prefs.carSound ? "On" : "Off"}
            />
            <Toggle
              on
              onClick={() => setPrefs((p) => ({ ...p, useMph: !p.useMph }))}
              kicker="Units"
              title={prefs.useMph ? "mph" : "km/h"}
            />
          </div>

          <Slider
            label="Engine volume"
            value={prefs.volume}
            onChange={(volume) => setPrefs((p) => ({ ...p, volume }))}
          />
          <Slider
            label="Exhaust"
            value={prefs.exhaust}
            onChange={(exhaust) => setPrefs((p) => ({ ...p, exhaust }))}
          />

          {sim && (
            <div className="rounded-2xl border border-border bg-surface/80 p-3">
              <Slider
                label="Fake speed"
                value={simSpeed}
                max={240}
                suffix="km/h"
                onChange={(value) => {
                  setSimSpeed(value);
                  targetRef.current = value;
                }}
              />
              <p className="mt-1 text-xs text-muted">Arrows or the slider. GPS stays off until you leave simulate.</p>
            </div>
          )}

          <p className="pt-1 text-center text-xs text-muted">Not a vehicle system. Not affiliated with any car maker. Drive safely.</p>
        </div>
        </div>
      </div>
    </main>
  );
}

function Digits({ value, width }: { value: number; width: number }) {
  const raw = String(Math.max(0, Math.round(value))).padStart(width, "0");
  const cut = raw.search(/[1-9]/);
  const i = cut === -1 ? raw.length - 1 : cut;
  return (
    <span className="tabular-nums">
      <span className="opacity-30">{raw.slice(0, i)}</span>
      {raw.slice(i)}
    </span>
  );
}

function Dial({ pct, hot, redFrom, marks }: { pct: number; hot?: boolean; redFrom?: number; marks: [string, string] }) {
  const p = Math.min(1, Math.max(0, pct));
  const r = 46;
  const len = Math.PI * r;
  const a = Math.PI * (1 - p);
  const tipX = 60 + Math.cos(a) * 36;
  const tipY = 62 - Math.sin(a) * 36;
  const red =
    redFrom == null
      ? null
      : {
          x: 60 + Math.cos(Math.PI * (1 - redFrom)) * 46,
          y: 62 - Math.sin(Math.PI * (1 - redFrom)) * 46,
        };
  return (
    <svg viewBox="0 0 120 74" className="w-full" aria-hidden>
      <path d="M14 62 A46 46 0 0 1 106 62" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" className="text-fg/15" />
      {red && <path d={`M ${red.x} ${red.y} A 46 46 0 0 1 106 62`} fill="none" stroke="currentColor" strokeWidth="7" className="text-hot/80" />}
      <path
        d="M14 62 A46 46 0 0 1 106 62"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${Math.max(0.01, len * p)} ${len}`}
        className={hot ? "text-hot" : "text-primary"}
      />
      {Array.from({ length: 9 }, (_, i) => {
        const tick = Math.PI - (i / 8) * Math.PI;
        const outer = i % 2 === 0 ? 46 : 43;
        return (
          <line
            key={i}
            x1={60 + Math.cos(tick) * 32}
            y1={62 - Math.sin(tick) * 32}
            x2={60 + Math.cos(tick) * outer}
            y2={62 - Math.sin(tick) * outer}
            stroke="currentColor"
            strokeWidth={i % 2 === 0 ? 1.6 : 1}
            className="text-fg/50"
          />
        );
      })}
      <line x1="60" y1="62" x2={tipX} y2={tipY} stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="text-fg" />
      <circle cx="60" cy="62" r="3.5" className="fill-fg" />
      <text x="16" y="72" className="fill-muted" fontSize="7">
        {marks[0]}
      </text>
      <text x="104" y="72" textAnchor="end" className="fill-muted" fontSize="7">
        {marks[1]}
      </text>
    </svg>
  );
}

function Toggle({ on, kicker, title, onClick }: { on: boolean; kicker: string; title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`pad dash flex h-20 ${on ? "pad-go" : ""}`}>
      <span className="dash-lamp" aria-hidden />
      <span className="dash-copy">
        <span className="dash-kicker">{kicker}</span>
        <span className="dash-title">{title}</span>
      </span>
    </button>
  );
}

function Slider({
  label,
  value,
  onChange,
  max = 100,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
  suffix?: string;
}) {
  return (
    <label className="pad flex items-center gap-3 px-4 py-3">
      <span className="w-28 shrink-0 text-sm font-medium text-muted">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        aria-label={label}
      />
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-fg">
        {suffix ? `${value} ${suffix}` : value}
      </span>
    </label>
  );
}
