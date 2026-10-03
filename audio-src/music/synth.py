"""numpy-synthesised layers: sub booms under hits, risers, reverse cymbals,
sub swell, low drone, anvil clangs."""
from __future__ import annotations

import numpy as np
from scipy import signal

from dsp import SR, hp, lp

_rng = np.random.default_rng(4242)

BOOMS = {
    #        f_start f_end tau_f  decay  amp   drive
    'small': (125.0, 54.0, 0.040, 0.14, 0.28, 1.6),
    'med':   (112.0, 47.0, 0.050, 0.24, 0.50, 1.7),
    'hook':  (110.0, 43.0, 0.060, 0.26, 0.56, 1.9),
    'big':   (115.0, 40.0, 0.070, 0.42, 0.85, 2.0),
    'huge':  (120.0, 37.0, 0.085, 0.62, 1.00, 2.2),
}


def boom(size: str) -> np.ndarray:
    f0, f1, tau_f, decay, amp, drive = BOOMS[size]
    n = int(decay * 5 * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / tau_f)
    ph = 2 * np.pi * np.cumsum(f) / SR
    env = (1 - np.exp(-t / 0.0012)) * np.exp(-t / decay)
    y = np.sin(ph) * env
    y = np.tanh(drive * y) / np.tanh(drive)
    # transient "thump": short low-passed noise burst, starts exactly at t=0
    nz = lp(_rng.standard_normal(n), 3500, order=2)
    click = nz * np.exp(-t / 0.008) * 0.30
    y = (y + click) * amp
    y[-int(0.05 * SR):] *= np.linspace(1, 0, int(0.05 * SR))
    return np.stack([y, y], axis=1)


def riser(dur: float, level: float = 1.0) -> np.ndarray:
    """Filtered-noise riser + gliding tones; ends exactly at `dur`."""
    n = int(round(dur * SR))
    t = np.arange(n) / SR
    x = t / dur
    out = np.zeros((n, 2))
    nper = 2048
    for ch in range(2):
        nz = _rng.standard_normal(n + nper)
        f, tt, Z = signal.stft(nz, fs=SR, nperseg=nper, noverlap=nper * 3 // 4)
        xc = np.clip(tt / dur, 0, 1)
        fc = 250 * (7000 / 250) ** xc                       # centre glides up
        lf = np.log2(np.maximum(f, 20))[:, None]
        shape = np.exp(-0.5 * ((lf - np.log2(fc)[None, :]) / 1.1) ** 2) + 0.06
        _, y = signal.istft(Z * shape, fs=SR, nperseg=nper, noverlap=nper * 3 // 4)
        out[:, ch] = y[:n] / (np.abs(y[:n]).max() + 1e-9)
    tone = np.zeros(n)
    for base, a in ((110.0, 0.5), (220.0, 0.35), (330.0, 0.18)):
        fr = base * 2 ** (2.0 * x)                           # up two octaves
        tone += a * np.sin(2 * np.pi * np.cumsum(fr) / SR)
    env = 10 ** ((-34 + 34 * x ** 1.6) / 20)
    y = out * 0.55 + tone[:, None] * 0.28
    y *= env[:, None] * level
    return suck_out(y)


def suck_out(y, fade=0.09, hold=0.012):
    """Pull the build away in the last ~0.1 s so the impact lands on a clean
    edge (classic trailer 'suck' before the hit)."""
    n = len(y)
    f = int(fade * SR)
    h = int(hold * SR)
    env = np.ones(n)
    env[n - f - h:n - h] = np.cos(0.5 * np.pi * np.linspace(0, 1, f)) ** 2
    env[n - h:] = 0.0
    return y * env[:, None]


def reverse_cymbal(crash: np.ndarray, dur: float, level: float = 1.0) -> np.ndarray:
    """Reversed crash: the crash is cut at its loudest point (after its ~40 ms
    bloom) before reversing, so the swell peaks exactly at the end of the buffer
    (= the impact) and never forms an early transient of its own."""
    env = np.abs(crash).max(axis=1)
    k0 = int(np.argmax(env))
    src = crash[k0:]
    seg = int(min(len(src), (dur * 1.8 + 0.2) * SR))
    y = src[:seg][::-1].copy()
    n = int(round(dur * SR))
    y = y[-n:] if len(y) >= n else np.vstack([np.zeros((n - len(y), 2)), y])
    x = np.linspace(0, 1, n)
    y *= (x ** 1.8)[:, None]
    y /= (np.abs(y).max() + 1e-9)
    return suck_out(y * level * 0.55)


def swell(dur: float) -> np.ndarray:
    n = int(round(dur * SR))
    t = np.arange(n) / SR
    x = t / dur
    f = 38 + 14 * x
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * (x ** 2.2) * 0.55
    nz = lp(_rng.standard_normal(n), 400, order=2) * (x ** 3) * 0.25
    y = y + nz
    fade = int(0.004 * SR)
    y[-fade:] *= np.linspace(1, 0, fade)
    return np.stack([y, y], axis=1)


def subdrone(dur: float, f: float, level: float, fade_in: float, fade_out: float) -> np.ndarray:
    n = int(round(dur * SR))
    t = np.arange(n) / SR
    am = 1 + 0.12 * np.sin(2 * np.pi * 0.23 * t)
    y = (np.sin(2 * np.pi * f * t) + 0.55 * np.sin(2 * np.pi * 2 * f * t + 0.7)
         + 0.18 * np.sin(2 * np.pi * 3 * f * t + 1.3)) * am
    env = np.ones(n)
    fi, fo = int(fade_in * SR), int(fade_out * SR)
    env[:fi] = np.linspace(0, 1, fi) ** 2
    env[-fo:] *= np.linspace(1, 0, fo) ** 1.5
    y = np.tanh(1.2 * y * env) * level * 0.35
    return np.stack([y, y], axis=1)


def anvil(vel: float) -> np.ndarray:
    """Hammer-on-anvil clang tuned around D (inharmonic partials)."""
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    base = 587.33 * 2                                         # D6
    partials = [(1.0, 1.0, 0.55), (1.502, 0.55, 0.35), (2.76, 0.45, 0.22),
                (3.98, 0.30, 0.16), (5.40, 0.22, 0.10), (0.5, 0.35, 0.25)]
    y = np.zeros(n)
    for ratio, a, dec in partials:
        y += a * np.sin(2 * np.pi * base * ratio * t + _rng.uniform(0, 6.28)) * np.exp(-t / dec)
    click = hp(_rng.standard_normal(n), 2500) * np.exp(-t / 0.003) * 0.6
    y = (y + click) * (1 - np.exp(-t / 0.0005))
    y *= 0.16 * vel
    l = y * 0.85
    r = np.concatenate([np.zeros(12), y[:-12]])
    return np.stack([l, r], axis=1)
