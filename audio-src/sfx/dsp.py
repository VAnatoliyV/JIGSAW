"""Small DSP toolkit for the Albion Journal SFX library (numpy/scipy only).

Conventions
- SR = 48 kHz, float64 internally, stereo arrays are shaped (n, 2).
- All filters are CAUSAL (sosfilt), so nothing rings before a transient and the
  accent sample of a sound never moves earlier than where it was designed.
- Every random source takes an explicit integer seed -> fully deterministic.
"""
from __future__ import annotations

import functools

import numpy as np
from scipy import signal

SR = 48000


# ----------------------------------------------------------------- basics
def rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(int(seed) & 0xFFFFFFFF)


def ns(sec: float) -> int:
    """seconds -> samples"""
    return int(round(sec * SR))


def taxis(n: int) -> np.ndarray:
    return np.arange(n) / SR


def db(x):
    return 20.0 * np.log10(np.maximum(np.abs(x), 1e-12))


def undb(d):
    return 10.0 ** (np.asarray(d) / 20.0)


def pad_to(x: np.ndarray, n: int) -> np.ndarray:
    if len(x) >= n:
        return x[:n]
    shape = (n - len(x),) + x.shape[1:]
    return np.concatenate([x, np.zeros(shape)], axis=0)


def place(dst: np.ndarray, src: np.ndarray, start: int, gain=1.0):
    """Add src into dst at sample `start` (clipped to dst bounds). Works mono or stereo."""
    a, b = start, start + len(src)
    sa, sb = 0, len(src)
    if a < 0:
        sa, a = -a, 0
    if b > len(dst):
        sb -= b - len(dst)
        b = len(dst)
    if sb > sa:
        dst[a:b] += gain * src[sa:sb]


def stereo(x: np.ndarray) -> np.ndarray:
    return x if x.ndim == 2 else np.stack([x, x], axis=1)


def mono(x: np.ndarray) -> np.ndarray:
    return x if x.ndim == 1 else x.mean(axis=1)


# ---------------------------------------------------------------- filters
@functools.lru_cache(maxsize=256)
def _sos(kind: str, f, order: int):
    if isinstance(f, tuple):
        wn = [min(max(v, 5.0), SR / 2 * 0.98) for v in f]
    else:
        wn = min(max(f, 5.0), SR / 2 * 0.98)
    return signal.butter(order, wn, btype=kind, fs=SR, output="sos")


def lp(x, fc, order=2):
    return signal.sosfilt(_sos("lowpass", float(fc), order), x, axis=0)


def hp(x, fc, order=2):
    return signal.sosfilt(_sos("highpass", float(fc), order), x, axis=0)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos("bandpass", (float(lo), float(hi)), order), x, axis=0)


def peak_eq(x, f0, gain_db, q=1.0):
    """RBJ peaking biquad (causal)."""
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / SR
    al = np.sin(w) / (2 * q)
    b = np.array([1 + al * A, -2 * np.cos(w), 1 - al * A])
    a = np.array([1 + al / A, -2 * np.cos(w), 1 - al / A])
    return signal.lfilter(b / a[0], a / a[0], x, axis=0)


def dc_block(x, fc=16.0):
    return hp(x, fc, order=2)


# ------------------------------------------------------------- envelopes
def fade(x: np.ndarray, fin=0.0, fout=0.0) -> np.ndarray:
    """Raised-cosine fade in/out (seconds)."""
    x = x.copy()
    n_in, n_out = ns(fin), ns(fout)
    if n_in > 0:
        w = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n_in))
        x[:n_in] *= w[:, None] if x.ndim == 2 else w
    if n_out > 0:
        w = 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n_out))
        x[-n_out:] *= w[:, None] if x.ndim == 2 else w
    return x


def decay_env(n, tau, attack=0.0005, hold=0.0):
    """Linear attack (seconds) -> hold -> exponential decay with time constant tau.
    Peak (1.0) is at sample ns(attack)."""
    t = taxis(n)
    env = np.exp(-np.maximum(t - attack - hold, 0.0) / tau)
    na = ns(attack)
    if na > 0:
        env[:na] = np.linspace(0, 1, na, endpoint=False)
    return env


def t60_env(n, t60, attack=0.0005):
    return decay_env(n, t60 / 6.9078, attack)


# ---------------------------------------------------------------- sources
def noise(n, seed, ch=1):
    r = rng(seed)
    return r.standard_normal((n, ch)) if ch > 1 else r.standard_normal(n)


def pink(n, seed):
    """Pink-ish noise via 1/f spectral shaping."""
    r = rng(seed)
    X = np.fft.rfft(r.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    X /= np.sqrt(np.maximum(f, 20.0))
    y = np.fft.irfft(X, n)
    return y / (np.std(y) + 1e-12)


def phase_from_freq(f_inst, phase0=0.0):
    """Integrate an instantaneous-frequency curve (Hz per sample) into phase (rad)."""
    return phase0 + 2 * np.pi * np.cumsum(f_inst) / SR - 2 * np.pi * f_inst[0] / SR


def damped_sine(n, freq, tau, amp=1.0, attack=0.0003, phase=0.0, glide=None):
    """Exponentially decaying sine. `glide` = (f_start, time_const) for a pitch drop to `freq`."""
    t = taxis(n)
    if glide is None:
        ph = 2 * np.pi * freq * t + phase
    else:
        f0, tc = glide
        finst = freq + (f0 - freq) * np.exp(-t / tc)
        ph = phase_from_freq(finst, phase)
    return amp * np.sin(ph) * decay_env(n, tau, attack)


def modal(n, f0, ratios, amps, t60s, seed=0, detune_hz=0.0, attack=0.0003, phases=None):
    """Sum of decaying partials (modal synthesis). Optional beating pairs (detune_hz)."""
    r = rng(seed)
    out = np.zeros(n)
    t = taxis(n)
    for i, (ra, a, t6) in enumerate(zip(ratios, amps, t60s)):
        f = f0 * ra
        if f >= SR * 0.45:
            continue
        ph = r.uniform(0, 2 * np.pi) if phases is None else phases[i]
        env = t60_env(n, t6, attack)
        if detune_hz:
            d = detune_hz * r.uniform(0.6, 1.4)
            out += a * env * 0.5 * (np.sin(2 * np.pi * (f - d / 2) * t + ph) + np.sin(2 * np.pi * (f + d / 2) * t + ph * 1.3))
        else:
            out += a * env * np.sin(2 * np.pi * f * t + ph)
    return out


def additive_saw(freq, cutoff, amp=None, phase0=0.0, max_h=80):
    """Band-limited sawtooth with time-varying pitch `freq` (array, Hz) and a smooth
    time-varying low-pass `cutoff` (array, Hz) applied per harmonic (no aliasing)."""
    n = len(freq)
    ph = phase_from_freq(freq, phase0)
    out = np.zeros(n)
    for k in range(1, max_h + 1):
        fk = k * freq
        if fk.min() > 19000:
            break
        w = 1.0 / (1.0 + (fk / cutoff) ** 4)          # 4th-order-ish LP magnitude
        w *= np.clip((19500 - fk) / 1500, 0, 1)       # anti-alias taper
        out += w * np.sin(k * ph) / k
    if amp is not None:
        out *= amp
    return out


def shaped_noise(n, seed, mag_fn, nfft=1024, hop=128):
    """Noise whose spectrum follows mag_fn(times[s] (T,), freqs[Hz] (F,)) -> (F, T).
    Built in the STFT domain with random phase (perfect for swept-filter noise:
    whooshes, risers, cymbals, reverb IRs). Output RMS is normalised to ~1."""
    r = rng(seed)
    nfr = int(np.ceil(n / hop)) + 2
    times = (np.arange(nfr) * hop) / SR
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    mag = mag_fn(times, freqs)
    ph = r.uniform(0, 2 * np.pi, mag.shape)
    Z = mag * np.exp(1j * ph)
    _, y = signal.istft(Z, fs=SR, window="hann", nperseg=nfft, noverlap=nfft - hop, boundary=True)
    y = pad_to(y, n)
    return y / (np.sqrt(np.mean(y ** 2)) + 1e-12)


def lognorm_band(freqs, fc, width_oct):
    """Gaussian band in log-frequency. fc (T,) or scalar; returns (F, T)."""
    lf = np.log2(np.maximum(freqs, 1.0))[:, None]
    lc = np.log2(np.maximum(np.atleast_1d(fc), 1.0))[None, :]
    w = np.atleast_1d(width_oct)[None, :]
    return np.exp(-0.5 * ((lf - lc) / w) ** 2)


# ------------------------------------------------------------------- space
@functools.lru_cache(maxsize=16)
def reverb_ir(name: str):
    """Synthetic stereo IRs shared by the whole library (cohesive 'room')."""
    presets = {
        # name: (seconds, rt60_low, rt60_high, f_split, predelay, hf_cut, seed)
        "hall_dark": (3.2, 2.4, 0.55, 2500.0, 0.018, 6000.0, 101),
        "chamber_dark": (1.8, 1.1, 0.35, 2500.0, 0.012, 6000.0, 151),
        "room":      (0.9, 0.45, 0.22, 4000.0, 0.006, 12000.0, 202),
        "plate":     (2.6, 1.7, 1.05, 6000.0, 0.010, 16000.0, 303),
    }
    secs, rlo, rhi, fs_, pre, hfc, seed = presets[name]
    n = ns(secs)

    def mag(times, freqs):
        x = np.clip(np.log2(np.maximum(freqs, 30) / 200.0) / np.log2(fs_ / 200.0), 0, 1)
        rt = rlo + (rhi - rlo) * x                         # rt60 per bin
        tilt = 1.0 / (1.0 + (freqs / hfc) ** 2)
        m = tilt[:, None] * 10 ** (-3.0 * times[None, :] / rt[:, None])
        return m
    ir = np.stack([shaped_noise(n, seed + c, mag, nfft=512, hop=64) for c in range(2)], axis=1)
    # density build-up over the first ~12 ms, predelay
    build = 1 - np.exp(-taxis(n) / 0.004)
    ir *= build[:, None]
    ir = np.concatenate([np.zeros((ns(pre), 2)), ir], axis=0)
    ir = fade(ir, 0, 0.05)
    ir /= np.sqrt(np.sum(ir ** 2) / 2)                  # unit energy per channel
    return ir


def reverb(x, name, wet_db, out_len=None):
    """Return ONLY the wet signal (stereo) for x (mono or stereo)."""
    ir = reverb_ir(name)
    xs = stereo(x)
    y = np.stack([signal.fftconvolve(xs[:, c], ir[:, c]) for c in range(2)], axis=1)
    if out_len is not None:
        y = pad_to(y, out_len)
    return y * undb(wet_db)


# ------------------------------------------------------------------ stereo
def pan(x, p):
    """Constant-power pan, p in [-1, 1] (scalar or per-sample array)."""
    th = (np.asarray(p) + 1) * np.pi / 4
    return np.stack([x * np.cos(th), x * np.sin(th)], axis=1) * np.sqrt(2)


def widen(x_st, amount):
    m = (x_st[:, 0] + x_st[:, 1]) / 2
    s = (x_st[:, 0] - x_st[:, 1]) / 2 * amount
    return np.stack([m + s, m - s], axis=1)


# --------------------------------------------------------------- dynamics
def saturate(x, drive=1.5):
    return np.tanh(drive * x) / np.tanh(drive)


def oversampled_abs(x, factor=4):
    xs = stereo(x)
    up = signal.resample_poly(xs, factor, 1, axis=0)
    return np.abs(up).max(axis=1)


def true_peak_db(x):
    return float(db(oversampled_abs(x).max()))


def sample_peak_db(x):
    return float(db(np.abs(x).max()))


def normalize_peak(x, target_db):
    pk = np.abs(x).max()
    return x * (undb(target_db) / pk) if pk > 0 else x


def soft_limiter(x, ceiling_db=-1.3, lookahead=0.004, release=0.120, knee_db=3.0, block=16):
    """Zero-latency offline look-ahead limiter driven by a 4x-oversampled (true-peak)
    detector. Gain is computed per 16-sample block, held for the look-ahead window,
    ramped down ahead of each peak (no clicks), released exponentially, and finally
    interpolated back to audio rate. A soft knee starts gentle gain reduction
    `knee_db` below the ceiling so the limiting is transparent."""
    xs = stereo(x).astype(np.float64)
    n = len(xs)
    det = oversampled_abs(xs, 4)
    det = det[: 4 * n].reshape(n, 4).max(axis=1)
    ceil = undb(ceiling_db)
    knee_lo = undb(ceiling_db - knee_db)
    # static curve: below knee 1:1, in knee soft-compress, above -> ceiling
    lvl = np.maximum(det, 1e-9)
    out_lvl = np.where(
        lvl <= knee_lo, lvl,
        knee_lo + (ceil - knee_lo) * np.tanh((lvl - knee_lo) / (ceil - knee_lo)),
    )
    g = np.minimum(1.0, out_lvl / lvl)
    nb = int(np.ceil(n / block))
    gb = np.ones(nb)
    gpad = np.concatenate([g, np.ones(nb * block - n)])
    gb = gpad.reshape(nb, block).min(axis=1)
    # protect neighbours so interpolation never overshoots the target
    gb = np.minimum(gb, np.minimum(np.r_[gb[1:], 1.0], np.r_[1.0, gb[:-1]]))
    la = max(1, int(round(lookahead * SR / block)))
    rel = np.exp(-block / (release * SR))
    # hold over look-ahead window (sliding min, forward-looking)
    from scipy.ndimage import minimum_filter1d
    held = minimum_filter1d(gb, size=2 * la + 1, mode="nearest")
    # release (forward pass, rises back toward 1)
    out = np.empty(nb)
    cur = 1.0
    for i in range(nb):
        tgt = held[i]
        cur = tgt if tgt < cur else tgt + (cur - tgt) * rel
        out[i] = cur
    # attack ramp (backward pass): never drop faster than linear over the look-ahead
    step = 1.0 / la
    for i in range(nb - 2, -1, -1):
        if out[i] > out[i + 1] + step * (1 - out[i + 1]):
            out[i] = out[i + 1] + step * (1 - out[i + 1])
    centers = np.arange(nb) * block + block / 2
    gs = np.interp(np.arange(n), centers, out)
    gs = np.minimum(gs, 1.0)
    return xs * gs[:, None], gs
