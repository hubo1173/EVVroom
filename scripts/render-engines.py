#!/usr/bin/env python3
"""Seamless engine loops. Pulse rate is rpm/60 times pulses per revolution."""

import math
import struct
import wave
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "engines"
SR = 44100

# pulses/rev, level pattern, interval weights (or None = even), body Hz, brightness, sub, rasp, whistle Hz
SPECS = {
    "v8": (4, [1.0, 0.62, 0.92, 0.48], None, 95, 0.28, 1.0, 0.18, 0),
    "v8modern": (4, [1, 0.92, 0.97, 0.9], None, 140, 0.48, 0.62, 0.28, 0),
    "v6": (3, [1, 0.86, 0.94], None, 160, 0.42, 0.7, 0.32, 0),
    "v10": (5, [1, 0.9, 0.96, 0.88, 0.93], None, 180, 0.55, 0.55, 0.38, 0),
    "sport": (4, [1, 0.9, 0.95, 0.88], None, 210, 0.62, 0.45, 0.48, 0),
    "diesel": (3, [1, 0.8, 0.9], None, 70, 0.22, 1.15, 0.08, 0),
    "rotary": (2, [1, 0.84], None, 520, 0.9, 0.28, 0.85, 0),
    "v12": (6, [1, 0.97, 0.99, 0.96, 0.98, 0.95], None, 190, 0.5, 0.48, 0.22, 0),
    "inline4": (2, [1, 0.78], None, 150, 0.46, 0.55, 0.4, 1),
    "flat6": (3, [1, 0.94, 0.98], None, 340, 0.72, 0.38, 0.7, 0),
    "muscle": (4, [1, 0.5, 0.88, 0.4], None, 80, 0.22, 1.15, 0.14, 0),
    "viper10": (5, [1, 0.7, 1.05, 0.62, 0.92], [1.15, 0.72, 1.2, 0.68, 1.05], 150, 0.5, 0.8, 0.34, 0),
    "enzo": (6, [1, 0.98, 1, 0.97, 0.99, 0.96], None, 280, 0.78, 0.32, 0.55, 0),
    "countach": (6, [1, 0.75, 0.95, 0.7, 1.05, 0.72], None, 160, 0.58, 0.7, 0.48, 0),
    "audi10": (5, [1, 0.95, 0.98, 0.94, 0.97], None, 200, 0.52, 0.5, 0.3, 0.6),
}

RPMS = {
    "v8": [900, 2800, 5000],
    "v8modern": [800, 3000, 5600],
    "v6": [900, 2800, 5200],
    "v10": [1000, 3400, 6400],
    "sport": [1100, 3600, 6800],
    "diesel": [700, 1600, 2800],
    "rotary": [1400, 4000, 7200],
    "v12": [800, 3000, 5800],
    "inline4": [1000, 3200, 6000],
    "flat6": [1000, 3400, 6400],
    "muscle": [850, 2600, 4800],
    "viper10": [1000, 3600, 6800],
    "enzo": [1100, 3800, 7000],
    "countach": [950, 3400, 6600],
    "audi10": [1000, 3400, 6400],
}

EV = {
    "ev": (420, [1, 0.42, 0.2, 0.08], 0.035),
    "evcoast": (190, [1, 0.22, 0.06], 0.02),
    "evsport": (680, [1, 0.62, 0.3, 0.14], 0.045),
    "evdual": (360, [1, 0.48, 0.16], 0.03),
    "evregen": (130, [1, 0.55, 0.28, 0.1], 0.05),
}


def noise_at(i: int) -> float:
    x = (i * 1103515245 + 12345) & 0x7fffffff
    return (x / 0x7fffffff) * 2 - 1


def write_wav(path: Path, samples: list[float]) -> None:
    peak = max(1e-6, max(abs(s) for s in samples))
    scale = 0.72 / peak
    frames = b"".join(struct.pack("<h", max(-32767, min(32767, int(s * scale * 32767)))) for s in samples)
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(frames)


def render_engine(kind: str, rpm: int) -> list[float]:
    pulses, pattern, weights, body, bright, sub, rasp, whistle = SPECS[kind]
    rev = rpm / 60
    nrev = max(3, round(0.62 * rev))
    dur = nrev / rev
    n = int(SR * dur)
    if weights is None:
        weights = [1] * pulses
    weight_sum = sum(weights)
    edges = []
    acc = 0.0
    for w in weights:
        acc += w / weight_sum
        edges.append(acc)

    def pulse_age(frac: float) -> tuple[int, float]:
        prev = 0.0
        for i, edge in enumerate(edges):
            if frac < edge or i == len(edges) - 1:
                span = edge - prev
                local = 0 if span <= 0 else (frac - prev) / span
                return i, local / pulses / rev if False else local * (span / rev)
            prev = edge
        return 0, 0.0

    period_guess = (1 / pulses) / rev
    decay = min(0.03, max(0.004, period_guess * 0.72))
    if kind == "diesel":
        decay = min(0.012, period_guess * 0.35)
    if kind == "rotary":
        decay = min(0.02, period_guess * 0.9)

    whistle_hz = 0.0
    if whistle:
        base = 1400 + rpm * whistle
        cycles = max(1, round(base * dur))
        whistle_hz = cycles / dur

    firing = pulses * rev
    open_up = 0.65 + 0.7 * min(1, rpm / 6000)
    tone_cut = (0.025 + bright * 0.14) * open_up
    if kind in ("flat6", "enzo", "rotary", "sport"):
        tone_cut += 0.05
    out = [0.0] * n
    lp = 0.0
    tone = 0.0
    for _pass in range(2):
        buf = [0.0] * n
        for i in range(n):
            t = i / SR
            frac = (t * rev) % 1
            idx, age = pulse_age(frac)
            amp = pattern[idx % len(pattern)]
            env = math.exp(-age / decay)
            white = noise_at(i)
            cut = 0.015 + bright * 0.22
            lp += cut * (white - lp)
            hp = white - lp
            thump_f = body * (0.55 + 0.45 * env)
            thump = math.sin(2 * math.pi * thump_f * age) * env
            clack = hp * math.exp(-age / 0.0015) * 0.55 if kind == "diesel" else 0.0
            sig = thump * sub * 0.8
            sig += lp * env * (0.25 + bright * 0.35)
            sig += hp * math.exp(-age / (decay * 0.35)) * rasp * 0.16
            sig += clack
            harmonics = 4 + int(bright * 6)
            for k in range(1, harmonics + 1):
                sig += (0.28 / k) * math.sin(2 * math.pi * firing * k * t)
            if kind == "rotary":
                sig += 0.12 * math.sin(2 * math.pi * min(1800, firing * 4) * t)
            tone_cut_s = tone_cut
            tone += tone_cut_s * (sig * amp - tone)
            if whistle_hz:
                tone += 0.07 * math.sin(2 * math.pi * whistle_hz * t)
            buf[i] = tone
        out = buf
    mean = sum(out) / len(out)
    return [s - mean for s in out]


def render_ev(kind: str) -> list[float]:
    base, harms, noise = EV[kind]
    dur = 1.0
    n = SR
    f0 = round(base)
    extra = round(f0 * 1.045) if kind == "evdual" else 0
    pulse = 6 if kind != "evregen" else 3
    out = []
    lp = 0.0
    for i in range(n):
        t = i / SR
        sig = 0.0
        for h, amp in enumerate(harms, start=1):
            sig += amp * math.sin(2 * math.pi * f0 * h * t)
        if extra:
            sig += 0.55 * math.sin(2 * math.pi * extra * t)
        env = 0.86 + 0.14 * math.sin(2 * math.pi * pulse * t)
        white = noise_at(i)
        lp += 0.03 * (white - lp)
        sig = sig * 0.22 * env + lp * noise * 4
        out.append(sig)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    names = ["low", "mid", "high"]
    for kind, rpms in RPMS.items():
        for rpm, name in zip(rpms, names):
            samples = render_engine(kind, rpm)
            write_wav(OUT / f"{kind}-{name}.wav", samples)
            print(f"{kind}-{name}.wav {len(samples) / SR:.2f}s @ {rpm} rpm")
    for kind in EV:
        write_wav(OUT / f"{kind}.wav", render_ev(kind))
        print(f"{kind}.wav")


if __name__ == "__main__":
    main()
