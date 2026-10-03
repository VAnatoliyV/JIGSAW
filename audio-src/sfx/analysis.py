"""Measurement + visual verification for the SFX build.

All measurement filters are ZERO-PHASE (sosfiltfilt) so they cannot bias timing.
"""
from __future__ import annotations

import shutil
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import signal
from scipy.ndimage import maximum_filter1d, median_filter

from dsp import SR, mono, stereo

# ------------------------------------------------------------------ loudness
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def k_weight(x):
    y = signal.lfilter(*_K1, stereo(x), axis=0)
    return signal.lfilter(*_K2, y, axis=0)


def momentary_max_lufs(x, win=0.4):
    """Max BS.1770 K-weighted loudness over a sliding window (400 ms = 'momentary';
    50 ms is used as a transient-loudness proxy for very short UI sounds). Short
    sounds are measured inside a zero-padded window, as a meter would see them."""
    y = k_weight(np.concatenate([stereo(x), np.zeros((int(win * SR), 2))]))
    ms = (y ** 2).sum(axis=1)
    w = int(win * SR)
    c = np.concatenate([[0.0], np.cumsum(ms)])
    hop = int(min(0.01, win / 4) * SR)
    idx = np.arange(0, len(ms) - w + 1, hop)
    m = (c[idx + w] - c[idx]) / w
    return float(-0.691 + 10 * np.log10(max(m.max(), 1e-20)))


def integrated_lufs(x):
    import pyloudnorm as pyln
    return float(pyln.Meter(SR).integrated_loudness(stereo(x)))


def ffmpeg_ebur128(path):
    """Cross-check with ffmpeg's ebur128 filter (true-peak mode)."""
    if not shutil.which("ffmpeg"):
        return None
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true",
                        "-f", "null", "-"], capture_output=True, text=True)
    txt = p.stderr
    out = {}
    try:
        summ = txt[txt.rindex("Summary:"):]
        for line in summ.splitlines():
            line = line.strip()
            if line.startswith("I:"):
                out["I_LUFS"] = float(line.split()[1])
            elif line.startswith("LRA:"):
                out["LRA_LU"] = float(line.split()[1])
            elif line.startswith("Peak:"):
                out["TP_dBFS"] = float(line.split()[1])
    except ValueError:
        pass
    return out


# ------------------------------------------------------------------ envelopes
def _zp(kind, f, x, order=4):
    sos = signal.butter(order, f, btype=kind, fs=SR, output="sos")
    return signal.sosfiltfilt(sos, x)


def smooth(x, win_s):
    w = max(1, int(win_s * SR))
    k = np.hanning(w + 2)[1:-1]
    k /= k.sum()
    return signal.fftconvolve(x, k, mode="same")


def hf_envelope(x, f_hp=2000.0, win=0.001):
    y = _zp("highpass", f_hp, mono(x))
    return smooth(np.abs(signal.hilbert(y)), win)


def rms_envelope(x, band=None, win=0.010, boxcar=False):
    y = mono(x)
    if band is not None:
        lo, hi = band
        if lo and hi:
            y = _zp("bandpass", [lo, hi], y)
        elif lo:
            y = _zp("highpass", lo, y)
        elif hi:
            y = _zp("lowpass", hi, y)
    if boxcar:   # exact rectangular window (period-locked RMS for tonal sub content)
        w = max(1, int(round(win * SR)))
        return np.sqrt(np.maximum(signal.fftconvolve(y ** 2, np.ones(w) / w, mode="same"), 0))
    return np.sqrt(np.maximum(smooth(y ** 2, win), 0))


# ------------------------------------------------------------ onset detector
def spectral_flux_onsets(x, nfft=512, hop=64, delta=0.06, wait=0.025):
    """Blind onset detector: log-compressed spectral flux (half-wave rectified)
    on centred frames, adaptive median threshold, local-max peak picking with
    non-maximum suppression (strongest candidate wins within +-25 ms).
    Returns onset times (s) and the onset-strength function."""
    y = mono(x)
    f, tt, Z = signal.stft(y, fs=SR, window="hann", nperseg=nfft, noverlap=nfft - hop, boundary="zeros", padded=True)
    L = np.log1p(1000 * np.abs(Z))
    flux = np.maximum(L[:, 1:] - L[:, :-1], 0).sum(axis=0)
    flux = np.r_[0.0, flux]
    flux /= (flux.max() + 1e-12)
    times = tt
    med = median_filter(flux, size=int(0.1 * SR / hop) | 1, mode="nearest")
    loc = maximum_filter1d(flux, size=int(0.02 * SR / hop) | 1, mode="nearest")
    cand = np.where((flux == loc) & (flux > med + delta))[0]
    # non-maximum suppression: keep the strongest candidate within +-wait
    keep = []
    for i in cand[np.argsort(-flux[cand])]:
        if all(abs(times[i] - times[j]) >= wait for j in keep):
            keep.append(i)
    return np.array(sorted(times[keep])), (times, flux)


LOUDEST_TYPES = {"whoosh", "swell"}
END_TYPES = {"riser", "reverse"}


def accent_mode(typ):
    return "end" if typ in END_TYPES else ("loudest" if typ in LOUDEST_TYPES else "transient")


def measure_accent(x, t_ref, typ, dur=0.0, onsets=None, offset_s=0.0, mode=None):
    """Measure the accent of event `typ` expected at `t_ref` (absolute s) inside
    signal x that starts at absolute time offset_s.
      transient: peak of a zero-phase 2 kHz-HP Hilbert envelope (1 ms smoothing),
                 searched -5..+20 ms around the nearest blind spectral-flux onset
                 (+-50 ms capture); falls back to t_ref if no onset is near
      loudest  : whoosh -> argmax of 10 ms RMS in 400 Hz-9 kHz;
                 swell  -> argmax of a one-period (27.2 ms) boxcar RMS below 250 Hz
      end      : last sample whose |x| is within 30 dB of the final-200 ms maximum
    """
    mode = mode or accent_mode(typ)
    rel = lambda s_: int(round((s_ - offset_s) * SR))
    if mode == "loudest":
        if typ == "swell":
            env = rms_envelope(x, (None, 250), 1 / 36.708, boxcar=True)   # one period of D1
            meth = "loudest: 1-period (27.2 ms) RMS <250 Hz"
        else:
            env = rms_envelope(x, (400, 9000), 0.010)
            meth = "loudest: 10 ms RMS 0.4-9 kHz"
        a = max(0, rel(t_ref - max(0.5 * dur, 0.05)))
        b = min(len(env), rel(t_ref + 0.12))
        i = a + int(np.argmax(env[a:b]))
        return {"method": meth, "measured": offset_s + i / SR}
    if mode == "end":
        env = np.abs(stereo(x)).max(axis=1)     # raw |x| (a Hilbert env would smear past a hard cut)
        a = max(0, rel(t_ref - 0.2))
        b = min(len(env), rel(t_ref + 0.1))
        pk = env[a:rel(t_ref) + 1].max()
        above = np.where(env[a:b] >= pk * 10 ** (-30 / 20))[0]
        i = a + int(above[-1]) + 1
        return {"method": "end: last sample within 30 dB of final max", "measured": offset_s + i / SR}
    env = hf_envelope(x, 2000.0 if typ not in ("pop",) else 300.0)
    res = {"method": "transient: HF Hilbert-env peak"}
    centre = t_ref
    if onsets is not None and len(onsets):
        j = int(np.argmin(np.abs(onsets - t_ref)))
        if abs(onsets[j] - t_ref) < 0.05:
            res["flux_onset"] = float(onsets[j])
            centre = onsets[j]
    # a transient's peak follows its onset: search [onset - 5 ms, onset + 20 ms]
    a = max(0, rel(centre - 0.005))
    b = min(len(env), rel(centre + 0.02))
    i = a + int(np.argmax(env[a:b]))
    res["measured"] = offset_s + i / SR
    return res


# ------------------------------------------------------------- contact sheet
SURF = (252, 252, 251)
INK = (11, 11, 11)
INK2 = (82, 81, 78)
GRID = (224, 223, 219)
WAVE = (42, 120, 214)
MARK = (235, 104, 52)
RAMP = ["#fcfcfb", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]


def _ramp_lut():
    cols = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in RAMP], float)
    xs = np.linspace(0, 1, len(cols))
    v = np.linspace(0, 1, 256)
    return np.stack([np.interp(v, xs, cols[:, c]) for c in range(3)], axis=1).astype(np.uint8)


def _font(size, bold=False):
    for p in (f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf",):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()


def _spec_image(x, w, h, fmin=40.0, fmax=20000.0, floor_db=-85.0):
    y = mono(x)
    nfft = 1024 if len(y) > 0.5 * SR else (512 if len(y) > 0.1 * SR else 256)
    if len(y) < 2 * nfft:
        y = np.concatenate([y, np.zeros(2 * nfft - len(y))])[: max(len(y), 2 * nfft)]
    hop = max(8, min(nfft // 2, int(len(mono(x)) / w)))
    f, t, Z = signal.stft(y, fs=SR, window="hann", nperseg=nfft, noverlap=max(0, nfft - hop), boundary="zeros")
    S = 20 * np.log10(np.abs(Z) + 1e-12)
    S -= S.max()
    # log-frequency rows
    rows = np.geomspace(fmax, fmin, h)
    idx = np.clip(np.searchsorted(f, rows), 0, len(f) - 1)
    S = S[idx, :]
    # resample columns to width (only the part covering the real signal)
    ncols = max(1, int(np.ceil(len(mono(x)) / hop)) + 1)
    S = S[:, :ncols]
    cols = np.clip((np.arange(w) * (S.shape[1] / w)).astype(int), 0, S.shape[1] - 1)
    S = S[:, cols]
    v = np.clip((S - floor_db) / -floor_db, 0, 1)
    lut = _ramp_lut()
    return Image.fromarray(lut[(v * 255).astype(int)], "RGB")


def contact_sheet(items, path, cols=4, tile_w=440):
    """items: list of dict(name, data (n,2), anchor, peak_db, tp_db, dur, kind, lufs)."""
    pad = 14
    head = 34
    wave_h, spec_h = 74, 120
    tile_h = head + wave_h + 4 + spec_h + 16
    rows = int(np.ceil(len(items) / cols))
    title_h = 56
    W = pad + cols * (tile_w + pad)
    H = title_h + rows * (tile_h + pad) + pad
    img = Image.new("RGB", (W, H), SURF)
    d = ImageDraw.Draw(img)
    f_t, f_s, f_xs, f_h = _font(13, True), _font(11), _font(9), _font(20, True)
    d.text((pad, 12), "Albion Journal SFX one-shots - waveform (scaled to own peak) + log-freq spectrogram (40 Hz-20 kHz, 0 to -85 dB re. max)", fill=INK, font=f_h)
    d.text((pad, 36), "orange line = anchor (accent placed on the timeline time); grid ticks every 100 ms", fill=INK2, font=f_s)
    for k, it in enumerate(items):
        r, c = divmod(k, cols)
        x0 = pad + c * (tile_w + pad)
        y0 = title_h + r * (tile_h + pad)
        x = it["data"]
        n = len(x)
        d.text((x0, y0), it["name"], fill=INK, font=f_t)
        d.text((x0, y0 + 17), f"{it['dur']:.3f} s | peak {it['peak_db']:.1f} dBFS | TP {it['tp_db']:.1f} | "
                              f"Mmax {it['lufs']:.1f} LUFS | anchor {it['anchor']/SR*1000:.0f} ms", fill=INK2, font=f_s)
        wy = y0 + head
        d.rectangle([x0, wy, x0 + tile_w, wy + wave_h], outline=GRID)
        # 100 ms grid
        for gt in np.arange(0, n / SR, 0.1):
            gx = x0 + int(gt * SR / n * tile_w)
            d.line([gx, wy + wave_h - 4, gx, wy + wave_h], fill=INK2)
        m = mono(x)
        pk = np.abs(m).max() + 1e-12
        edges = np.linspace(0, n, tile_w + 1).astype(int)
        mid = wy + wave_h // 2
        d.line([x0, mid, x0 + tile_w, mid], fill=GRID)
        for px in range(tile_w):
            seg = m[edges[px]:max(edges[px + 1], edges[px] + 1)]
            lo, hi = seg.min() / pk, seg.max() / pk
            d.line([x0 + px, mid - int(hi * (wave_h / 2 - 3)), x0 + px, mid - int(lo * (wave_h / 2 - 3))], fill=WAVE)
        sy = wy + wave_h + 4
        sp = _spec_image(x, tile_w, spec_h)
        img.paste(sp, (x0, sy))
        d.rectangle([x0, sy, x0 + tile_w, sy + spec_h], outline=GRID)
        for fl, lab in ((100, "100"), (1000, "1k"), (10000, "10k")):
            fy = sy + int(np.log(20000 / fl) / np.log(20000 / 40) * spec_h)
            d.line([x0, fy, x0 + 5, fy], fill=INK2)
            d.text((x0 + 7, fy - 6), lab, fill=INK2, font=f_xs)
        ax = x0 + int(it["anchor"] / max(n, 1) * tile_w)
        ax = min(ax, x0 + tile_w)
        d.line([ax, wy, ax, sy + spec_h], fill=MARK, width=2)
    img.save(path, optimize=True)
    return path
