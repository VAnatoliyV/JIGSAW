"""DSP helpers: EQ, panning, synthetic hall reverb, bus compressor, true-peak
limiter, BS.1770 loudness."""
from __future__ import annotations

import numpy as np
from scipy import signal

SR = 48000


# ----------------------------------------------------------------------------
# Filters
# ----------------------------------------------------------------------------
def hp(x, f, order=2, sr=SR):
    sos = signal.butter(order, f, 'highpass', fs=sr, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def lp(x, f, order=2, sr=SR):
    sos = signal.butter(order, f, 'lowpass', fs=sr, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def peaking(x, f0, gain_db, q=1.0, sr=SR):
    a = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    alpha = np.sin(w0) / (2 * q)
    b = np.array([1 + alpha * a, -2 * np.cos(w0), 1 - alpha * a])
    den = np.array([1 + alpha / a, -2 * np.cos(w0), 1 - alpha / a])
    return signal.lfilter(b / den[0], den / den[0], x, axis=0)


def low_shelf(x, f0, gain_db, sr=SR):
    a = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    alpha = np.sin(w0) / 2 * np.sqrt(2)
    cw = np.cos(w0)
    b0 = a * ((a + 1) - (a - 1) * cw + 2 * np.sqrt(a) * alpha)
    b1 = 2 * a * ((a - 1) - (a + 1) * cw)
    b2 = a * ((a + 1) - (a - 1) * cw - 2 * np.sqrt(a) * alpha)
    a0 = (a + 1) + (a - 1) * cw + 2 * np.sqrt(a) * alpha
    a1 = -2 * ((a - 1) + (a + 1) * cw)
    a2 = (a + 1) + (a - 1) * cw - 2 * np.sqrt(a) * alpha
    return signal.lfilter(np.array([b0, b1, b2]) / a0, np.array([a0, a1, a2]) / a0, x, axis=0)


# ----------------------------------------------------------------------------
# Stereo placement
# ----------------------------------------------------------------------------
def place(x, pan=0.0, width=1.0):
    """x: (n,2).  Constant-power pan of the mid signal, side scaled by width."""
    m = 0.5 * (x[:, 0] + x[:, 1])
    s = 0.5 * (x[:, 0] - x[:, 1]) * width
    th = (pan + 1) * np.pi / 4
    gl, gr = np.cos(th) * np.sqrt(2), np.sin(th) * np.sqrt(2)
    out = np.empty_like(x)
    out[:, 0] = m * gl + s
    out[:, 1] = m * gr - s
    return out


# ----------------------------------------------------------------------------
# Reverb
# ----------------------------------------------------------------------------
def make_hall_ir(rt60=2.2, predelay=0.020, length=3.4, seed=11, sr=SR):
    """Synthetic stereo hall IR: frequency-dependent exponential decay of
    decorrelated noise, diffuse build-up, a handful of early reflections."""
    rng = np.random.default_rng(seed)
    n = int(length * sr)
    t = np.arange(n) / sr
    bands = [(None, 250, rt60 * 1.05), (250, 1000, rt60), (1000, 4000, rt60 * 0.85),
             (4000, 8000, rt60 * 0.6), (8000, None, rt60 * 0.38)]
    ir = np.zeros((n, 2))
    for ch in range(2):
        noise = rng.standard_normal(n)
        acc = np.zeros(n)
        for lo_, hi_, rt in bands:
            if lo_ is None:
                sos = signal.butter(4, hi_, 'lowpass', fs=sr, output='sos')
            elif hi_ is None:
                sos = signal.butter(4, lo_, 'highpass', fs=sr, output='sos')
            else:
                sos = signal.butter(4, [lo_, hi_], 'bandpass', fs=sr, output='sos')
            acc += signal.sosfiltfilt(sos, noise) * 10 ** (-3 * t / rt)
        acc *= 1 - np.exp(-t / 0.018)
        # early reflections (first 80 ms), slightly different per side
        er_t = rng.uniform(0.006, 0.08, 14)
        er_g = rng.uniform(0.25, 0.7, 14) * np.exp(-er_t / 0.05)
        for et, eg in zip(er_t, er_g):
            k = int(et * sr)
            acc[k] += eg * np.sqrt((acc[:2000] ** 2).mean()) * 30 * rng.choice([-1, 1])
        ir[:, ch] = acc
    ir /= np.sqrt((ir ** 2).sum(axis=0, keepdims=True))
    pad = np.zeros((int(predelay * sr), 2))
    return np.vstack([pad, ir])


def reverb(send, ir, sr=SR):
    """send: (n,2) -> wet (n,2) (same length, tail beyond is dropped)."""
    x = hp(send, 220, order=2, sr=sr)
    x = lp(x, 9500, order=2, sr=sr)
    n = len(x)
    inl = 0.72 * x[:, 0] + 0.28 * x[:, 1]
    inr = 0.72 * x[:, 1] + 0.28 * x[:, 0]
    wl = signal.oaconvolve(inl, ir[:, 0])[:n]
    wr = signal.oaconvolve(inr, ir[:, 1])[:n]
    return np.stack([wl, wr], axis=1)


# ----------------------------------------------------------------------------
# Loudness (ITU-R BS.1770-4 K-weighting)
# ----------------------------------------------------------------------------
_KB1 = np.array([1.53512485958697, -2.69169618940638, 1.19839281085285])
_KA1 = np.array([1.0, -1.69065929318241, 0.73248077421585])
_KB2 = np.array([1.0, -2.0, 1.0])
_KA2 = np.array([1.0, -1.99004745483398, 0.99007225036621])


def kweight(x):
    y = signal.lfilter(_KB1, _KA1, x, axis=0)
    return signal.lfilter(_KB2, _KA2, y, axis=0)


def window_loudness(x, win_s, hop_s, sr=SR):
    """Returns (times_at_window_end, LUFS) for sliding windows."""
    y = kweight(x)
    p = (y ** 2).sum(axis=1)
    c = np.concatenate([[0.0], np.cumsum(p)])
    w = int(win_s * sr)
    h = int(hop_s * sr)
    ends = np.arange(w, len(p) + 1, h)
    ms = (c[ends] - c[ends - w]) / w
    return ends / sr, -0.691 + 10 * np.log10(ms + 1e-20)


def segment_loudness(x, t0, t1, sr=SR):
    y = kweight(x[int(t0 * sr):int(t1 * sr)])
    ms = (y ** 2).mean(axis=0).sum()
    return -0.691 + 10 * np.log10(ms + 1e-20)


def integrated_loudness(x, sr=SR):
    import pyloudnorm as pyln
    return pyln.Meter(sr).integrated_loudness(x)


def true_peak(x, os=4, chunk=1 << 20):
    peak = 0.0
    n = len(x)
    for s in range(0, n, chunk):
        a = max(0, s - 64)
        b = min(n, s + chunk + 64)
        y = signal.resample_poly(x[a:b], os, 1, axis=0)
        peak = max(peak, float(np.abs(y).max()))
    return peak


def tp_envelope(x, os=4, chunk=1 << 19):
    """Per-sample max |x| over the 4x oversampled stream (stereo-linked)."""
    n = len(x)
    env = np.zeros(n)
    for s in range(0, n, chunk):
        a = max(0, s - 64)
        b = min(n, s + chunk + 64)
        y = np.abs(signal.resample_poly(x[a:b], os, 1, axis=0)).max(axis=1)
        y = y[: (b - a) * os].reshape(b - a, os).max(axis=1)
        env[s:min(n, s + chunk)] = y[s - a: s - a + min(chunk, n - s)]
    return np.maximum(env, np.abs(x).max(axis=1))


# ----------------------------------------------------------------------------
# Dynamics
# ----------------------------------------------------------------------------
def compressor_gain(x, thr_db=-16.0, ratio=2.0, knee_db=6.0, attack=0.025, release=0.25,
                    rms_win=0.010, block=32, sr=SR):
    """Feed-forward RMS compressor; returns per-sample linear gain (stereo-linked)."""
    p = (x ** 2).mean(axis=1)
    w = int(rms_win * sr)
    c = np.concatenate([[0.0], np.cumsum(p)])
    idx = np.arange(len(p))
    lo = np.maximum(0, idx - w)
    rms = np.sqrt((c[idx + 1] - c[lo]) / np.maximum(1, idx + 1 - lo))
    nb = len(p) // block + 1
    lvl = 20 * np.log10(np.maximum(rms[::block][:nb], 1e-9))
    over = lvl - thr_db
    gr = np.where(over <= -knee_db / 2, 0.0,
                  np.where(over >= knee_db / 2, over * (1 - 1 / ratio),
                           (1 - 1 / ratio) * (over + knee_db / 2) ** 2 / (2 * knee_db)))
    a_att = np.exp(-block / (attack * sr))
    a_rel = np.exp(-block / (release * sr))
    g = np.zeros_like(gr)
    prev = 0.0
    for i in range(len(gr)):
        target = gr[i]
        coef = a_att if target > prev else a_rel
        prev = coef * prev + (1 - coef) * target
        g[i] = prev
    centers = np.arange(len(g)) * block
    gain_db = -np.interp(idx, centers, g)
    return 10 ** (gain_db / 20)


def limiter_gain(x, ceiling_db=-1.3, lookahead_ms=2.0, release_ms=80.0, block=16, sr=SR):
    """True-peak lookahead limiter gain (per sample, stereo-linked)."""
    ceil = 10 ** (ceiling_db / 20)
    env = tp_envelope(x)
    req = np.minimum(1.0, ceil / np.maximum(env, 1e-12))
    n = len(req)
    nb = int(np.ceil(n / block))
    reqp = np.concatenate([req, np.ones(nb * block - n)])
    reqb = reqp.reshape(nb, block).min(axis=1)
    k = max(1, int(round(lookahead_ms * 1e-3 * sr / block)))
    h = k
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    # window [b-h-1, b+k+h]
    size = 2 * h + k + 2
    origin = h + 1 - size // 2          # window = [b-h-1, b+k+h]
    tgt = minimum_filter1d(np.log(reqb), size=size, origin=origin, mode='nearest')
    rel = (block / sr) / (release_ms * 1e-3) * np.log(10 ** (6 / 20))  # ~6 dB per release time
    g = np.empty(nb)
    prev = 0.0
    for i in range(nb):
        v = prev + rel
        if v > 0:
            v = 0.0
        if tgt[i] < v:
            v = tgt[i]
        g[i] = v
        prev = v
    gs = uniform_filter1d(g, size=2 * h + 1, mode='nearest')
    gs = np.minimum(gs, tgt)
    centers = np.arange(nb) * block + block / 2
    gl = np.exp(np.interp(np.arange(n), centers, gs))
    return np.minimum(gl, np.exp(np.interp(np.arange(n), centers, tgt)))


def apply_gain(x, g):
    return x * g[:, None]
