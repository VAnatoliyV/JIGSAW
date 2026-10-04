#!/usr/bin/env python3
"""Albion Journal - final film mix (VO + ducked score stems + SFX -> mastered stereo).

Deterministic and re-runnable; everything is driven by timeline/timeline.json.

    python3 audio-src/mix/build_mix.py            # mix, stems, report, analysis PNG
    python3 audio-src/mix/build_mix.py --no-png   # skip the figure

Inputs (read-only; the music / SFX / VO builds are not touched)
  assets/audio/music/stems/{drums_perc,low,strings,brass,choir_pads,melody,fx_hits}.wav
  assets/audio/sfx/sfx_track.wav  (+ sfx_cues.json, oneshots/index.json for the impact-protect mask)
  audio-src/vo/take_george/vNN.wav (Kokoro 'bm_george', 24 kHz mono), placed at timeline vo[i].t

Outputs
  assets/audio/final_mix.wav                         48 kHz / 24-bit / stereo / exactly 120.000 s
  assets/audio/final_stems/{vo,music_ducked,sfx}.wav  printed THROUGH the master gain path (glue gain x
                                                      master gain x limiter gain x fade, all stereo-linked and
                                                      gain-only), so vo + music_ducked + sfx == final_mix
                                                      (to within dither / 24-bit quantisation)
  assets/audio/final_mix_report.txt                  verification report
  assets/audio/final_mix_analysis.png                spectrogram + waveform + loudness + duck curves

Signal flow
  VO line : 24k->48k (polyphase, Kaiser) -> 5/20 ms edge fades -> HPF 80 Hz (24 dB/oct) -> peak -2 dB @300 Hz
            -> peak +2 dB @3.5 kHz -> split-band de-esser (5-9 kHz, zero-phase complementary split)
            -> 3:1 soft-knee compressor (10/120 ms) -> 2x-oversampled parallel tanh warmth
            -> per-line BS.1770 levelling -> placed at vo[i].t on the dry VO bus (mono, centred)
  VO rev  : dry bus -> HPF 180 Hz / LPF 6.5 kHz send -> synthetic dark plate/room IR (20 ms pre-delay,
            RT ~0.7 s, early reflections, HF decays faster) -> M/S width on the wet only -> wet at -20 LU re dry
  Duck    : key = dry-VO RMS (10 ms) -> soft activity key -> 200 ms hold + 40 ms look-ahead
            -> per-line depth -> one-pole 60 ms attack / 350 ms release (dB domain)
            melody+strings+brass+choir : broadband -D_b and an extra -D_band dynamic dip in 1-4 kHz
            low                        : broadband -D_b
            drums_perc+fx_hits         : -D_perc (less, keeps the punch)
            SFX                        : -2 dB on UI sounds while speaking; impacts/hits/stamps/anvil/risers protected
            D_b / D_band are solved per line so the VO beats the background by >= +9 dB in 1-4 kHz.
  Master  : glue (2:1 soft knee, 30/200 ms, stereo-linked) -> gain to -14 LUFS -> look-ahead true-peak limiter
            (4x oversampled detector, ceiling -1.2 dBTP, 120 ms release) -> 0.3 s fade to digital silence
            -> TPDF dither -> 24-bit.
"""
from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal
from scipy.ndimage import maximum_filter1d, minimum_filter1d, uniform_filter1d

ROOT = Path(__file__).resolve().parents[2]
SR = 48000
DUR = 120.0
N = int(round(DUR * SR))          # 5 760 000
CR = 1000                          # control rate (Hz) for all dynamics
HOP = SR // CR                     # 48 samples
NC = N // HOP                      # 120 000 control points
FR = 0.05                          # measurement frame (s)
FH = int(FR * SR)                  # 2400 samples
NF = N // FH                       # 2400 frames

P = dict(
    # ---- VO chain
    vo_pre_lufs=-20.0,          # mono BS.1770 reference level the de-esser / compressor are calibrated at
    vo_line_lufs=-15.0,         # per-line loudness on the dry bus (dual-mono stereo, BS.1770) pre-master
    hpf_hz=80.0, hpf_order=4,
    lowmid=(300.0, -2.0, 1.0),  # f0, gain dB, Q
    presence=(3500.0, 2.0, 0.9),
    deess_band=(5000.0, 9000.0), deess_ratio=4.0, deess_max_db=8.0, deess_pct=90.0, deess_rel_open_db=-12.0,
    comp_ratio=3.0, comp_knee_db=6.0, comp_att_ms=10.0, comp_rel_ms=120.0, comp_rms_ms=5.0,
    comp_median_gr_db=3.0,      # threshold is calibrated so the median GR on voiced frames is this
    sat_drive=2.0, sat_mix=0.25,
    # ---- VO reverb
    rev_predelay_ms=20.0, rev_rt60=0.70, rev_len_s=1.6, rev_wet_lu=-20.0, rev_width=0.55,
    rev_send_hpf=180.0, rev_send_lpf=6500.0, rev_dark_lpf=5500.0,
    # ---- ducking
    key_rms_ms=10.0, key_lo_rel=-26.0, key_hi_rel=-14.0,
    duck_hold_ms=300.0, duck_bridge_s=0.7, duck_lookahead_ms=40.0, duck_att_ms=60.0, duck_rel_ms=350.0,
    duck_sfx_db=2.0,              # pitched / band / drums depths come from NOMINAL + LADDER (per-line solve)
    dip_band=(1000.0, 4000.0),
    ratio_target_db=9.0, ratio_margin_db=0.5, passes=2,
    # ---- faders / rides (rides = fader automation on the 4 big drops: 16, 96, 104, 116 s)
    music_fader_db=0.0, sfx_fader_db=-6.0,
    sfx_ride_db=3.0, perc_ride_db=2.5, pitched_ride_db=1.5, ride_pre=0.03, ride_hold=0.45, ride_out=0.5,
    sfx_protect_types={'impact': 0.6, 'anvil': 0.6, 'hit': 0.3, 'stamp': 0.3,
                       'riser': None, 'reverse': None, 'swell': None},   # tail after accent (None = to accent)
    # ---- master
    glue_ratio=2.0, glue_knee_db=6.0, glue_att_ms=30.0, glue_rel_ms=200.0, glue_rms_ms=50.0, glue_p99_gr_db=1.0,
    dc_hpf_hz=12.0, target_lufs=-14.0, tp_ceiling_db=-1.2, lim_la_ms=2.0, lim_rel_ms=80.0, lim_block=16,
    fade_s=0.30, tail_zero_s=0.010,
)

BIG_HITS = (16.0, 96.0, 104.0, 116.0)
MUSIC_STEMS = ('drums_perc', 'low', 'strings', 'brass', 'choir_pads', 'melody', 'fx_hits')
PITCHED = ('melody', 'strings', 'brass', 'choir_pads', 'low')
PERC = ('drums_perc', 'fx_hits')

# Per-line ducking 'effort' ladder: effort s walks these segments in order (segment j covers s in [j-1, j]);
# s = 0 is the nominal brief setting, s = -1 relaxes the broadband duck to 5 dB where the voice has lots of margin.
KNOBS = ('b', 'band', 'perc', 'pband', 'vob')
NOMINAL = dict(b=6.0, band=3.0, perc=2.5, pband=0.0, vob=0.0)
LADDER = [
    ('b', 5.0, 6.0),        # s -1..0  broadband duck of the pitched stems (melody/strings/brass/choir/low)
    ('band', 3.0, 5.0),     # s  0..1  extra 1-4 kHz dynamic dip on the pitched stems
    ('pband', 0.0, 3.0),    # s  1..2  1-4 kHz dip on drums/fx_hits (tambourine, snare, cymbal; the low punch is kept)
    ('band', 5.0, 7.0),     # s  2..3
    ('b', 6.0, 7.0),        # s  3..4
    ('pband', 3.0, 5.0),    # s  4..5
    ('perc', 2.5, 3.0),     # s  5..6  broadband drums/fx_hits duck
    ('vob', 0.0, 0.7),      # s  6..7  lift that VO line (stays inside the +/-1 LU line consistency)
    ('band', 7.0, 10.0),    # s  7..8  last resort for the full-orchestra finale: deeper 1-4 kHz carve under the CTA
]


def knobs_at(s):
    k = dict(NOMINAL)
    k['b'] = LADDER[0][1]
    for j, (name, a, b) in enumerate(LADDER):
        u = min(1.0, max(0.0, s - (j - 1)))
        if u > 0:
            k[name] = a + (b - a) * u
    return k

T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def db(x, floor=1e-20):
    return 10.0 * np.log10(np.maximum(x, floor))


def a2db(x):
    return 20.0 * np.log10(np.maximum(np.abs(x), 1e-12))


# =============================================================================== filters
def peaking_sos(f0, gain_db, q):
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * f0 / SR
    al = math.sin(w0) / (2 * q)
    b = [1 + al * A, -2 * math.cos(w0), 1 - al * A]
    a = [1 + al / A, -2 * math.cos(w0), 1 - al / A]
    return np.array([[b[0] / a[0], b[1] / a[0], b[2] / a[0], 1.0, a[1] / a[0], a[2] / a[0]]])


def bp_sos(lo, hi, order=4):
    return signal.butter(order, [lo, hi], 'bandpass', fs=SR, output='sos')


KW_SOS = np.array([[1.53512485958697, -2.69169618940638, 1.19839281085285, 1.0, -1.69065929318241, 0.73248077421585],
                   [1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621]])


def kweight(x):
    return signal.sosfilt(KW_SOS, x, axis=0)


def kpow(x):
    """Per-sample K-weighted power summed over channels (mono input = one channel)."""
    y = kweight(x)
    return (y * y).sum(axis=1) if y.ndim == 2 else y * y


# =============================================================================== loudness (BS.1770-4 / EBU)
def win_mean(pw, win, hop):
    c = np.concatenate([[0.0], np.cumsum(pw, dtype=np.float64)])
    starts = np.arange(0, len(pw) - win + 1, hop)
    return (c[starts + win] - c[starts]) / win, starts


def lufs(m):
    return -0.691 + db(m)


def integrated(pw):
    if len(pw) < int(0.4 * SR):
        pw = np.concatenate([pw, np.zeros(int(0.4 * SR) - len(pw))])
    m, _ = win_mean(pw, int(0.4 * SR), int(0.1 * SR))
    L = lufs(m)
    g1 = L > -70
    if not g1.any():
        return -float('inf')
    rel = lufs(m[g1].mean()) - 10.0
    g2 = g1 & (L > rel)
    return float(lufs(m[g2].mean()))


def lra(pw):
    m, _ = win_mean(pw, int(3.0 * SR), int(0.1 * SR))
    L = lufs(m)
    g1 = L > -70
    rel = lufs(m[g1].mean()) - 20.0
    v = L[g1 & (L > rel)]
    return float(np.percentile(v, 95) - np.percentile(v, 10))


def true_peak_lin(x, os=4):
    x = x if x.ndim == 2 else x[:, None]
    tp = float(np.abs(x).max())
    for ch in range(x.shape[1]):
        tp = max(tp, float(np.abs(signal.resample_poly(x[:, ch], os, 1)).max()))
    return tp


def tp_envelope(x, os=4):
    """Per-sample true-peak envelope (max |.| of the os-x oversampled signal in [n, n+1))."""
    n = len(x)
    env = np.abs(x).max(axis=1)
    for ch in range(x.shape[1]):
        up = signal.resample_poly(x[:, ch], os, 1)[:n * os]
        env = np.maximum(env, np.abs(up).reshape(n, os).max(axis=1))
    return env


def ffmpeg_ebur128(path):
    if not shutil.which('ffmpeg'):
        return None
    p = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af', 'ebur128=peak=true:framelog=quiet',
                        '-f', 'null', '-'], capture_output=True, text=True)
    txt = p.stderr
    out = {}
    try:
        summ = txt[txt.rindex('Summary:'):]
        for line in summ.splitlines():
            s = line.strip()
            if s.startswith('I:'):
                out['I'] = float(s.split()[1])
            elif s.startswith('LRA:'):
                out['LRA'] = float(s.split()[1])
            elif s.startswith('Peak:'):
                out['TP'] = float(s.split()[1])
    except ValueError:
        return None
    return out


# =============================================================================== dynamics helpers
def ar_smooth(x, rate, att_s, rel_s, rising_is_attack=True, y0=None):
    """One-pole attack/release smoother on a control-rate series (rising values use the attack
    coefficient when rising_is_attack, e.g. gain-reduction or duck depth in dB)."""
    aa = math.exp(-1.0 / (att_s * rate)) if att_s > 0 else 0.0
    ar = math.exp(-1.0 / (rel_s * rate)) if rel_s > 0 else 0.0
    xs = np.asarray(x, dtype=np.float64).tolist()
    out = [0.0] * len(xs)
    y = xs[0] if y0 is None else y0
    for i, v in enumerate(xs):
        if (v > y) == rising_is_attack:
            y = aa * y + (1.0 - aa) * v
        else:
            y = ar * y + (1.0 - ar) * v
        out[i] = y
    return np.asarray(out)


def ctrl_to_audio(c, n, hop=HOP):
    idx = np.arange(len(c)) * hop + hop / 2.0
    return np.interp(np.arange(n), idx, c)


def rms_db_ctrl(x, win_ms, hop=HOP):
    """RMS level (dB) of a mono/stereo signal (channel mean power) on the control grid."""
    pw = (x * x).mean(axis=1) if x.ndim == 2 else x * x
    p = uniform_filter1d(pw, max(1, int(win_ms * SR / 1000)), mode='constant')
    idx = np.arange(len(p) // hop) * hop + hop // 2
    return db(p[idx])


def static_gr(L, T, ratio, knee):
    """Soft-knee compressor gain reduction (dB, positive)."""
    o = L - T
    s = 1.0 - 1.0 / ratio
    gr = np.where(o <= -knee / 2, 0.0, np.where(o >= knee / 2, s * o, s * (o + knee / 2) ** 2 / (2 * knee)))
    return gr


def calibrate_threshold(L, ratio, knee, stat, target, lo=-80.0, hi=10.0):
    """Bisection on the threshold so that stat(static_gr) == target (stat decreasing in T)."""
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if stat(static_gr(L, mid, ratio, knee)) > target:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def shift_max(k, back, ahead):
    """out[n] = max(k[n-back .. n+ahead]) (hold `back`, look-ahead `ahead` control samples)."""
    W = back + ahead + 1
    if W % 2 == 0:
        W += 1
        back += 1
    h = (W - 1) // 2
    c = maximum_filter1d(k, size=W, mode='nearest')
    s = back - h                                   # out[n] = c[n - back + h] = c[n - s]
    if s > 0:
        return np.concatenate([np.full(s, c[0]), c[:-s]])
    if s < 0:
        return np.concatenate([c[-s:], np.full(-s, c[-1])])
    return c


# =============================================================================== VO chain
def line_loudness_mono(x, dual=False):
    """BS.1770 gated loudness of a mono line (dual=True -> as centred dual-mono stereo, +3.01 dB)."""
    return integrated(kpow(x) * (2.0 if dual else 1.0))


def vo_chain(lines, tl):
    st = [dict(id=v['id'], t=v['t'], text=v['text']) for v in tl['vo']]
    hpf = signal.butter(P['hpf_order'], P['hpf_hz'], 'highpass', fs=SR, output='sos')
    eq = np.vstack([peaking_sos(*P['lowmid']), peaking_sos(*P['presence'])])
    out = []
    for i, x24 in enumerate(lines):
        x = signal.resample_poly(x24.astype(np.float64), 2, 1, window=('kaiser', 10.0))
        fi, fo = int(0.005 * SR), int(0.020 * SR)
        x[:fi] *= np.sin(np.linspace(0, np.pi / 2, fi)) ** 2
        x[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo)) ** 2
        x = np.concatenate([x, np.zeros(int(0.15 * SR))])   # room for filter / release tails
        x = signal.sosfilt(hpf, x)
        x = signal.sosfilt(eq, x)
        g = 10 ** ((P['vo_pre_lufs'] - line_loudness_mono(x)) / 20)
        st[i]['pre_gain_db'] = 20 * math.log10(g)
        out.append(x * g)

    # ---------------- de-esser (split band, zero-phase complementary split -> transparent when idle)
    sb = bp_sos(*P['deess_band'], order=4)
    hop_d = 24
    rate_d = SR / hop_d
    bands, envb, envf = [], [], []
    for x in out:
        b = signal.sosfiltfilt(sb, x)
        bands.append(b)
        n = len(x) // hop_d
        pb = np.abs(b[:n * hop_d]).reshape(n, hop_d).max(1)
        pf = np.abs(x[:n * hop_d]).reshape(n, hop_d).max(1)
        envb.append(a2db(ar_smooth(pb, rate_d, 0.0005, 0.040)))
        envf.append(a2db(ar_smooth(pf, rate_d, 0.0005, 0.040)))
    allf = np.concatenate(envf)
    allb = np.concatenate(envb)
    voiced = allf > (np.percentile(allf[allf > -80], 50) - 20)
    T_ds = float(np.percentile(allb[voiced], P['deess_pct']))
    for i, x in enumerate(out):
        Lb, Lf = envb[i], envf[i]
        over = np.maximum(0.0, Lb - T_ds) * (1 - 1 / P['deess_ratio'])
        sib = np.clip((Lb - Lf - P['deess_rel_open_db']) / 6.0, 0.0, 1.0)   # only when the band dominates
        gr = np.minimum(P['deess_max_db'], over * sib)
        gr = ar_smooth(gr, rate_d, 0.001, 0.030)
        ga = ctrl_to_audio(10 ** (-gr / 20), len(x), hop_d)
        b = bands[i]
        y = (x - b) + b * ga
        vmask = Lf > (np.percentile(allf[allf > -80], 50) - 20)
        st[i]['deess_max_db'] = float(gr.max())
        st[i]['deess_active_pct'] = float(100 * np.mean(gr[vmask] > 1.0)) if vmask.any() else 0.0
        st[i]['deess_mean_active_db'] = float(gr[gr > 1.0].mean()) if (gr > 1.0).any() else 0.0
        e0 = float((b ** 2).sum())
        e1 = float(((b * ga) ** 2).sum())
        st[i]['deess_band_red_db'] = 10 * math.log10(e0 / max(e1, 1e-30))
        out[i] = y
    deess_T = T_ds

    # ---------------- compressor 3:1 (RMS 5 ms detector, 10 ms attack / 120 ms release on the GR)
    Ls = [rms_db_ctrl(x, P['comp_rms_ms']) for x in out]
    allL = np.concatenate(Ls)
    vthr = np.percentile(allL[allL > -80], 50) - 15
    voicedL = allL[allL > vthr]
    T_c = calibrate_threshold(voicedL, P['comp_ratio'], P['comp_knee_db'],
                              lambda gr: np.median(gr), P['comp_median_gr_db'])
    grs_all = []
    for i, x in enumerate(out):
        gr = static_gr(Ls[i], T_c, P['comp_ratio'], P['comp_knee_db'])
        gr = ar_smooth(gr, CR, P['comp_att_ms'] / 1000, P['comp_rel_ms'] / 1000)
        v = Ls[i] > vthr
        st[i]['comp_gr_med'] = float(np.median(gr[v]))
        st[i]['comp_gr_p95'] = float(np.percentile(gr[v], 95))
        st[i]['comp_gr_max'] = float(gr.max())
        grs_all.append(gr[v])
        out[i] = x * ctrl_to_audio(10 ** (-gr / 20), len(x))
    comp_T = T_c
    grs_all = np.concatenate(grs_all)

    # ---------------- warmth: 2x oversampled parallel tanh, at a fixed reference level
    for i, x in enumerate(out):
        x = x * 10 ** ((P['vo_pre_lufs'] - line_loudness_mono(x)) / 20)
        up = signal.resample_poly(x, 2, 1)
        d = P['sat_drive']
        ys = (1 - P['sat_mix']) * up + P['sat_mix'] * np.tanh(d * up) / d
        y = signal.resample_poly(ys, 1, 2)[:len(x)]
        a = float(np.dot(y, x) / np.dot(x, x))
        st[i]['sat_thd_db'] = 10 * math.log10(float(((y - a * x) ** 2).sum()) / float((y ** 2).sum()))
        out[i] = y

    # ---------------- per-line levelling (dual-mono stereo BS.1770)
    for i, x in enumerate(out):
        g = P['vo_line_lufs'] - line_loudness_mono(x, dual=True)
        out[i] = x * 10 ** (g / 20)
        st[i]['level_gain_db'] = g
    meta = dict(deess_T=deess_T, comp_T=comp_T, comp_gr_med=float(np.median(grs_all)),
                comp_gr_p95=float(np.percentile(grs_all, 95)), comp_gr_max=float(grs_all.max()))
    return out, st, meta


# =============================================================================== reverb
def make_ir():
    rng = np.random.default_rng(20261003)
    n = int(P['rev_len_s'] * SR)
    t = np.arange(n) / SR
    pre = int(P['rev_predelay_ms'] * SR / 1000)
    lo_s = signal.butter(2, 450, 'lowpass', fs=SR, output='sos')
    hi_s = signal.butter(2, 2800, 'highpass', fs=SR, output='sos')
    dark = signal.butter(2, P['rev_dark_lpf'], 'lowpass', fs=SR, output='sos')
    rt = P['rev_rt60']
    irs = []
    for ch in range(2):
        nz = rng.standard_normal(n)
        lo = signal.sosfiltfilt(lo_s, nz)
        hi = signal.sosfiltfilt(hi_s, nz)
        mid = nz - lo - hi
        env = lambda r: 10 ** (-3.0 * t / r)          # -60 dB at t = r
        ir = lo * env(rt * 1.10) + mid * env(rt) + hi * env(rt * 0.50)
        ir = signal.sosfiltfilt(dark, ir)
        ir *= 1 - np.exp(-t / 0.012)                      # diffuse build-up
        # sparse early reflections (plate/room), different per side
        er_t = np.array([2.9, 5.3, 7.7, 11.3, 14.9, 19.1, 23.7]) * (1.0 + 0.07 * (1 if ch else -1))
        er_g = np.array([0.55, 0.42, 0.38, 0.30, 0.24, 0.18, 0.13]) * (1 if ch == 0 else 0.9)
        er = np.zeros(n)
        for tt, gg in zip(er_t, er_g):
            er[int(tt * SR / 1000)] += gg * (1 if rng.random() > 0.5 else -1)
        er = signal.sosfiltfilt(dark, er)
        ir = ir / np.sqrt((ir ** 2).sum()) + 0.6 * er / np.sqrt((er ** 2).sum() + 1e-30)
        ir = np.concatenate([np.zeros(pre), ir])[:n]
        irs.append(ir)
    ir = np.stack(irs, axis=1)
    ir /= np.sqrt((ir ** 2).sum() / 2)
    return ir


def schroeder_rt(ir):
    e = (ir ** 2).sum(axis=1)
    edc = np.cumsum(e[::-1])[::-1]
    edc = db(edc / edc[0])
    i5 = np.argmax(edc <= -5)
    i25 = np.argmax(edc <= -25)
    return 3.0 * (i25 - i5) / SR


def reverb(dry):
    ir = make_ir()
    send = signal.sosfilt(signal.butter(2, P['rev_send_hpf'], 'highpass', fs=SR, output='sos'), dry)
    send = signal.sosfilt(signal.butter(2, P['rev_send_lpf'], 'lowpass', fs=SR, output='sos'), send)
    wet = np.stack([signal.oaconvolve(send, ir[:, c])[:N] for c in range(2)], axis=1)
    m = 0.5 * (wet[:, 0] + wet[:, 1])
    s = 0.5 * (wet[:, 0] - wet[:, 1]) * P['rev_width']
    wet = np.stack([m + s, m - s], axis=1)
    L_dry = integrated(kpow(dry) * 2.0)
    L_wet = integrated(kpow(wet))
    wet *= 10 ** ((L_dry + P['rev_wet_lu'] - L_wet) / 20)
    corr = float(np.corrcoef(wet[:, 0], wet[:, 1])[0, 1])
    info = dict(rt60=schroeder_rt(ir), predelay_ms=P['rev_predelay_ms'], corr=corr,
                wet_rel_lu=integrated(kpow(wet)) - L_dry)
    return wet, info


# =============================================================================== main
def main():
    no_png = '--no-png' in sys.argv
    for a in sys.argv[1:]:                        # --set key=value (JSON value) for experiments
        if a.startswith('--set='):
            k, v = a[6:].split('=', 1)
            assert k in P, k
            P[k] = json.loads(v)
            log('override', k, '=', P[k])
    tl = json.loads((ROOT / 'timeline/timeline.json').read_text())
    vo = tl['vo']
    out_dir = ROOT / 'assets/audio'
    stem_dir = out_dir / 'final_stems'
    stem_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ VO
    lines24 = []
    for v in vo:
        x, sr = sf.read(ROOT / f"audio-src/vo/take_george/{v['id']}.wav", dtype='float64')
        assert sr == 24000, (v['id'], sr)
        lines24.append(x if x.ndim == 1 else x.mean(axis=1))
    proc, vst, vmeta = vo_chain(lines24, tl)
    nl = len(vo)
    starts = [int(round(v['t'] * SR)) for v in vo]

    def place(gains_db):
        bus = np.zeros(N)
        for i, x in enumerate(proc):
            n = min(len(x), N - starts[i])
            bus[starts[i]:starts[i] + n] += x[:n] * 10 ** (gains_db[i] / 20)
        return bus

    dry0 = place([0.0] * nl)
    for i, v in enumerate(vo):
        raw_len = len(lines24[i]) * 2
        vst[i]['start'] = v['t']
        vst[i]['end'] = v['t'] + raw_len / SR
        vst[i]['dur'] = raw_len / SR
    log('VO chain done', {k: round(v, 2) for k, v in vmeta.items()})
    wet0, _ = reverb(dry0)
    vo_bus0 = dry0[:, None] * np.ones((1, 2)) + wet0          # used for the solver's measurements
    del wet0

    # ------------------------------------------------------------------ key (speech activity) -> unit duck envelope S
    Lk = rms_db_ctrl(dry0, P['key_rms_ms'])
    Lv = float(np.median(Lk[Lk > -60]))
    k_raw = np.clip((Lk - (Lv + P['key_lo_rel'])) / (P['key_hi_rel'] - P['key_lo_rel']), 0.0, 1.0)
    k2 = shift_max(k_raw, int(P['duck_hold_ms']), int(P['duck_lookahead_ms']))
    t_c = (np.arange(NC) + 0.5) / CR
    # keep the duck down across short pauses (commas inside a line, short gaps between sentences): any silence run
    # shorter than duck_bridge_s with speech on both sides is filled, so the music never 'breathes' for a few 100 ms
    sp = k_raw > 0.5
    edges = np.flatnonzero(np.diff(sp.astype(np.int8)))
    n_bridged = 0
    for a, b in zip(edges[:-1], edges[1:]):
        if sp[a] and not sp[a + 1] and (b - a) < P['duck_bridge_s'] * CR:
            k2[a:b + 2] = 1.0
            n_bridged += 1
    # one-pole attack/release in the dB domain is homogeneous, so depth x smooth(key) == smooth(depth x key)
    S = ar_smooth(k2, CR, P['duck_att_ms'] / 1000, P['duck_rel_ms'] / 1000)

    # ------------------------------------------------------------------ music buses (sum in float64, headroom kept)
    stems = {}
    for s in MUSIC_STEMS:
        x, sr = sf.read(ROOT / f'assets/audio/music/stems/{s}.wav', dtype='float32')
        assert sr == SR and x.shape == (N, 2), (s, sr, x.shape)
        stems[s] = x
    mf = 10 ** (P['music_fader_db'] / 20)
    pitched = sum(stems[s].astype(np.float64) for s in PITCHED) * mf
    perc = sum(stems[s].astype(np.float64) for s in PERC) * mf
    del stems
    music_raw = pitched + perc
    split = bp_sos(*P['dip_band'], order=2)               # zero-phase |H|^2 -> rest = x - band is exact
    pit_band = signal.sosfiltfilt(split, pitched, axis=0)
    pit_rest = pitched - pit_band
    del pitched
    perc_band = signal.sosfiltfilt(split, perc, axis=0)
    perc_rest = perc - perc_band
    del perc
    log('music buses ready')

    # ------------------------------------------------------------------ SFX: impact-protect mask + drop rides
    sfx_raw, sr = sf.read(ROOT / 'assets/audio/sfx/sfx_track.wav', dtype='float64')
    assert sr == SR and sfx_raw.shape == (N, 2)
    cues = json.loads((ROOT / 'assets/audio/sfx/sfx_cues.json').read_text())
    oneshots = json.loads((ROOT / 'assets/audio/sfx/oneshots/index.json').read_text())
    protect = np.zeros(NC)
    for c in cues:
        tail = P['sfx_protect_types'].get(c['type'], 'x')
        if tail == 'x':
            continue
        t_start = c['start_sample'] / SR - 0.010
        dur = oneshots[c['variant']]['duration_s']
        t_end = min(c['start_sample'] / SR + dur, c['accent'] + (tail if tail is not None else 0.0))
        protect[max(0, int(t_start * CR)):min(NC, int(t_end * CR) + 1)] = 1.0
    protect = np.clip(uniform_filter1d(maximum_filter1d(protect, 21), 21), 0, 1)
    ride = np.zeros(NC)
    for th in BIG_HITS:
        ride = np.maximum(ride, np.interp(t_c, [th - P['ride_pre'] - 0.03, th - P['ride_pre'], th + P['ride_hold'],
                                                th + P['ride_hold'] + P['ride_out']], [0, 1, 1, 0], left=0, right=0))
    sfx_static_db = P['sfx_fader_db'] + P['sfx_ride_db'] * ride
    perc_ride_db = P['perc_ride_db'] * ride
    pit_ride_db = P['pitched_ride_db'] * ride

    # ------------------------------------------------------------------ measurement prep (per-frame cross energies)
    comps = [pit_rest, pit_band, perc_rest, perc_band, sfx_raw]
    sb = bp_sos(1000.0, 4000.0, order=4)

    def frame_cross(arrs, filt):
        fs = [filt(a) for a in arrs]
        nc = len(fs)
        C = np.zeros((NF, nc, nc))
        for i in range(nc):
            for j in range(i, nc):
                e = (fs[i][:NF * FH] * fs[j][:NF * FH]).sum(axis=1).reshape(NF, FH).sum(axis=1)
                C[:, i, j] = e
                C[:, j, i] = e
        return C

    C_band = frame_cross(comps, lambda a: signal.sosfiltfilt(sb, a, axis=0))
    C_kw = frame_cross(comps, kweight)
    vo_band_f = (signal.sosfiltfilt(sb, vo_bus0, axis=0)[:NF * FH] ** 2).sum(axis=1).reshape(NF, FH).sum(axis=1)
    vo_kw_f = kpow(vo_bus0)[:NF * FH].reshape(NF, FH).sum(axis=1)
    del vo_bus0
    k_f = k_raw[:NF * 50].reshape(NF, 50).mean(axis=1)
    t_f = (np.arange(NF) + 0.5) * FR
    line_frames = [np.where((t_f >= l['start']) & (t_f <= l['end']) & (k_f > 0.5))[0] for l in vst]
    log('measurement matrices ready')

    def gains_db(kn, cidx):
        """Component gains (dB) at control indices cidx for knob values kn (scalars or arrays over cidx)."""
        Sv = S[cidx]
        return np.stack([
            -kn['b'] * Sv + pit_ride_db[cidx],                               # pitched, outside 1-4 kHz
            -(kn['b'] + kn['band']) * Sv + pit_ride_db[cidx],                # pitched, 1-4 kHz
            -kn['perc'] * Sv + perc_ride_db[cidx],                           # drums/fx_hits, outside 1-4 kHz
            -(kn['perc'] + kn['pband']) * Sv + perc_ride_db[cidx],           # drums/fx_hits, 1-4 kHz
            sfx_static_db[cidx] - P['duck_sfx_db'] * Sv * (1.0 - protect[cidx]),   # SFX (impacts protected)
        ])

    wf = np.ones(NF)       # per-frame weight = mean G^2 of the master gain path (pass 2 measures "as heard")

    def line_eval(i, kn):
        fr = line_frames[i]
        cidx = fr[:, None] * 50 + np.arange(50)[None, :]
        g = (10 ** (gains_db(kn, cidx) / 20)).mean(axis=2).T                # (frames, 5)
        bgb = np.einsum('fi,fij,fj->f', g, C_band[fr], g)
        bgk = np.einsum('fi,fij,fj->f', g, C_kw[fr], g)
        vb = 10 ** (kn['vob'] / 10)
        w = wf[fr]
        rb = 10 * math.log10(vb * (w * vo_band_f[fr]).sum() / (w * bgb).sum())
        rk = 10 * math.log10(vb * (w * vo_kw_f[fr]).sum() / (w * bgk).sum())
        share = np.einsum('fi,fii,fi->i', g, C_band[fr], g)
        share = share / share.sum()
        return rb, rk, share

    # master helpers
    fade = np.ones(N)
    nz = int(P['tail_zero_s'] * SR)
    nfade = int(P['fade_s'] * SR) - nz
    fade[N - nz - nfade:N - nz] = np.cos(np.linspace(0, np.pi / 2, nfade)) ** 2
    fade[N - nz:] = 0.0
    ceil = 10 ** (P['tp_ceiling_db'] / 20)
    L_ = int(P['lim_la_ms'] * SR / 1000)
    B = P['lim_block']

    def limiter_gain(y):
        """Look-ahead true-peak limiter gain: g[n] <= ceiling / TP(n) by construction
        (centred min-hold over 2L+1, one-pole release at block rate, centred box average over 2L+1)."""
        greq = np.minimum(1.0, ceil / np.maximum(tp_envelope(y), 1e-12))
        m = minimum_filter1d(greq, 2 * L_ + 1, mode='nearest')
        nb = int(math.ceil(len(m) / B))
        mp = np.concatenate([m, np.ones(nb * B - len(m))]).reshape(nb, B).min(axis=1)
        a = math.exp(-1.0 / (P['lim_rel_ms'] / 1000 * SR / B))
        xs_ = mp.tolist()
        r = [0.0] * nb
        yv = xs_[0]
        for i, v in enumerate(xs_):
            yv = v if v < yv else a * yv + (1 - a) * v
            r[i] = yv
        rs = np.repeat(np.asarray(r), B)[:len(m)]
        return uniform_filter1d(rs, 2 * L_ + 1, mode='nearest')

    dc_sos = signal.butter(2, P['dc_hpf_hz'], 'highpass', fs=SR, output='sos')
    goal = P['ratio_target_db'] + P['ratio_margin_db']
    s_lo, s_hi = -1.0, float(len(LADDER) - 1)
    for pass_ in range(P['passes']):
        # -------------------------------------------------------------- per-line duck solver (minimal effort on a ladder)
        solved = []
        for i in range(nl):
            if line_eval(i, knobs_at(s_hi))[0] < goal:
                s = s_hi
            elif line_eval(i, knobs_at(s_lo))[0] >= goal:
                s = s_lo
            else:
                a, b = s_lo, s_hi
                for _ in range(30):
                    m = 0.5 * (a + b)
                    if line_eval(i, knobs_at(m))[0] >= goal:
                        b = m
                    else:
                        a = m
                s = b
            kn = knobs_at(s)
            rb, rk, share = line_eval(i, kn)
            r0 = line_eval(i, knobs_at(0.0))[0]
            vst[i].update(effort=s, knobs=kn, r_pred=rb, r_nominal=r0, share=share)
            solved.append(kn)
        log(f'pass {pass_ + 1} solver efforts', [round(v['effort'], 2) for v in vst])

        # -------------------------------------------------------------- apply: per-line knob profiles x S
        xs, prof = [], {k: [] for k in KNOBS}
        for i, l in enumerate(vst):
            xs += [l['start'], l['end']]
            for k in KNOBS:
                prof[k] += [solved[i][k], solved[i][k]]
        kprof = {k: np.interp(t_c, xs, prof[k]) for k in KNOBS}
        gdb = gains_db(kprof, np.arange(NC))
        vob = [solved[i]['vob'] for i in range(nl)]
        dry = place(vob)
        wet, rinfo = reverb(dry)
        vo_bus = dry[:, None] * np.ones((1, 2)) + wet
        del wet
        ga = [10 ** (ctrl_to_audio(gdb[j], N) / 20)[:, None] for j in range(5)]
        music_d = pit_rest * ga[0] + pit_band * ga[1] + perc_rest * ga[2] + perc_band * ga[3]
        sfx_d = sfx_raw * ga[4]
        del ga
        vo_bus = signal.sosfiltfilt(dc_sos, vo_bus, axis=0)        # 12 Hz zero-phase subsonic / DC filter per bus
        music_d = signal.sosfiltfilt(dc_sos, music_d, axis=0)      # (linear, so the stems still sum to the mix)
        sfx_d = signal.sosfiltfilt(dc_sos, sfx_d, axis=0)
        mix = vo_bus + music_d + sfx_d

        # -------------------------------------------------------------- master: glue -> gain -> TP limiter -> fade
        Lg = rms_db_ctrl(mix, P['glue_rms_ms'])
        act = Lg > -50
        T_g = calibrate_threshold(Lg[act], P['glue_ratio'], P['glue_knee_db'],
                                  lambda gr: np.percentile(gr, 99), P['glue_p99_gr_db'])
        gr_g = ar_smooth(static_gr(Lg, T_g, P['glue_ratio'], P['glue_knee_db']), CR,
                         P['glue_att_ms'] / 1000, P['glue_rel_ms'] / 1000)
        g_glue = 10 ** (-ctrl_to_audio(gr_g, N) / 20)
        y0 = mix * g_glue[:, None]
        del mix
        gain_db = P['target_lufs'] - integrated(kpow(y0))
        for it in range(6):
            y = y0 * 10 ** (gain_db / 20)
            g_lim = np.ones(N)
            for _ in range(3):                      # re-run on the limited signal until the TP ceiling holds
                gl = limiter_gain(y * g_lim[:, None])
                g_lim *= gl
                if gl.min() > 0.9995:
                    break
            z = y * (g_lim * fade)[:, None]
            I = integrated(kpow(z))
            if abs(I - P['target_lufs']) < 0.02:
                break
            gain_db += P['target_lufs'] - I
        del y, y0
        G = g_glue * 10 ** (gain_db / 20) * g_lim * fade
        log(f'pass {pass_ + 1} master: glue T {T_g:.1f} dB, gain {gain_db:+.2f} dB, I {I:.2f} LUFS')
        wf = (G[:NF * FH] ** 2).reshape(NF, FH).mean(axis=1)
    log('VO reverb', {k: round(v, 3) for k, v in rinfo.items()})
    del pit_rest, pit_band, perc_rest, perc_band, comps

    # ------------------------------------------------------------------ write (TPDF dither, 24-bit)
    q = 2.0 ** 23
    rng = np.random.default_rng(7)
    dither = (rng.random((N, 2)) - rng.random((N, 2))) / q * fade[:, None]
    final = np.clip(np.round((z + dither) * q), -q, q - 1) / q
    sf.write(out_dir / 'final_mix.wav', final, SR, subtype='PCM_24')
    stems_out = {'vo': vo_bus * G[:, None], 'music_ducked': music_d * G[:, None], 'sfx': sfx_d * G[:, None]}
    stem_fmt = {}
    for k, s in stems_out.items():
        pk = float(np.abs(s).max())
        if pk < 1.0:
            sq = np.clip(np.round(s * q), -q, q - 1) / q
            sf.write(stem_dir / f'{k}.wav', sq, SR, subtype='PCM_24')
            stem_fmt[k] = 'PCM_24'
        else:
            sf.write(stem_dir / f'{k}.wav', s.astype(np.float32), SR, subtype='FLOAT')
            with open(stem_dir / f'{k}.wav', 'r+b') as fh:      # zero libsndfile's PEAK-chunk timestamp -> byte-identical re-runs
                head = fh.read(4096)
                pk = head.find(b'PEAK')
                if pk >= 0:
                    fh.seek(pk + 12)
                    fh.write(b'\0\0\0\0')
            stem_fmt[k] = 'FLOAT (peaks above 0 dBFS on its own)'
    log('written')
    del z

    # ================================================================== VERIFICATION
    fin, sr = sf.read(out_dir / 'final_mix.wav', dtype='float64')
    vo_s, _ = sf.read(stem_dir / 'vo.wav', dtype='float64')
    mu_s, _ = sf.read(stem_dir / 'music_ducked.wav', dtype='float64')
    sx_s, _ = sf.read(stem_dir / 'sfx.wav', dtype='float64')
    bg_s = mu_s + sx_s
    rep = []
    o = rep.append

    pw_fin = kpow(fin)
    I_fin = integrated(pw_fin)
    LRA_fin = lra(pw_fin)
    tp4 = a2db(true_peak_lin(fin, 4))
    tp8 = a2db(true_peak_lin(fin, 8))
    spk = a2db(np.abs(fin).max())
    try:
        import pyloudnorm as pyln
        I_pyln = float(pyln.Meter(SR).integrated_loudness(fin))
    except Exception:          # pragma: no cover
        I_pyln = float('nan')
    ff = ffmpeg_ebur128(out_dir / 'final_mix.wav') or {}
    n_clip = int((np.abs(fin) >= (q - 1) / q).sum())
    last03 = fin[N - int(0.3 * SR):]
    tail_zero = int(np.argmax(np.any(fin[::-1] != 0, axis=1)))   # trailing exact-zero frames
    stem_sum_err = a2db(np.sqrt(np.mean((vo_s + mu_s + sx_s - fin) ** 2)))
    glue_gr = gr_g
    lim_gr_db = -a2db(g_lim)
    lim_ctrl = lim_gr_db[:NC * HOP].reshape(NC, HOP).max(axis=1)

    o('=' * 100)
    o('ALBION JOURNAL - FINAL MIX - VERIFICATION REPORT')
    o('generated by audio-src/mix/build_mix.py (deterministic; driven by timeline/timeline.json)')
    o('=' * 100)
    o('')
    o('[1] MASTER  (assets/audio/final_mix.wav)')
    o(f'  format            : {sf.info(out_dir / "final_mix.wav").subtype}, {sr} Hz, {fin.shape[1]} ch')
    o(f'  length            : {len(fin)} frames = {len(fin) / SR:.6f} s  -> {"OK" if len(fin) == N else "FAIL"}')
    o(f'  integrated        : {I_fin:.2f} LUFS (own BS.1770-4)  |  pyloudnorm {I_pyln:.2f}  |  ffmpeg ebur128 I={ff.get("I")} LUFS'
      f'  -> {"OK" if abs(I_fin - P["target_lufs"]) <= 0.5 else "FAIL"} (target {P["target_lufs"]} +/-0.5)')
    o(f'  loudness range    : {LRA_fin:.1f} LU (own EBU 3342)  |  ffmpeg LRA={ff.get("LRA")} LU')
    o(f'  true peak         : {tp4:.2f} dBTP (4x)  |  {tp8:.2f} dBTP (8x)  |  ffmpeg {ff.get("TP")} dBTP'
      f'  -> {"OK" if max(tp4, tp8, ff.get("TP", -99)) <= -1.0 else "FAIL"} (<= -1.0)')
    o(f'  sample peak       : {spk:.2f} dBFS; full-scale samples: {n_clip}  -> {"OK (no clipping)" if n_clip == 0 else "FAIL"}')
    o(f'  fade              : last {P["fade_s"]:.2f} s cos^2 fade; trailing exact-zero frames {tail_zero} ({tail_zero / SR * 1000:.1f} ms);'
      f' last sample {fin[-1].tolist()}  -> {"OK" if tail_zero >= int(0.009 * SR) else "FAIL"}')
    o(f'  last 0.3 s        : max |x| {np.abs(last03).max():.2e}; RMS {a2db(np.sqrt(np.mean(last03 ** 2))):.1f} dBFS')
    o(f'  glue comp         : 2:1, knee 6 dB, 30/200 ms, threshold {T_g:.1f} dBFS-RMS; GR max {glue_gr.max():.2f} dB,'
      f' mean (where >0.1 dB) {glue_gr[glue_gr > 0.1].mean():.2f} dB, time >1 dB {np.mean(glue_gr > 1) * DUR:.1f} s')
    o(f'  master gain       : {gain_db:+.2f} dB (after glue) to land on {P["target_lufs"]} LUFS')
    dc = fin.mean(axis=0)
    lr = [integrated(kpow(fin[:, c])) for c in range(2)]
    corr = float(np.corrcoef(fin[:, 0], fin[:, 1])[0, 1])
    o(f'  DC / balance      : DC L {dc[0]:+.1e}, R {dc[1]:+.1e}; L {lr[0]:.2f} / R {lr[1]:.2f} LUFS (diff {lr[0] - lr[1]:+.2f} LU);'
      f' L/R correlation {corr:.2f} (mono-safe)')
    slope = np.abs(np.diff(gdb, axis=1)).max(axis=1) * 10
    o('  gain smoothness   : max duck-gain slope (dB per 10 ms) pitched {:.2f}, pitched 1-4k {:.2f}, drums {:.2f}, drums 1-4k {:.2f},'
      ' SFX {:.2f}; glue GR max slope {:.2f} dB/10 ms'.format(*slope, float(np.abs(np.diff(gr_g)).max() * 10)))
    big = [(round(i / CR, 2), round(float(lim_ctrl[i]), 2)) for i in np.argsort(lim_ctrl)[::-1][:400]]
    peaks = []
    for t_, g_ in big:
        if all(abs(t_ - p[0]) > 0.5 for p in peaks):
            peaks.append((t_, g_))
        if len(peaks) >= 8:
            break
    o(f'  TP limiter        : ceiling {P["tp_ceiling_db"]} dBTP, 4x oversampled detector, {P["lim_la_ms"]:.0f} ms look-ahead ramp,'
      f' {P["lim_rel_ms"]:.0f} ms release; GR max {lim_gr_db.max():.2f} dB, time >1 dB {np.mean(lim_ctrl > 1) * DUR:.2f} s,'
      f' >3 dB {np.mean(lim_ctrl > 3) * DUR:.2f} s')
    o('                      largest GR at: ' + ', '.join(f'{t_:.2f}s {g_:.1f}dB' for t_, g_ in sorted(peaks)))
    o(f'  stems             : final_stems/vo.wav, music_ducked.wav, sfx.wav ({", ".join(f"{k}={v}" for k, v in stem_fmt.items())});'
      f' printed through the master gain path; vo+music_ducked+sfx - final_mix residual RMS {stem_sum_err:.1f} dBFS (dither/quantisation only)')
    for k, s in (('vo', vo_s), ('music_ducked', mu_s), ('sfx', sx_s)):
        o(f'      {k:13s}: integrated {integrated(kpow(s)):6.2f} LUFS, sample peak {a2db(np.abs(s).max()):6.2f} dBFS')
    o('')

    # ---------------------------------------------------------------- VO lines
    o('[2] VOICE-OVER (per line, measured on the final stems = as heard in final_mix)')
    o(f'  chain: 24k->48k resample_poly(Kaiser 10) | HPF {P["hpf_hz"]:.0f} Hz {P["hpf_order"] * 6} dB/oct | peak {P["lowmid"][1]:+.0f} dB @{P["lowmid"][0]:.0f} Hz Q{P["lowmid"][2]}'
      f' | peak {P["presence"][1]:+.0f} dB @{P["presence"][0]:.0f} Hz Q{P["presence"][2]} | de-esser {P["deess_band"][0] / 1000:.0f}-{P["deess_band"][1] / 1000:.0f} kHz'
      f' {P["deess_ratio"]:.0f}:1 (thr {vmeta["deess_T"]:.1f} dBFS band peak, max {P["deess_max_db"]:.0f} dB)')
    o(f'         compressor {P["comp_ratio"]:.0f}:1 knee {P["comp_knee_db"]:.0f} dB, {P["comp_att_ms"]:.0f}/{P["comp_rel_ms"]:.0f} ms, thr {vmeta["comp_T"]:.1f} dBFS RMS'
      f' (all lines: GR median {vmeta["comp_gr_med"]:.1f} dB, P95 {vmeta["comp_gr_p95"]:.1f} dB, max {vmeta["comp_gr_max"]:.1f} dB on voiced frames)')
    o(f'         warmth: 2x-oversampled tanh, drive {P["sat_drive"]}, parallel mix {P["sat_mix"]:.0%} | levelled per line to {P["vo_line_lufs"]} LUFS (dry, pre-master)')
    o(f'  reverb: synthetic dark plate/room, pre-delay {rinfo["predelay_ms"]:.0f} ms, RT60 (Schroeder T20 of IR) {rinfo["rt60"]:.2f} s,'
      f' wet {rinfo["wet_rel_lu"]:+.1f} LU re dry, wet L/R correlation {rinfo["corr"]:.2f} (width on the wet only; dry is dual-mono centre)')
    o(f'  ducking key: dry VO RMS 10 ms, look-ahead {P["duck_lookahead_ms"]:.0f} ms, hold {P["duck_hold_ms"]:.0f} ms (pauses < {P["duck_bridge_s"]} s inside/between lines bridged: {n_bridged}), attack {P["duck_att_ms"]:.0f} ms, release {P["duck_rel_ms"]:.0f} ms.'
      f' Nominal (effort 0): pitched stems (melody/strings/brass/choir/low) broadband -{NOMINAL["b"]:.0f} dB + extra 1-4 kHz dip -{NOMINAL["band"]:.0f} dB;'
      f' drums/fx_hits -{NOMINAL["perc"]} dB; SFX UI sounds -{P["duck_sfx_db"]:.0f} dB (impacts/hits/stamps/anvil/risers/swell protected).')
    o('  per-line solve: the minimal effort on the ladder ' + ' -> '.join(f'{k} {a:g}..{b:g}' for k, a, b in LADDER)
      + f' that gives >= +{P["ratio_target_db"] + P["ratio_margin_db"]:.1f} dB in 1-4 kHz (target +{P["ratio_target_db"]:.0f} + {P["ratio_margin_db"]} margin).')
    o(f'  drop rides (16/96/104/116 s, {P["ride_pre"] * 1000:.0f} ms before -> +{P["ride_hold"]} s hold -> {P["ride_out"]} s out): SFX +{P["sfx_ride_db"]} dB,'
      f' drums/fx_hits +{P["perc_ride_db"]} dB, pitched stems +{P["pitched_ride_db"]} dB. SFX fader {P["sfx_fader_db"]} dB, music fader {P["music_fader_db"]} dB.')
    o('')
    hdr = ('  line  start    end   dur  gap>  pre  ds.max ds.act cmp.med cmp.p95  sat.h  lineLU  Mvoic  STmax'
           '  r1-4k  r1-4k.p10  rKW  effort  duck b/band/drm/drm.band/voB   r@nom  bg 1-4k: pit/drm/sfx')
    o(hdr)
    o('  ' + '-' * (len(hdr) - 2))
    sbf = bp_sos(1000.0, 4000.0, order=4)
    vo_band = signal.sosfiltfilt(sbf, vo_s, axis=0)
    bg_band = signal.sosfiltfilt(sbf, bg_s, axis=0)
    e_vo_b = (vo_band ** 2).sum(axis=1)
    e_bg_b = (bg_band ** 2).sum(axis=1)
    del vo_band, bg_band
    pw_vo = kpow(vo_s)
    pw_bg = kpow(bg_s)
    m_vo, st_m = win_mean(pw_vo, int(0.4 * SR), int(0.01 * SR))
    s_vo, st_s = win_mean(pw_vo, int(3.0 * SR), int(0.1 * SR))
    fr_vo_b = e_vo_b[:NF * FH].reshape(NF, FH).sum(1)
    fr_bg_b = e_bg_b[:NF * FH].reshape(NF, FH).sum(1)
    fr_vo_k = pw_vo[:NF * FH].reshape(NF, FH).sum(1)
    fr_bg_k = pw_bg[:NF * FH].reshape(NF, FH).sum(1)
    gaps = []
    lineLU = []
    rows = []
    for i, l in enumerate(vst):
        a, b = int(l['start'] * SR), int(l['end'] * SR)
        L_line = integrated(pw_vo[a:b])
        lineLU.append(L_line)
        mm = (st_m + int(0.4 * SR) > a) & (st_m < b)
        mv = m_vo[mm]
        mv = mv[lufs(mv) > L_line - 10]
        M_voiced = float(lufs(mv.mean())) if len(mv) else float('nan')
        ss = (st_s + int(3.0 * SR) > a) & (st_s < b)
        ST_max = float(lufs(s_vo[ss].max()))
        fr = line_frames[i]
        rb = 10 * math.log10(fr_vo_b[fr].sum() / fr_bg_b[fr].sum())
        rb_p10 = float(np.percentile(10 * np.log10(fr_vo_b[fr] / np.maximum(fr_bg_b[fr], 1e-20)), 10))
        rk = 10 * math.log10(fr_vo_k[fr].sum() / fr_bg_k[fr].sum())
        nxt = vst[i + 1]['start'] if i + 1 < len(vst) else DUR
        gap = nxt - l['end']
        gaps.append(gap)
        l.update(lineLU=L_line, M_voiced=M_voiced, ST_max=ST_max, r_band=rb, r_band_p10=rb_p10, r_kw=rk, gap=gap)
        rows.append(l)
        o(f"  {l['id']:4s} {l['start']:6.2f} {l['end']:6.2f} {l['dur']:5.2f} {gap:5.2f} {l['pre_gain_db']:+5.1f}"
          f"  {l['deess_max_db']:5.1f}  {l['deess_active_pct']:4.1f}%  {l['comp_gr_med']:5.1f}   {l['comp_gr_p95']:5.1f}"
          f"  {l['sat_thd_db']:6.1f}  {L_line:6.2f} {M_voiced:6.2f} {ST_max:6.2f}  {rb:+5.1f}  {rb_p10:+6.1f}    {rk:+5.1f}"
          f"  {l['effort']:+5.2f}  {l['knobs']['b']:.1f}/{l['knobs']['band']:.1f}/{l['knobs']['perc']:.1f}/{l['knobs']['pband']:.1f}/{l['knobs']['vob']:+.1f}"
          f"   {l['r_nominal']:+5.1f}   {100 * l['share'][0] + 100 * l['share'][1]:3.0f}%/{100 * l['share'][2] + 100 * l['share'][3]:3.0f}%/{100 * l['share'][4]:3.0f}%"
          f"  {'OK' if rb >= P['ratio_target_db'] else 'LOW'}")
    o('  columns: gap> = silence until next line (s); pre = gain to the -20 LUFS processing reference; ds.max/ds.act = de-esser max GR (dB)'
      ' / % of voiced time with >1 dB GR; cmp = compressor GR on voiced frames (dB); sat.h = added harmonic/residual level re signal (dB);')
    o('           effort/duck = solved ladder position and depths in dB (pitched broadband / pitched extra 1-4 kHz / drums broadband /'
      ' drums extra 1-4 kHz / VO line lift); r@nom = 1-4 kHz ratio the nominal brief setting would give; bg = who fills the 1-4 kHz background.')
    o('           lineLU = BS.1770 gated loudness of the VO stem over the line (as heard); Mvoic = energy-mean momentary loudness of'
      ' voiced 400 ms blocks; STmax = max short-term (3 s) touching the line (short lines read lower: the 3 s window includes silence);')
    o('           r1-4k = VO / background(music_ducked+sfx) energy ratio in 1-4 kHz over the line\'s voiced 50 ms frames;'
      ' r1-4k.p10 = 10th-percentile frame ratio (worst moments); rKW = broadband K-weighted ratio; duck = solved depths in dB.')
    spread = max(lineLU) - min(lineLU)
    mv_all = [r['M_voiced'] for r in rows]
    o(f'  line loudness: mean {np.mean(lineLU):.2f} LUFS, min {min(lineLU):.2f}, max {max(lineLU):.2f}, spread {spread:.2f} LU'
      f'  -> {"OK" if spread <= 2.0 and max(abs(x - np.median(lineLU)) for x in lineLU) <= 1.0 else "FAIL"} (+/-1 LU)')
    o(f'  voiced momentary: spread {max(mv_all) - min(mv_all):.2f} LU (min {min(mv_all):.2f}, max {max(mv_all):.2f})')
    rbs = [r['r_band'] for r in rows]
    rks = [r['r_kw'] for r in rows]
    o(f'  VO/background 1-4 kHz: min {min(rbs):+.1f} dB ({rows[int(np.argmin(rbs))]["id"]}), median {np.median(rbs):+.1f} dB'
      f'  -> {"OK" if min(rbs) >= P["ratio_target_db"] else "FAIL"} (>= +{P["ratio_target_db"]:.0f} dB every line)')
    o(f'  VO/background broadband (K-weighted): min {min(rks):+.1f} dB ({rows[int(np.argmin(rks))]["id"]}), median {np.median(rks):+.1f} dB')
    o(f'  overlap check: min gap between consecutive lines {min(gaps[:-1]):.3f} s ({vst[int(np.argmin(gaps[:-1]))]["id"]}->'
      f'{vst[int(np.argmin(gaps[:-1])) + 1]["id"]}); overlaps: {sum(g < 0 for g in gaps)}  -> {"OK" if min(gaps) > 0 else "FAIL"}'
      f'  (last line ends {vst[-1]["end"]:.2f} s)')
    o('  solver prediction (pred) vs measured: ' + ', '.join(f'{r["id"]} {r["r_pred"]:+.1f}/{r["r_band"]:+.1f}' for r in rows))
    o(f'  solver prediction vs measured 1-4 kHz ratio: max |diff| {max(abs(r["r_pred"] - r["r_band"]) for r in rows):.2f} dB'
      f'; lines needing more than nominal: {", ".join(r["id"] for r in rows if r["effort"] > 0.01) or "none"};'
      f' relaxed to 5 dB broadband: {", ".join(r["id"] for r in rows if r["effort"] <= -0.999) or "none"}')
    # ducking recovery in gaps
    gm = gdb[0]
    rec = []
    for i in range(nl - 1):
        if gaps[i] > 1.0:
            tm = vst[i]['end'] + gaps[i] - 0.05
            rec.append(f"{vst[i]['id']}->{vst[i + 1]['id']} gap {gaps[i]:.1f}s: music {gm[int(tm * CR)]:+.1f} dB just before next line")
    o('  duck recovery between lines: ' + '; '.join(rec))
    o('')

    # ---------------------------------------------------------------- bar table
    o('[3] LOUDNESS PER 2 s BAR (final mix; barLU = K-weighted energy over the bar; STmax = max 3 s; Mmax = max 400 ms;'
      ' music = raw score sum, same master gain, no ducking; VO% = bar time covered by a VO line)')
    m_fin, st_mf = win_mean(pw_fin, int(0.4 * SR), int(0.01 * SR))
    s_fin, st_sf = win_mean(pw_fin, int(3.0 * SR), int(0.1 * SR))
    pw_mus = kpow(music_raw * (10 ** (gain_db / 20) * g_glue * g_lim * fade)[:, None])
    del music_raw
    secs = tl['sections']

    def sec_of(t):
        for s in secs:
            if s['start'] <= t < s['end']:
                return s['name']
        return '?'

    bars = []
    o('   bar    t0  section    barLU  STmax   Mmax  music  VO%   graph')
    for b in range(60):
        a0, a1 = b * 2 * SR, (b + 1) * 2 * SR
        bl = float(lufs(pw_fin[a0:a1].mean()))
        ml = float(lufs(pw_mus[a0:a1].mean()))
        e_m = st_mf + int(0.4 * SR)
        mmax = float(lufs(m_fin[(e_m > a0) & (e_m <= a1)].max()))
        e_s = st_sf + int(3.0 * SR)
        sel = (e_s > a0) & (e_s <= a1)
        stmax = float(lufs(s_fin[sel].max())) if sel.any() else float('nan')
        cov = sum(max(0.0, min(l['end'], 2 * b + 2) - max(l['start'], 2 * b)) for l in vst) / 2.0
        bars.append(dict(bar=b + 1, t0=2 * b, sec=sec_of(2 * b + 0.01), L=bl, ST=stmax, M=mmax, mus=ml, cov=cov))
        gr = '#' * max(0, int(round((bl + 40) * 1.0)))
        sts = f'{stmax:6.1f}' if np.isfinite(stmax) else '   n/a'
        o(f'  {b + 1:4d} {2 * b:5.0f}  {sec_of(2 * b + 0.01):9s} {bl:6.1f} {sts} {mmax:6.1f} {ml:6.1f} {cov * 100:4.0f}%  {gr}')

    def avg(b0, b1):
        return float(lufs(np.mean([10 ** ((bars[i - 1]['L'] + 0.691) / 10) for i in range(b0, b1 + 1)])))

    groups = [('hook 1-8', 1, 8), ('drop/reveal 9-16', 9, 16), ('feat1 17-24', 17, 24), ('feat2 25-32', 25, 32),
              ('feat3 33-40', 33, 40), ('montage 41-44', 41, 44), ('breakdown 45-48', 45, 48), ('bar 49 hit', 49, 49),
              ('metric 50-52', 50, 52), ('finale 53-58', 53, 58), ('outro 59-60', 59, 60)]
    ga_ = {g[0]: avg(g[1], g[2]) for g in groups}
    o('  section averages (energy mean of bar loudness):')
    for g in groups:
        o(f'    {g[0]:18s} {ga_[g[0]]:6.1f} LUFS')
    multi = {k: v for k, v in ga_.items() if k not in ('bar 49 hit', 'outro 59-60')}
    checks = [
        ('hook 1-8 quieter than the drop 9-16', ga_['hook 1-8'] < ga_['drop/reveal 9-16'] - 1.0),
        ('drop 9-16 louder than the feature grooves', ga_['drop/reveal 9-16'] > max(ga_['feat1 17-24'], ga_['feat2 25-32'], ga_['feat3 33-40'])),
        ('montage 41-44 louder than feat3', ga_['montage 41-44'] > ga_['feat3 33-40']),
        ('breakdown 45-48 quieter than drop, montage and finale', ga_['breakdown 45-48'] < min(ga_['drop/reveal 9-16'], ga_['montage 41-44'], ga_['finale 53-58']) - 1.0),
        ('bar 49 (6,985 lands) louder than the breakdown', ga_['bar 49 hit'] > ga_['breakdown 45-48'] + 2.0),
        ('finale 53-58 is the loudest multi-bar section', ga_['finale 53-58'] >= max(multi.values()) - 1e-9),
        ('bar 59 (final hit) is the loudest bar', bars[58]['L'] >= max(b['L'] for b in bars) - 1e-9),
        ('outro decays (bar 60 < bar 59 - 10 dB)', bars[59]['L'] < bars[58]['L'] - 10),
    ]
    for name, ok in checks:
        o(f'    [{"OK" if ok else "FAIL"}] {name}')
    o('')

    # ---------------------------------------------------------------- hits
    o('[4] BIG-HIT / ONSET CHECK (momentary 400 ms and 50 ms transient loudness of final_mix, 10 ms hop; window end time)')
    s50, st50 = win_mean(pw_fin, int(0.05 * SR), int(0.01 * SR))
    tm_end = (st_mf + int(0.4 * SR)) / SR
    t50_end = (st50 + int(0.05 * SR)) / SR
    Mdb = lufs(m_fin)
    S50 = lufs(s50)
    excl = np.zeros(len(Mdb), bool)
    for th in BIG_HITS:
        excl |= (tm_end >= th - 0.05) & (tm_end <= (th + 0.9 if th < 116 else DUR + 1))   # 116: hit + final-chord ring-out
    M_else = float(Mdb[~excl].max())
    t_else = float(tm_end[~excl][np.argmax(Mdb[~excl])])
    excl50 = np.zeros(len(S50), bool)
    for th in BIG_HITS:
        excl50 |= (t50_end >= th - 0.02) & (t50_end <= (th + 0.4 if th < 116 else DUR + 1))
    S_else = float(S50[~excl50].max())
    hit_rows = []
    o('   hit      Mpeak  (at)     S50pk   pre-ctx(M med, t-2..t-0.3)  contrast   M rank (1.5 s NMS)')
    order = np.argsort(Mdb)[::-1]
    picks = []
    for idx in order:
        t_ = tm_end[idx]
        if all(abs(t_ - p) > 1.5 for p, _ in picks):
            picks.append((t_, float(Mdb[idx])))
        if len(picks) >= 12:
            break
    for th in BIG_HITS:
        sel = (tm_end >= th) & (tm_end <= th + 0.6)
        mp = float(Mdb[sel].max())
        mt = float(tm_end[sel][np.argmax(Mdb[sel])])
        s5 = float(S50[(t50_end >= th) & (t50_end <= th + 0.15)].max())
        ctx = float(np.median(Mdb[(tm_end >= th - 2.0) & (tm_end <= th - 0.3)]))
        rank = next((k + 1 for k, (t_, _) in enumerate(picks) if abs(t_ - mt) <= 0.8), None)
        hit_rows.append(dict(t=th, M=mp, S50=s5, ctx=ctx, rank=rank))
        o(f'  {th:6.1f}  {mp:7.2f} ({mt:6.2f})  {s5:7.2f}   {ctx:7.2f}                  {mp - ctx:+6.1f} dB   {rank}')
    o(f'  loudest momentary outside the 4 big hits (16/96/104: hit +0.9 s; 116: hit + ring-out to the end): {M_else:.2f} LUFS at {t_else:.2f} s;'
      f' loudest 50 ms outside them: {S_else:.2f} LUFS')
    ok_hits = all(h['M'] >= M_else for h in hit_rows)
    ok_s50 = all(h['S50'] >= S_else - 1.0 for h in hit_rows)
    o(f'  [{"OK" if ok_hits else "FAIL"}] every big hit (16/96/104/116 s) is louder (momentary) than anything else in the film')
    o(f'  [{"OK" if ok_s50 else "WARN"}] every big hit 50 ms transient is within 1 dB of / above the loudest other transient')
    o('  top-12 momentary peaks (1.5 s non-max suppression): ' + ', '.join(f'{t_:.2f}s {m_:.1f}' for t_, m_ in picks))
    mont = []
    for th in [80.0 + k for k in range(8)]:
        sel = (t50_end >= th) & (t50_end <= th + 0.12)
        ctx = float(np.median(S50[(t50_end >= th + 0.3) & (t50_end <= th + 0.7)]))
        mont.append((th, float(S50[sel].max()), float(S50[sel].max()) - ctx))
    o('  montage cuts (S50 peak / contrast vs the half-beat after): ' + ', '.join(f'{t_:.0f}s {p:.1f}/{c:+.1f}' for t_, p, c in mont))
    o('')
    o('[5] FILES')
    for pth in ['final_mix.wav', 'final_stems/vo.wav', 'final_stems/music_ducked.wav', 'final_stems/sfx.wav',
                'final_mix_report.txt', 'final_mix_analysis.png']:
        o(f'  {out_dir / pth}')
    o(f'  build script: {ROOT / "audio-src/mix/build_mix.py"}  (runtime {time.time() - T0:.0f} s)')
    txt = '\n'.join(rep) + '\n'
    (out_dir / 'final_mix_report.txt').write_text(txt)
    print(txt)

    # ---------------------------------------------------------------- figure
    if not no_png:
        make_png(out_dir / 'final_mix_analysis.png', fin, vo_s, mu_s, sx_s, vst, gdb, tm_end, Mdb, st_sf, s_fin,
                 st_s, s_vo, I_fin, tp4, LRA_fin, tl)
        log('png written')


def make_png(path, fin, vo_s, mu_s, sx_s, vst, gdb, tm_end, Mdb, st_sf, s_fin, st_s, s_vo, I_fin, tp4, LRA_fin, tl):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.gridspec import GridSpec

    SURF, INK, INK2, GRID = '#fcfcfb', '#0b0b0b', '#52514e', '#e4e3df'
    C_VO, C_MU, C_SX, C_BAND = '#2a78d6', '#eb6834', '#1baf7a', '#e87ba4'
    plt.rcParams.update({'font.size': 10, 'axes.edgecolor': GRID, 'axes.labelcolor': INK2, 'xtick.color': INK2,
                         'ytick.color': INK2, 'axes.facecolor': SURF, 'figure.facecolor': SURF, 'axes.titlecolor': INK,
                         'axes.titlesize': 11, 'axes.titleweight': 'bold', 'axes.titlelocation': 'left'})
    fig = plt.figure(figsize=(22, 17), dpi=100)
    gs = GridSpec(5, 1, height_ratios=[1.25, 1.6, 1.0, 0.85, 0.95], hspace=0.42, left=0.05, right=0.985, top=0.95, bottom=0.04)
    fig.suptitle(f'Albion Journal - final mix  |  {I_fin:.1f} LUFS integrated, {tp4:.1f} dBTP, LRA {LRA_fin:.1f} LU  |'
                 '  shaded = VO lines, dashed = big hits', x=0.05, ha='left', fontsize=14, fontweight='bold', color=INK)

    def spans(ax, labels=False, ymax=None):
        for l in vst:
            ax.axvspan(l['start'], l['end'], color=C_VO, alpha=0.10, lw=0)
            if labels:
                ax.text((l['start'] + l['end']) / 2, ymax, l['id'], ha='center', va='bottom', fontsize=8, color=C_VO)
        for th in BIG_HITS:
            ax.axvline(th, color=INK2, ls='--', lw=1.0)
        for s in tl['sections']:
            ax.axvline(s['start'], color=GRID, lw=0.8, zorder=0)

    # A: waveform
    ax = fig.add_subplot(gs[0])
    cols = 4000
    seg = N // cols
    mono = fin.mean(axis=1)[:cols * seg].reshape(cols, seg)
    vmono = vo_s.mean(axis=1)[:cols * seg].reshape(cols, seg)
    tt = (np.arange(cols) + 0.5) * seg / SR
    ax.fill_between(tt, mono.min(1), mono.max(1), color='#8a8984', lw=0, label='final mix (L+R)/2')
    ax.fill_between(tt, vmono.min(1), vmono.max(1), color=C_VO, lw=0, alpha=0.85, label='VO stem (as heard)')
    spans(ax, labels=True, ymax=0.93)
    ax.set_xlim(0, DUR)
    ax.set_ylim(-1.05, 1.15)
    ax.set_ylabel('amplitude')
    ax.set_title('Waveform - final mix with the VO stem overlaid')
    ax.legend(loc='lower right', bbox_to_anchor=(1.0, 1.0), frameon=False, ncol=2, fontsize=9)
    for th, lab in zip(BIG_HITS, ['16 s drop', '96 s 6,985', '104 s finale', '116 s final hit']):
        ax.text(th + 0.3, -1.0, lab, fontsize=8, color=INK2)

    # B: spectrogram
    ax = fig.add_subplot(gs[1])
    f, t, S = signal.spectrogram(fin.mean(axis=1), SR, nperseg=4096, noverlap=4096 - 1200, window='hann', mode='psd')
    from scipy.interpolate import interp1d
    flog = np.geomspace(30, 20000, 360)
    Sd = interp1d(f, 10 * np.log10(S + 1e-14), axis=0)(flog)
    vmax = np.percentile(Sd, 99.7)
    ax.pcolormesh(t, flog, Sd, shading='auto', cmap='magma', vmin=vmax - 85, vmax=vmax, rasterized=True)
    ax.set_yscale('log')
    ax.set_ylim(30, 20000)
    for l in vst:
        ax.plot([l['start'], l['end']], [25000 * 0.72] * 2, color='#9ec5f4', lw=4, solid_capstyle='butt')
        ax.axvspan(l['start'], l['end'], ymin=0, ymax=1, facecolor='none', edgecolor='#9ec5f4', lw=0.8, alpha=0.6)
    for th in BIG_HITS:
        ax.axvline(th, color='white', ls='--', lw=0.9, alpha=0.8)
    ax.axhspan(1000, 4000, xmin=0, xmax=0.006, color='white')
    ax.set_xlim(0, DUR)
    ax.set_ylabel('Hz (log)')
    ax.set_title('Spectrogram - final mix (mono sum, 4096-pt Hann, dB re max; outlined = VO lines; white tick at left = 1-4 kHz band)')

    # C: loudness
    ax = fig.add_subplot(gs[2])
    ax.plot(tm_end, Mdb, color='#b9b8b2', lw=0.7, label='final - momentary (400 ms)')
    ax.plot((st_sf + 3 * SR) / SR, lufs(s_fin), color=INK, lw=1.6, label='final - short-term (3 s)')
    ax.plot((st_s + 3 * SR) / SR, lufs(s_vo), color=C_VO, lw=1.6, label='VO stem - short-term')
    pw_m = kpow(mu_s)
    sm, st_mu = win_mean(pw_m, 3 * SR, int(0.1 * SR))
    ax.plot((st_mu + 3 * SR) / SR, lufs(sm), color=C_MU, lw=1.6, label='music_ducked - short-term')
    ax.axhline(-14, color=INK2, ls=':', lw=1)
    spans(ax)
    ax.set_xlim(0, DUR)
    ax.set_ylim(-45, -4)
    ax.set_ylabel('LUFS')
    ax.set_title('Loudness - the music comes back up between lines, the hits stay on top (dotted = -14 LUFS target)')
    ax.legend(loc='lower right', bbox_to_anchor=(1.0, 1.0), frameon=False, ncol=4, fontsize=9)

    # D: duck gains
    ax = fig.add_subplot(gs[3])
    tc = (np.arange(NC) + 0.5) / CR
    ax.plot(tc, gdb[0], color=C_MU, lw=1.4, label='pitched stems, broadband')
    ax.plot(tc, gdb[1], color=C_BAND, lw=1.2, label='pitched stems, 1-4 kHz')
    ax.plot(tc, gdb[2], color=INK2, lw=1.2, label='drums + fx_hits')
    ax.plot(tc, gdb[4] - P['sfx_fader_db'], color=C_SX, lw=1.2, label='SFX (re fader)')
    spans(ax)
    ax.set_xlim(0, DUR)
    ax.set_ylim(min(-13.0, float(np.floor(gdb.min())) - 1), 4)
    ax.set_ylabel('gain dB')
    ax.set_xlabel('time (s)')
    ax.set_title('Ducking gains from the VO key (40 ms look-ahead, 60/350 ms) + drop rides')
    ax.legend(loc='lower right', bbox_to_anchor=(1.0, 1.0), frameon=False, ncol=4, fontsize=9)

    # E: per-line ratios
    ax = fig.add_subplot(gs[4])
    ids = [l['id'] for l in vst]
    x = np.arange(len(ids))
    ax.bar(x - 0.2, [l['r_band'] for l in vst], width=0.38, color=C_VO, label='VO / background, 1-4 kHz')
    ax.bar(x + 0.2, [l['r_kw'] for l in vst], width=0.38, color=C_MU, label='VO / background, broadband K-weighted')
    ax.axhline(P['ratio_target_db'], color=INK, ls='--', lw=1, label=f'+{P["ratio_target_db"]:.0f} dB target (1-4 kHz)')
    for xi, l in zip(x, vst):
        ax.text(xi - 0.2, l['r_band'] + 0.3, f"{l['r_band']:.1f}", ha='center', fontsize=7.5, color=INK2)
    ax.set_xticks(x)
    ax.set_xticklabels([f"{l['id']}\n{l['start']:.1f}s" for l in vst], fontsize=8)
    ax.set_ylabel('dB')
    ax.set_title('Per-line VO-to-background ratio (voiced frames of each line, measured on the final stems)')
    ax.legend(loc='lower right', bbox_to_anchor=(1.0, 1.0), frameon=False, ncol=3, fontsize=9)
    ax.grid(axis='y', color=GRID, lw=0.6)
    ax.set_axisbelow(True)
    fig.savefig(path, dpi=100)
    plt.close(fig)


if __name__ == '__main__':
    main()
