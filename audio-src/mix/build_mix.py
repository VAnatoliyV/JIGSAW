#!/usr/bin/env python3
"""Albion Journal - final film mix (VO + ducked score stems + SFX -> mastered stereo).

Deterministic and re-runnable; everything is driven by timeline/timeline.json.

    python3 audio-src/mix/build_mix.py            # mix, stems, report, analysis PNG
    python3 audio-src/mix/build_mix.py --no-png   # skip the figure
    python3 audio-src/mix/build_mix.py --set=key=JSON   # parameter experiments (any key of P)

Inputs (read-only; the music / SFX / VO builds are not touched)
  assets/audio/music/stems/{drums_perc,low,strings,brass,choir_pads,melody,fx_hits}.wav
  assets/audio/sfx/sfx_track.wav  (+ sfx_cues.json, oneshots/ for the impact-protect mask and the hit layers)
  audio-src/vo/take_george/vNN.wav (Kokoro 'bm_george', 24 kHz mono), placed at timeline vo[i].t

Outputs
  assets/audio/final_mix.wav                         48 kHz / 24-bit / stereo / exactly 120.000 s
  assets/audio/final_stems/{vo,music_ducked,sfx}.wav  printed THROUGH the master gain path (glue gain x master gain x
                                                      limiter gain x fade, stereo-linked, gain-only), so
                                                      vo + music_ducked + sfx == final_mix (to dither / 24-bit LSB)
  assets/audio/final_mix_report.txt                  verification report
  assets/audio/final_mix_analysis.png                spectrogram + waveform + loudness + duck curves

Signal flow
  VO edit : v09's internal pauses are tightened (silence only, 8 ms crossfades) so its last word clears the 48.0 impact
  VO line : 24k->48k (polyphase, Kaiser) -> 5/20 ms edge fades -> HPF 80 Hz (24 dB/oct) -> -3 dB @150 Hz (boom)
            -> +1.5 dB @420 Hz (body) -> +2 dB @3.5 kHz (presence) -> -1.5 dB @6.5 kHz -> split-band de-esser
            (5-9 kHz) -> 3:1 soft-knee compressor (10/120 ms) -> 2x-oversampled parallel tanh warmth
            -> 'air' (single-sideband copy of the 5.5-11 kHz band shifted up 5.5 kHz, -12 dB: the 24 kHz takes stop at 11 kHz)
            -> per-line BS.1770 levelling -> phrase rides ('Updated in seconds', 'Stop guessing')
            -> placed at vo[i].t on the dry VO bus (mono, centred) -> true-peak VO limiter 3 dB under the master ceiling
  VO rev  : dry bus -> HPF 180 Hz / LPF 6.5 kHz send -> synthetic dark plate/room IR (20 ms pre-delay, RT ~0.7 s)
            -> M/S width on the wet only -> wet at -20 LU re dry
  Duck    : key = dry-VO RMS (10 ms) -> speech regions; pauses < 2.1 s are bridged unless a planned hit sits in the gap
            with room for the music to come back (then the duck is released before the hit and re-applied after it).
            Linear-in-dB ramps: 0.40 s look-ahead attack (finished 50 ms before the first phoneme), 0.20 s hold,
            0.80 s release, 60 ms corner smoothing.  A slower 'pocket' envelope (bridges 4 s, 1.0/1.5 s ramps) carries a
            static 1-4 kHz EQ pocket on the orchestra across VO sections.
            pitched (melody/strings/brass/choir/low) : -b broadband, -(b+band) in 1-4 kHz, -pocket in 1-4 kHz (slow)
            drums_perc+fx_hits                     : -perc broadband, -(perc+pband) in 1-4 kHz (punch-through at bridged hits)
            SFX                                    : -2 dB on UI sounds while speaking; impacts/hits/stamps/anvil/risers exempt
            Depths are solved per line (ladder) so the VO beats the background by >= +9 dB in 1-4 kHz.
  Protect : every accent (SFX impact/hit/stamp/anvil/coin/zap cue, or a detected drums/fx_hits accent) that lands on
            speech gets a short dip on drums+fx_hits+SFX (15 ms ramp before the transient, 120 ms hold, 200 ms release),
            depth solved so the VO stays >= +4.5 dB (K-weighted) / +6.5 dB (1-4 kHz) over the background in the 0-300 ms window.
  Hits    : 16/96/104/116 s: no fader rides; contrast instead: a 4-5 dB 'suck-out' of the score 0.30-0.004 s before each
            hit, montage bars 41-43 -1.5 dB, finale bars 57-58 -2 dB, -2.5 dB of sub (<90 Hz) on the hits (limiter
            headroom), and phone-translation layers on the SFX bus: the hit's own impact one-shot band-passed 150-500 Hz
            (body) + a 'hit' one-shot high-passed at 700 Hz (2-5 kHz crack).  Score +2 dB high shelf at 11 kHz.
  Master  : glue (2:1 soft knee, 30/200 ms, stereo-linked) -> gain to -14 LUFS -> look-ahead true-peak limiter
            (4x oversampled detector, ceiling -1.2 dBTP, 4 ms look-ahead, 80 ms release) -> 0.3 s fade to digital
            silence -> TPDF dither -> 24-bit.
"""
from __future__ import annotations

import json
import math
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import fft as sp_fft, signal
from scipy.ndimage import maximum_filter1d, median_filter, minimum_filter1d, uniform_filter1d

ROOT = Path(__file__).resolve().parents[2]
SR = 48000
DUR = 120.0
N = int(round(DUR * SR))          # 5 760 000
CR = 1000                          # control rate (Hz) for all dynamics
HOP = SR // CR                     # 48 samples
NC = N // HOP                      # 120 000 control points
FR = 0.02                          # solver / report measurement frame (s)
FH = int(FR * SR)                  # 960 samples
NF = N // FH                       # 6000 frames
CPF = FH // HOP                    # 20 control points per frame

P = dict(
    # ---- VO edit (silence only; the visual track keys on v16/v17/v19 word times, which are not touched)
    vo_tighten={'v02': 11.71, 'v09': 47.88, 'v15': 85.93},  # line -> its last voiced 5 ms frame ends by (s): clears the
                                # 11.75 stamp, the 48.0 impact and the 86.0 montage cut
    tighten_thr_db=-38.0, tighten_min_pause=0.06, tighten_keep_long=0.13, tighten_keep_short=0.05, tighten_xfade_ms=8.0,
    phrase_pause_s=0.10,
    # ---- VO chain
    vo_pre_lufs=-20.0,          # mono BS.1770 reference level the de-esser / compressor are calibrated at
    vo_line_lufs=-15.0,         # per-line loudness on the dry bus (dual-mono stereo, BS.1770) pre-master
    hpf_hz=80.0, hpf_order=4,
    vo_eq=((150.0, -3.0, 1.4), (420.0, 1.5, 0.9), (3500.0, 2.0, 0.9), (6500.0, -1.5, 0.9)),   # f0, gain dB, Q
    deess_band=(5000.0, 9000.0), deess_ratio=4.0, deess_max_db=8.0, deess_pct=90.0, deess_rel_open_db=-12.0,
    comp_ratio=3.0, comp_knee_db=6.0, comp_att_ms=10.0, comp_rel_ms=120.0, comp_rms_ms=5.0,
    comp_median_gr_db=3.0,      # threshold is calibrated so the median GR on voiced frames is this
    sat_drive=2.0, sat_mix=0.25,
    air_band=(5500.0, 11000.0), air_shift_hz=5500.0, air_db=-12.0, air_hpf=10500.0, air_lpf=14000.0,
    vo_rides={'v17': [['Updated in seconds', 1.5]], 'v18': [['Stop guessing', 0.8], ['Start crafting', 0.4]]},
    ride_ramp_s=0.04,
    vo_lift_max_db=0.9,         # max line-loudness lift over the levelled value (phrase rides + solver lift): +/-1 LU
    vo_tp_rel_db=-3.0, vo_lim_la_ms=1.5, vo_lim_rel_ms=40.0, master_gain_guess_db=0.5,
    sfx_tp_rel_db=-2.0, sfx_lim_la_ms=1.5, sfx_lim_rel_ms=10.0,
    # ---- VO reverb
    rev_predelay_ms=20.0, rev_rt60=0.70, rev_len_s=1.6, rev_wet_lu=-20.0, rev_width=0.55,
    rev_send_hpf=180.0, rev_send_lpf=6500.0, rev_dark_lpf=5500.0,
    # ---- ducking envelope
    key_rms_ms=10.0, key_lo_rel=-26.0, key_hi_rel=-14.0,
    duck_bridge_s=2.1, duck_hold_s=0.20, duck_att_s=0.50, duck_rel_s=0.90, duck_pre_s=0.05, duck_corner_s=0.06,
    pocket_bridge_s=4.0, pocket_hold_s=0.40, pocket_att_s=1.0, pocket_rel_s=1.5,
    punch_times=[16.0, 32.0, 48.0, 64.0, 80.0, 88.0, 96.0, 104.0, 116.0],
    punch_rec_min_s=0.30, punch_att_min_s=0.35, punch_after_s=0.04, punch_before_s=0.03,
    punch_through=[0.03, 0.35, 0.30],     # bridged hit: drums/fx_hits/SFX duck lifted t-0.03 .. t+0.35, back over 0.30 s
    dip_band=(1000.0, 4000.0),
    ratio_target_db=9.0, ratio_margin_db=0.5, passes=2,
    floor_band_db=3.0, floor_kw_db=3.0,   # every 0.5 s window of a line (speech-core frames) must also clear these
    floor_min_frames=8,                   # ... if it holds >= 8 speech-core 20 ms frames (160 ms of speech; word tails go to the accent check)
    # ---- accent protect (word-level masking)
    protect_sfx_types=['impact', 'hit', 'stamp', 'anvil', 'coin', 'zap'],
    accent_rise_db=6.0, accent_over_med_db=10.0,
    protect_target_kw=4.5, protect_target_band=6.5, protect_max_db=10.0, protect_win_s=0.30,
    protect_min_gain_db=1.0, protect_slack_db=0.5, protect_pitched_frac=0.5, protect_pitched_max_db=5.0,   # skip dips that buy < 1 dB; settle 0.5 dB short of an unreachable target
    protect_pre_s=0.02, protect_att_s=0.015, protect_hold_s=0.12, protect_rel_s=0.20, protect_tail_max_s=0.50,
    check_kw_db=3.0, check_band_db=3.0,   # per-event report thresholds (0-300 ms window, speech-core frames)
    # ---- faders / automation
    music_fader_db=0.0, sfx_fader_db=-6.0,
    music_trims=[[16.25, 0.50, 18.55, 0.60, -2.0],   # under 'This is Albion Journal' right after the drop
                 [80.0, 0.05, 86.0, 1.0, -1.5],      # montage bars 41-43
                 [104.45, 0.55, 111.6, 0.8, -1.5],   # finale under the CTA lines (the 104 hit's first 0.45 s untouched)
                 [112.4, 0.8, 115.996, 0.004, -2.0]],  # finale bars 57-58 (contrast for 116); t0, ramp-in, t1, ramp-out, dB
    suck=[[16.0, 4.0], [96.0, 5.0], [104.0, 5.0], [116.0, 5.0]], suck_start_s=0.30, suck_ramp_s=0.08, suck_snap_s=0.004,
    sfx_trims=[[17.97, 0.02, 18.45, 0.30, -4.0],   # the 18.0 wordmark hit + sparkle under 'Journal'
               [99.9, 0.1, 101.7, 0.9, -3.5]],     # the 100-104 riser held down under 'Updated in seconds'
    sfx_protect_types={'impact': 0.6, 'anvil': 0.6, 'hit': 0.3, 'stamp': 0.3,
                       'riser': None, 'reverse': None, 'swell': None},   # UI-duck exemption tail after accent (None = to accent)
    hit_sub_hz=90.0, hit_sub_db=-3.0, hit_sub_pre_s=0.01, hit_sub_hold_s=0.50, hit_sub_rel_s=0.40,
    hit_body_band=(150.0, 500.0), hit_body_db=3.0,
    hit_crack_hpf=700.0, hit_crack_db=0.0,
    vbass_src_hz=100.0, vbass_band=(200.0, 1200.0), vbass_drive=3.0, vbass_even=0.5, vbass_hold_s=0.35, vbass_rel_s=0.25,
    hit_layer_extra_db={'96.0': 4.0},   # the 96 s hit is mostly sub: more of its phone layers
    tone_f0=220.0, tone_f1=146.8, tone_glide_s=0.08, tone_decay_s=0.22, tone_len_s=0.8, tone_partials_db=[0.0, -5.0, -9.0, -13.0],
    tone_rel_db=-3.0,            # drum-body tone layer re the score's hit (K-weighted 400 ms), as mixed
    hit_anvil_hpf=400.0, hit_anvil_db=2.0, hit_anvil_hold_s=0.30, hit_anvil_rel_s=0.30,
    vbass_rel_db=-12.0,          # virtual-bass layer level re the score's hit (K-weighted 400 ms), as mixed
    ride_pitched_db=3.5, ride_perc_db=1.5, ride_sfx_db=3.0, ride_hold_s=0.40, ride_out_s=0.30,
    music_air=(11000.0, 2.0),
    # ---- master
    glue_ratio=2.0, glue_knee_db=6.0, glue_att_ms=30.0, glue_rel_ms=200.0, glue_rms_ms=50.0, glue_p99_gr_db=1.0,
    dc_hpf_hz=12.0, target_lufs=-14.0, tp_ceiling_db=-1.2, lim_la_ms=4.0, lim_rel_ms=40.0, lim_block=16,
    fade_s=0.30, tail_zero_s=0.010,
)

BIG_HITS = (16.0, 96.0, 104.0, 116.0)
OTHER_HITS = (32.0, 48.0, 64.0, 88.0) + tuple(80.0 + k for k in range(8))
MUSIC_STEMS = ('drums_perc', 'low', 'strings', 'brass', 'choir_pads', 'melody', 'fx_hits')
PITCHED = ('melody', 'strings', 'brass', 'choir_pads', 'low')
PERC = ('drums_perc', 'fx_hits')
COMP_NAMES = ('pitched', 'pitched 1-4k', 'drums/fx', 'drums/fx 1-4k', 'SFX')

# Per-line ducking 'effort' ladder: effort s walks these segments in order (segment j covers s in [j-1, j]);
# s = 0 is the nominal brief setting, s = -1 relaxes the broadband duck to 5 dB where the voice has lots of margin.
KNOBS = ('b', 'band', 'perc', 'pband', 'pocket', 'sfx', 'vob')
NOMINAL = dict(b=6.0, band=3.0, perc=2.5, pband=0.0, pocket=0.0, sfx=2.0, vob=0.0)
LADDER = [
    ('b', 5.0, 6.0),        # s -1..0  broadband duck of the pitched stems (melody/strings/brass/choir/low)
    ('band', 3.0, 4.0),     # s  0..1  extra 1-4 kHz dynamic dip on the pitched stems
    ('sfx', 2.0, 4.0),      # s  1..2  UI-sound duck (impacts stay exempt near their accent)
    ('pocket', 0.0, 2.0),   # s  2..3  slow 1-4 kHz EQ pocket on the orchestra (pocket envelope)
    ('pband', 0.0, 3.0),    # s  3..4  1-4 kHz dip on drums/fx_hits (tambourine, snare, cymbal; the low punch is kept)
    ('band', 4.0, 5.0),     # s  4..5  (dynamic 1-4 kHz dip capped at 5 dB)
    ('b', 6.0, 7.0),        # s  5..6
    ('sfx', 4.0, 6.0),      # s  6..7
    ('pocket', 2.0, 3.0),   # s  7..8
    ('pband', 3.0, 5.0),    # s  8..9
    ('pocket', 3.0, 5.0),   # s  9..10 deeper static pocket (full-orchestra finale under the CTA)
    ('perc', 2.5, 3.5),     # s 10..11 broadband drums/fx_hits duck
    ('vob', 0.0, 0.9),      # s 11..12 lift that VO line (capped by the lift budget left after phrase rides)
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


def highshelf_sos(f0, gain_db, s=1.0):
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * f0 / SR
    al = math.sin(w0) / 2 * math.sqrt((A + 1 / A) * (1 / s - 1) + 2)
    c = math.cos(w0)
    b0 = A * ((A + 1) + (A - 1) * c + 2 * math.sqrt(A) * al)
    b1 = -2 * A * ((A - 1) + (A + 1) * c)
    b2 = A * ((A + 1) + (A - 1) * c - 2 * math.sqrt(A) * al)
    a0 = (A + 1) - (A - 1) * c + 2 * math.sqrt(A) * al
    a1 = 2 * ((A - 1) - (A + 1) * c)
    a2 = (A + 1) - (A - 1) * c - 2 * math.sqrt(A) * al
    return np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]])


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


def trap(t, t0, rin, t1, rout):
    """0 -> 1 linearly over [t0, t0+rin], 1 until t1, 1 -> 0 over [t1, t1+rout]."""
    up = np.clip((t - t0) / max(rin, 1e-9), 0.0, 1.0)
    dn = np.clip(1.0 - (t - t1) / max(rout, 1e-9), 0.0, 1.0)
    return np.minimum(up, dn)


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
    x = x if x.ndim == 2 else x[:, None]
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
    coefficient when rising_is_attack, e.g. gain-reduction in dB)."""
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


def peak_limiter_gain(y, ceil_lin, la_ms, rel_ms, block=16):
    """Look-ahead true-peak limiter gain: g[n] <= ceiling / TP(n) by construction
    (centred min-hold over 2L+1, one-pole release at block rate, centred box average over 2L+1)."""
    L_ = max(1, int(la_ms * SR / 1000))
    greq = np.minimum(1.0, ceil_lin / np.maximum(tp_envelope(y), 1e-12))
    m = minimum_filter1d(greq, 2 * L_ + 1, mode='nearest')
    nb = int(math.ceil(len(m) / block))
    mp = np.concatenate([m, np.ones(nb * block - len(m))]).reshape(nb, block).min(axis=1)
    a = math.exp(-1.0 / (rel_ms / 1000 * SR / block))
    xs_ = mp.tolist()
    r = [0.0] * nb
    yv = xs_[0]
    for i, v in enumerate(xs_):
        yv = v if v < yv else a * yv + (1 - a) * v
        r[i] = yv
    rs = np.repeat(np.asarray(r), block)[:len(m)]
    return uniform_filter1d(rs, 2 * L_ + 1, mode='nearest')


def limit(y, ceil_lin, la_ms, rel_ms, iters=3):
    g = np.ones(len(y))
    for _ in range(iters):
        gl = peak_limiter_gain(y * (g[:, None] if y.ndim == 2 else g), ceil_lin, la_ms, rel_ms)
        g *= gl
        if gl.min() > 0.9995:
            break
    return g


def region_env(act, bridge_s, hold_s, att_s, rel_s, pre_s, corner_s, punch):
    """Speech-region envelope (0..1 at the control rate) with linear ramps.
    Pauses shorter than bridge_s are bridged unless a planned hit sits in the gap with room to recover
    (>= punch_rec_min_s after the speech, >= punch_att_min_s before the next speech).  The attack is
    finished pre_s before the first phoneme; a hit just before the onset delays the attack start to the hit
    (+punch_after_s) - the dip then hides in the hit's decay.  A hit just after a region shortens the release
    so it is finished punch_before_s before the hit.  Returns env, regions [(a, b) s], bridged hit times."""
    d = np.diff(np.concatenate([[0], act.astype(np.int8), [0]]))
    on, off = np.flatnonzero(d == 1) / CR, np.flatnonzero(d == -1) / CR
    regs = [[on[0], off[0]]]
    bridged = []
    for a, b in zip(on[1:], off[1:]):
        g0, g1 = regs[-1][1], a
        ph = [th for th in punch if g0 < th < g1]
        recover = any((th - g0) >= P['punch_rec_min_s'] and (g1 - th) >= P['punch_att_min_s'] for th in ph)
        if (g1 - g0) < bridge_s and not recover:
            regs[-1][1] = b
            bridged += ph
        else:
            regs.append([a, b])
    t = (np.arange(NC) + 0.5) / CR
    env = np.zeros(NC)
    for a, b in regs:
        full = a - pre_s
        r0 = full - att_s
        for th in punch:
            if r0 - 0.05 < th < a:
                r0 = max(r0, th + P['punch_after_s'])
        r0 = min(r0, full - 0.12)
        rs, re_ = b + hold_s, b + hold_s + rel_s
        for th in punch:
            if b < th < re_ + P['punch_before_s']:
                re_ = min(re_, th - P['punch_before_s'])
                rs = min(rs, re_ - 0.25)
        rs = max(rs, b + 0.02)
        re_ = max(re_, rs + 0.12)
        env = np.maximum(env, trap(t, r0, full - r0, rs, re_ - rs))
    w = max(1, int(corner_s * CR))
    env = uniform_filter1d(uniform_filter1d(env, w, mode='nearest'), w, mode='nearest')
    return env, [tuple(r) for r in regs], bridged


# =============================================================================== VO edit / phrases
def voiced_runs(x, sr, thr_db, min_pause):
    """5 ms frames: (first, last+1) voiced sample and interior silent runs >= min_pause, in samples."""
    h = int(0.005 * sr)
    n = len(x) // h
    e = 10 * np.log10((x[:n * h].reshape(n, h) ** 2).mean(1) + 1e-14)
    v = e > np.percentile(e, 95) + thr_db
    vi = np.flatnonzero(v)
    first, last = int(vi[0]), int(vi[-1])
    runs = []
    i = first
    while i <= last:
        if not v[i]:
            j = i
            while not v[j]:
                j += 1
            if (j - i) * h / sr >= min_pause:
                runs.append((i * h, j * h))
            i = j
        else:
            i += 1
    return (first * h, (last + 1) * h), runs


def tighten_take(x, sr, t0, end_by):
    """Shorten the take's internal pauses, latest pause first (so the start of the line and its early words keep
    their timing), never below keep_long / keep_short, until its last voiced frame ends by end_by (absolute s).
    Cuts are made in the middle of each silent run with an 8 ms crossfade, so no speech sample is altered."""
    (f0, f1), runs = voiced_runs(x, sr, P['tighten_thr_db'], P['tighten_min_pause'])
    need = t0 + f1 / sr - end_by
    log_ = dict(end_before=t0 + f1 / sr, cuts=[])
    if need <= 0:
        log_['end_after'] = log_['end_before']
        return x, log_
    xf = int(P['tighten_xfade_ms'] * sr / 1000)
    y = x.copy()
    for a, b in sorted(runs, reverse=True):
        if need <= 1e-4:
            break
        dur = (b - a) / sr
        keep = P['tighten_keep_long'] if dur >= 0.2 else P['tighten_keep_short']
        cut = min(max(0.0, dur - keep), need)
        r = int(round(cut * sr))
        if r <= 0:
            continue
        c0 = a + (b - a - r - xf) // 2
        fo = np.cos(np.linspace(0, np.pi / 2, xf)) ** 2
        mid = y[c0:c0 + xf] * fo + y[c0 + r:c0 + r + xf] * (1 - fo)
        y = np.concatenate([y[:c0], mid, y[c0 + r + xf:]])
        log_['cuts'].append((t0 + a / sr, dur, dur - r / sr))
        need -= r / sr
    log_['cuts'].sort()
    log_['end_after'] = log_['end_before'] - (len(x) - len(y)) / sr
    return y, log_


def phrases_of(x, sr, t0, text):
    """Phrases = voiced spans between pauses >= phrase_pause_s; labelled with the text split at punctuation
    when the counts agree.  Returns [dict(label, a, b)] with absolute times."""
    (f0, f1), runs = voiced_runs(x, sr, P['tighten_thr_db'], P['phrase_pause_s'])
    edges = [f0] + [v for r in runs for v in r] + [f1]
    spans = [(edges[2 * k], edges[2 * k + 1]) for k in range(len(edges) // 2)]
    labels = [s.strip() for s in re.split(r'[.,?!;:]+', text) if s.strip()]
    if len(labels) != len(spans):
        labels = [f'phrase {k + 1}' for k in range(len(spans))]
    return [dict(label=lab, a=t0 + a / sr, b=t0 + b / sr) for lab, (a, b) in zip(labels, spans)]


def line_loudness_mono(x, dual=False):
    """BS.1770 gated loudness of a mono line (dual=True -> as centred dual-mono stereo, +3.01 dB)."""
    return integrated(kpow(x) * (2.0 if dual else 1.0))


# =============================================================================== VO chain
def vo_chain(lines, tl):
    st = [dict(id=v['id'], t=v['t'], text=v['text']) for v in tl['vo']]
    hpf = signal.butter(P['hpf_order'], P['hpf_hz'], 'highpass', fs=SR, output='sos')
    eq = np.vstack([peaking_sos(*e) for e in P['vo_eq']])
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

    # ---------------- air: SSB copy of the 5.5-11 kHz band shifted up 5.5 kHz (the 24 kHz takes stop at ~11 kHz)
    abp = bp_sos(*P['air_band'], order=4)
    ahp = signal.butter(4, P['air_hpf'], 'highpass', fs=SR, output='sos')
    alp = signal.butter(1, P['air_lpf'], 'lowpass', fs=SR, output='sos')
    for i, x in enumerate(out):
        b = signal.sosfiltfilt(abp, x)
        n = len(b)
        an = signal.hilbert(b, N=sp_fft.next_fast_len(n))[:n]
        sh = np.real(an * np.exp(2j * np.pi * P['air_shift_hz'] * np.arange(n) / SR))
        sh = signal.sosfilt(alp, signal.sosfilt(ahp, sh)) * 10 ** (P['air_db'] / 20)
        st[i]['air_rel_db'] = 10 * math.log10(float((sh ** 2).sum()) / float((x ** 2).sum()))
        out[i] = x + sh

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


IR = None


def schroeder_rt(ir):
    e = (ir ** 2).sum(axis=1)
    edc = np.cumsum(e[::-1])[::-1]
    edc = db(edc / edc[0])
    i5 = np.argmax(edc <= -5)
    i25 = np.argmax(edc <= -25)
    return 3.0 * (i25 - i5) / SR


def reverb(dry):
    global IR
    if IR is None:
        IR = make_ir()
    ir = IR
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
    for a in sys.argv[1:]:                        # --set=key=value (JSON value) for experiments
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
    t_c = (np.arange(NC) + 0.5) / CR

    # ------------------------------------------------------------------ VO: edit, chain, phrases, rides
    lines24, edits, phr = [], {}, []
    for v in vo:
        x, sr = sf.read(ROOT / f"audio-src/vo/take_george/{v['id']}.wav", dtype='float64')
        assert sr == 24000, (v['id'], sr)
        x = x if x.ndim == 1 else x.mean(axis=1)
        if v['id'] in P['vo_tighten']:
            x, edits[v['id']] = tighten_take(x, sr, v['t'], P['vo_tighten'][v['id']])
        lines24.append(x)
        phr.append(phrases_of(x, sr, v['t'], v['text']))
    proc, vst, vmeta = vo_chain(lines24, tl)
    nl = len(vo)
    starts = [int(round(v['t'] * SR)) for v in vo]
    for i, v in enumerate(vo):
        vst[i]['start'] = v['t']
        vst[i]['end'] = v['t'] + len(lines24[i]) / 24000
        vst[i]['dur'] = len(lines24[i]) / 24000
        vst[i]['phrases'] = phr[i]
    log('VO chain done', {k: round(v, 2) for k, v in vmeta.items()}, 'edits', edits)

    rides = []                                      # per-line gain curve (linear, at 48 k, length of proc[i])
    for i, x in enumerate(proc):
        g = np.zeros(len(x))
        spec = P['vo_rides'].get(vo[i]['id'], [])
        ph = phr[i]
        done = []
        for lab, gdb_ in spec:
            k = next((j for j, p in enumerate(ph) if p['label'].lower().startswith(lab.lower())), None)
            if k is None:
                log('WARN ride phrase not found', vo[i]['id'], lab)
                continue
            a = ph[k]['a'] - vo[i]['t']
            b = ph[k]['b'] - vo[i]['t']
            a0 = (ph[k - 1]['b'] - vo[i]['t'] + a) / 2 if k > 0 else 0.0              # ramps centred in the pauses
            b0 = (ph[k + 1]['a'] - vo[i]['t'] + b) / 2 if k + 1 < len(ph) else len(x) / SR
            tt = np.arange(len(x)) / SR
            rr = P['ride_ramp_s']
            g = np.maximum(g, gdb_ * trap(tt, a0 - rr / 2, rr if k > 0 else 1e-6, b0 - rr / 2, rr if k + 1 < len(ph) else 1e-6))
            done.append((ph[k]['label'], gdb_, ph[k]['a'], ph[k]['b']))
        r = 10 ** (g / 20)
        lift = line_loudness_mono(x * r, dual=True) - line_loudness_mono(x, dual=True)
        vst[i]['rides'] = done
        vst[i]['ride_lift'] = lift
        vst[i]['vob_cap'] = max(0.0, P['vo_lift_max_db'] - lift)
        rides.append(r)

    def place(gains_db):
        bus = np.zeros(N)
        for i, x in enumerate(proc):
            n = min(len(x), N - starts[i])
            bus[starts[i]:starts[i] + n] += (x * rides[i])[:n] * 10 ** (gains_db[i] / 20)
        return bus

    def vo_bus_from(gains, g_est):
        """dry bus -> true-peak VO limiter (ceiling 3 dB under the master's, referred to the master gain) -> reverb."""
        dry = place(gains)
        ceil_vo = 10 ** ((P['tp_ceiling_db'] + P['vo_tp_rel_db']) / 20) / g_est
        g_vo = limit(dry[:, None], ceil_vo, P['vo_lim_la_ms'], P['vo_lim_rel_ms'])
        dry = dry * g_vo
        wet, rinfo = reverb(dry)
        return dry[:, None] * np.ones((1, 2)) + wet, g_vo, rinfo

    # ------------------------------------------------------------------ key (speech activity) -> duck / pocket envelopes
    dry0 = place([0.0] * nl)
    Lk = rms_db_ctrl(dry0, P['key_rms_ms'])
    Lv = float(np.median(Lk[Lk > -60]))
    k_raw = np.clip((Lk - (Lv + P['key_lo_rel'])) / (P['key_hi_rel'] - P['key_lo_rel']), 0.0, 1.0)
    act = k_raw > 0.5
    del dry0
    punch = sorted(P['punch_times'])
    S, duck_regs, bridged = region_env(act, P['duck_bridge_s'], P['duck_hold_s'], P['duck_att_s'], P['duck_rel_s'],
                                       P['duck_pre_s'], P['duck_corner_s'], punch)
    Q, pocket_regs, _ = region_env(act, P['pocket_bridge_s'], P['pocket_hold_s'], P['pocket_att_s'], P['pocket_rel_s'],
                                   P['duck_pre_s'], P['duck_corner_s'], punch)
    pt0, pt1, ptr = P['punch_through']
    PT = np.zeros(NC)
    for th in bridged:
        PT = np.maximum(PT, trap(t_c, th - pt0, pt0, th + pt1, ptr))
    log('duck regions', len(duck_regs), 'bridged hits', bridged, 'pocket regions', len(pocket_regs))

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
    music_raw = (pitched + perc).astype(np.float32)          # for the report (no processing)
    shelf = highshelf_sos(*P['music_air'])
    pitched = signal.sosfilt(shelf, pitched, axis=0)
    perc = signal.sosfilt(shelf, perc, axis=0)

    # ------------------------------------------------------------------ SFX + phone-translation layers on the big hits
    sfx_raw, sr = sf.read(ROOT / 'assets/audio/sfx/sfx_track.wav', dtype='float64')
    assert sr == SR and sfx_raw.shape == (N, 2)
    cues = json.loads((ROOT / 'assets/audio/sfx/sfx_cues.json').read_text())
    oneshots = json.loads((ROOT / 'assets/audio/sfx/oneshots/index.json').read_text())
    body_sos = bp_sos(*P['hit_body_band'], order=2)
    crack_sos = signal.butter(4, P['hit_crack_hpf'], 'highpass', fs=SR, output='sos')
    vb_lp = signal.butter(4, P['vbass_src_hz'], 'lowpass', fs=SR, output='sos')
    vb_bp = bp_sos(*P['vbass_band'], order=2)
    sfx_net_hit_db = P['sfx_fader_db'] + P['ride_sfx_db']
    layer_log = []
    for k, th in enumerate(BIG_HITS):
        i0, i1 = int(th * SR), int((th + 0.4) * SR)
        ref = kpow(pitched[i0:i1] + perc[i0:i1]).mean()            # the score's hit, K-weighted 400 ms (pre-master)
        xg = 10 ** (P['hit_layer_extra_db'].get(f'{th:.1f}', 0.0) / 20)
        # virtual bass: harmonics of the hit's own sub (score drums/fx_hits + SFX impact), 110-700 Hz -> the boom reads on phones
        a, b = int((th - 0.02) * SR), min(N, int((th + 1.2) * SR))
        src = signal.sosfiltfilt(vb_lp, perc[a:b] + sfx_raw[a:b], axis=0)
        u = src / (np.abs(src).max() + 1e-12)
        d = P['vbass_drive']
        h = np.tanh(d * u) / math.tanh(d) + P['vbass_even'] * np.abs(u)
        h = signal.sosfiltfilt(vb_bp, h, axis=0)
        h *= trap(np.arange(b - a) / SR - 0.02, -0.002, 0.002, P['vbass_hold_s'], P['vbass_rel_s'])[:, None]
        lev = kpow(h[int(0.02 * SR):int(0.42 * SR)]).mean()
        h *= math.sqrt(ref / lev) * 10 ** ((P['vbass_rel_db'] - sfx_net_hit_db) / 20)
        sfx_raw[a:b] += h * xg
        # tone: a low-crest 'drum body' (A3 -> D3 pitch drop, partials 1-4, ~0.2 s decay) - the boom's body in the band a
        # phone speaker can play, in the film's key
        tt = np.arange(int(P['tone_len_s'] * SR)) / SR
        f = P['tone_f1'] + (P['tone_f0'] - P['tone_f1']) * np.exp(-tt / P['tone_glide_s'])
        ph_ = 2 * np.pi * np.cumsum(f) / SR
        tone = sum(10 ** (gp / 20) * np.sin((k + 1) * ph_) for k, gp in enumerate(P['tone_partials_db']))
        tone *= np.minimum(1.0, tt / 0.003) * np.exp(-tt / P['tone_decay_s']) * np.clip((P['tone_len_s'] - tt) / 0.05, 0, 1)
        tone = np.stack([tone, tone], axis=1)
        lev = kpow(tone[:int(0.4 * SR)]).mean()
        tone *= math.sqrt(ref / lev) * 10 ** ((P['tone_rel_db'] - sfx_net_hit_db) / 20) * xg
        a0 = int(round(th * SR))
        n = min(len(tone), N - a0)
        sfx_raw[a0:a0 + n] += tone[:n]
        # body: the hit's own impact one-shot band-passed 150-500 Hz (parallel EQ boost of its knock)
        imp = next(c for c in cues if c['type'] == 'impact' and abs(c['accent'] - th) < 1e-6)
        one, _ = sf.read(ROOT / 'assets/audio/sfx' / oneshots[imp['variant']]['file'], dtype='float64')
        body = signal.sosfiltfilt(body_sos, one, axis=0) * imp.get('vel', 1.0) * 10 ** ((imp.get('gain_db', 0.0) + P['hit_body_db']) / 20)
        a = imp['start_sample']
        n = min(len(body), N - a)
        sfx_raw[a:a + n] += body[:n] * xg
        # ring: the brand's anvil one-shot (587 Hz + upper partials, T60 1.5 s), high-passed at 400 Hz with a 2 ms soft
        # attack (no click peak) - sustained mid energy that reads on a phone; 96 s gets one too (it has no anvil cue)
        anv = next((c for c in cues if c['type'] == 'anvil' and abs(c['accent'] - th) < 1e-6), None)
        av = anv['variant'] if anv else 'anvil_2'
        one, _ = sf.read(ROOT / 'assets/audio/sfx' / oneshots[av]['file'], dtype='float64')
        one = signal.sosfiltfilt(signal.butter(2, P['hit_anvil_hpf'], 'highpass', fs=SR, output='sos'), one, axis=0)
        one *= trap(np.arange(len(one)) / SR, 0.0, 0.002, P['hit_anvil_hold_s'], P['hit_anvil_rel_s'])[:, None]   # out before the next VO line
        a = int(round(th * SR)) - int(round(oneshots[av]['anchor_s'] * SR))
        n = min(len(one), N - a)
        sfx_raw[a:a + n] += one[:n] * 10 ** (P['hit_anvil_db'] / 20) * xg
        # crack: a montage 'hit' one-shot (880 Hz knock, 3.3 kHz ping, 4.2 kHz click) high-passed at 700 Hz
        hv = f'hit_{k + 1}'
        one, _ = sf.read(ROOT / 'assets/audio/sfx' / oneshots[hv]['file'], dtype='float64')
        crack = signal.sosfiltfilt(crack_sos, one, axis=0) * 10 ** (P['hit_crack_db'] / 20)
        a = int(round(th * SR)) - int(round(oneshots[hv]['anchor_s'] * SR))
        n = min(len(crack), N - a)
        sfx_raw[a:a + n] += crack[:n] * xg
        layer_log.append((th, imp['variant'], hv, av))

    # ------------------------------------------------------------------ sub trim on the hits (time-varying low shelf)
    lp_sub = signal.butter(4, P['hit_sub_hz'], 'lowpass', fs=SR, output='sos')
    for th in BIG_HITS:
        a, b = int((th - 1.0) * SR), min(N, int((th + 2.0) * SR))
        tt = np.arange(a, b) / SR
        w = trap(tt, th - P['hit_sub_pre_s'], 0.005, th + P['hit_sub_hold_s'], P['hit_sub_rel_s'])
        g = 1.0 - 10 ** (P['hit_sub_db'] * w / 20)
        for arr in (pitched, perc, sfx_raw):
            arr[a:b] -= g[:, None] * signal.sosfiltfilt(lp_sub, arr[a:b], axis=0)

    split = bp_sos(*P['dip_band'], order=2)               # zero-phase |H|^2 -> rest = x - band is exact
    pit_band = signal.sosfiltfilt(split, pitched, axis=0)
    pit_rest = pitched - pit_band
    del pitched
    perc_band = signal.sosfiltfilt(split, perc, axis=0)
    perc_rest = perc - perc_band
    log('music buses ready')

    # ------------------------------------------------------------------ static automation (dB per component, control rate)
    protect_mask = np.zeros(NC)
    for c in cues:
        tail = P['sfx_protect_types'].get(c['type'], 'x')
        if tail == 'x':
            continue
        t_start = c['start_sample'] / SR - 0.010
        dur = oneshots[c['variant']]['duration_s']
        t_end = min(c['start_sample'] / SR + dur, c['accent'] + (tail if tail is not None else 0.0))
        protect_mask[max(0, int(t_start * CR)):min(NC, int(t_end * CR) + 1)] = 1.0
    protect_mask = np.clip(uniform_filter1d(maximum_filter1d(protect_mask, 21), 21), 0, 1)
    AUTO = np.zeros((5, NC))
    AUTO[4] += P['sfx_fader_db']
    trim_mus = np.zeros(NC)
    for t0_, rin, t1_, rout, gdb_ in P['music_trims']:
        trim_mus += gdb_ * trap(t_c, t0_, rin, t1_, rout)
    suck_db = np.zeros(NC)
    for th, d in P['suck']:
        s0 = th - P['suck_start_s']
        suck_db = np.minimum(suck_db, -d * trap(t_c, s0, P['suck_ramp_s'], th - P['suck_snap_s'], P['suck_snap_s'] * 0.999))
    ride = np.zeros(NC)
    for th in BIG_HITS:
        ride = np.maximum(ride, trap(t_c, th - P['suck_snap_s'], P['suck_snap_s'], th + P['ride_hold_s'], P['ride_out_s']))
    for j in range(4):
        AUTO[j] += trim_mus + suck_db + (P['ride_pitched_db'] if j < 2 else P['ride_perc_db']) * ride
    sfx_trim = np.zeros(NC)
    for t0_, rin, t1_, rout, gdb_ in P['sfx_trims']:
        sfx_trim += gdb_ * trap(t_c, t0_, rin, t1_, rout)
    AUTO[4] += sfx_trim + P['ride_sfx_db'] * ride
    PROT = np.zeros((5, NC))

    def gains_db(kn, cidx):
        """Component gains (dB) at control indices cidx for knob values kn (scalars or arrays shaped like cidx)."""
        Sv, Qv, pt = S[cidx], Q[cidx], 1.0 - PT[cidx]
        g = np.stack([
            -kn['b'] * Sv,                                                    # pitched, outside 1-4 kHz
            -(kn['b'] + kn['band']) * Sv - kn['pocket'] * Qv,                 # pitched, 1-4 kHz (+ slow pocket)
            -kn['perc'] * Sv * pt,                                            # drums/fx_hits, outside 1-4 kHz
            -(kn['perc'] + kn['pband']) * Sv * pt,                            # drums/fx_hits, 1-4 kHz
            -kn['sfx'] * Sv * (1.0 - protect_mask[cidx]) * pt,                # SFX (impacts exempt near their accent)
        ])
        return g + AUTO[:, cidx] + PROT[:, cidx]

    # ------------------------------------------------------------------ measurement prep (per-frame cross energies, 20 ms)
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
    t_f = (np.arange(NF) + 0.5) * FR
    log('measurement matrices ready')

    # accent candidates: SFX accents + strong drums/fx_hits onsets (10 ms K-weighted frames)
    acc = [(c['accent'], 'sfx:' + c['type']) for c in cues if c['type'] in P['protect_sfx_types']]
    pk = kpow(perc_rest + perc_band)
    nfr = len(pk) // 480
    Lp = db(pk[:nfr * 480].reshape(nfr, 480).mean(axis=1))
    padl = np.concatenate([np.full(8, -200.0), Lp])
    prevmax = np.max(np.stack([padl[k:k + nfr] for k in range(6)]), axis=0)      # max of Lp[n-8 .. n-3]
    med = median_filter(Lp, 101)
    on = np.flatnonzero((Lp - prevmax > P['accent_rise_db']) & (Lp > med + P['accent_over_med_db']))
    last = -10
    for i in on:
        if i - last > 5:
            acc.append((i * 0.01, 'music'))
        last = i
    acc.sort()
    events = []
    for t_, src in acc:
        if events and t_ - events[-1]['t'] < 0.06:
            events[-1]['src'].add(src)
        else:
            events.append(dict(t=t_, src={src}))
    del pk

    def frame_lin(gdb_):            # (5, frames, CPF) dB -> (frames, 5) frame-mean linear gain
        return (10 ** (gdb_ / 20)).mean(axis=2).T

    def bg_frames(g, fr):
        return np.einsum('fi,fij,fj->f', g, C_band[fr], g), np.einsum('fi,fij,fj->f', g, C_kw[fr], g)

    # master helpers
    fade = np.ones(N)
    nz = int(P['tail_zero_s'] * SR)
    nfade = int(P['fade_s'] * SR) - nz
    fade[N - nz - nfade:N - nz] = np.cos(np.linspace(0, np.pi / 2, nfade)) ** 2
    fade[N - nz:] = 0.0
    ceil = 10 ** (P['tp_ceiling_db'] / 20)
    dc_sos = signal.butter(2, P['dc_hpf_hz'], 'highpass', fs=SR, output='sos')
    goal = P['ratio_target_db'] + P['ratio_margin_db']
    s_lo, s_hi = -1.0, float(len(LADDER) - 1)
    g_est = 10 ** (P['master_gain_guess_db'] / 20)
    wf = np.ones(NF)       # per-frame weight = mean G^2 of the master gain path (pass 2 measures "as heard")
    vo_active_audio = None
    for pass_ in range(P['passes']):
        # -------------------------------------------------------------- VO frames for the solver (rides + limiter, no lift)
        vo_meas, _, _ = vo_bus_from([0.0] * nl, g_est)
        vo_band_f = (signal.sosfiltfilt(sb, vo_meas, axis=0)[:NF * FH] ** 2).sum(axis=1).reshape(NF, FH).sum(axis=1)
        vo_kw_f = kpow(vo_meas)[:NF * FH].reshape(NF, FH).sum(axis=1)
        del vo_meas
        # speech-core frames per line (VO K-weighted within 15 dB of the line's 95th percentile) + 0.5 s windows
        spans_f, core, wins = [], [], []
        speech_core = np.zeros(NF, bool)
        for i, l in enumerate(vst):
            sp = np.where((t_f >= l['start']) & (t_f < l['end']))[0]
            lv = db(vo_kw_f[sp])
            cm = lv > np.percentile(lv, 95) - 15
            speech_core[sp[cm]] = True
            ws = []
            for w0 in np.arange(l['start'], l['end'] - 0.25, 0.25):
                m_ = (t_f[sp] >= w0) & (t_f[sp] < w0 + 0.5) & cm
                if m_.sum() >= P['floor_min_frames']:
                    ws.append(m_)
            spans_f.append(sp)
            core.append(cm)
            wins.append(np.array(ws, dtype=float) if ws else np.zeros((0, len(sp))))

        def line_eval(i, kn):
            sp, cm, W = spans_f[i], core[i], wins[i]
            cidx = sp[:, None] * CPF + np.arange(CPF)[None, :]
            g = frame_lin(gains_db(kn, cidx))
            bgb, bgk = bg_frames(g, sp)
            vb = 10 ** (min(kn['vob'], vst[i]['vob_cap']) / 10)
            w = wf[sp]
            vbf, vkf, bgb, bgk = vb * vo_band_f[sp] * w, vb * vo_kw_f[sp] * w, bgb * w, bgk * w
            rb = 10 * math.log10(vbf[cm].sum() / bgb[cm].sum())
            rk = 10 * math.log10(vkf[cm].sum() / bgk[cm].sum())
            if len(W):
                wb = 10 * np.log10((W @ vbf) / (W @ bgb))
                wk = 10 * np.log10((W @ vkf) / (W @ bgk))
                worst_b, worst_k = float(wb.min()), float(wk.min())
            else:
                worst_b = worst_k = 99.0
            share = np.einsum('fi,fii,fi->i', g[cm], C_band[sp[cm]], g[cm])
            return rb, rk, worst_b, worst_k, share / share.sum()

        ok_line = lambda r: r[0] >= goal and r[2] >= P['floor_band_db'] and r[3] >= P['floor_kw_db']

        # -------------------------------------------------------------- per-line duck solver (minimal effort on the ladder)
        solved = []
        for i in range(nl):
            if not ok_line(line_eval(i, knobs_at(s_hi))):
                s = s_hi
            elif ok_line(line_eval(i, knobs_at(s_lo))):
                s = s_lo
            else:
                a, b = s_lo, s_hi
                for _ in range(30):
                    m = 0.5 * (a + b)
                    if ok_line(line_eval(i, knobs_at(m))):
                        b = m
                    else:
                        a = m
                s = b
            kn = knobs_at(s)
            kn['vob'] = min(kn['vob'], vst[i]['vob_cap'])
            rb, rk, wb, wk, share = line_eval(i, kn)
            r0 = line_eval(i, knobs_at(0.0))[0]
            vst[i].update(effort=s, knobs=kn, r_pred=rb, rk_pred=rk, wb_pred=wb, wk_pred=wk, r_nominal=r0, share=share)
            solved.append(kn)
        log(f'pass {pass_ + 1} solver efforts', [round(v['effort'], 2) for v in vst])
        xs, prof = [], {k: [] for k in KNOBS}
        for i, l in enumerate(vst):
            xs += [l['start'], l['end']]
            for k in KNOBS:
                prof[k] += [solved[i][k], solved[i][k]]
        kprof = {k: np.interp(t_c, xs, prof[k]) for k in KNOBS}

        # -------------------------------------------------------------- accent protect: per-event dip depth (20 ms speech-core frames)
        PROT[:] = 0.0
        nwin = int(round(P['protect_win_s'] / FR))
        pre, att, hold, rel = P['protect_pre_s'], P['protect_att_s'], P['protect_hold_s'], P['protect_rel_s']
        tk, tb = P['protect_target_kw'], P['protect_target_band']

        def dip_shape(tt, t0_, hd):
            return np.minimum(np.clip((tt - (t0_ - pre - att)) / att, 0, 1),
                              np.where(tt <= t0_ + hd, 1.0,
                                       np.where(tt >= t0_ + hd + rel, 0.0,
                                                0.5 + 0.5 * np.cos(np.pi * (tt - t0_ - hd) / rel))))

        for ev in events:
            ev.update(depth=0.0, line=None, pred=None, note='')
            li = next((i for i, l in enumerate(vst) if l['start'] - 0.05 <= ev['t'] <= l['end'] + 0.05), None)
            if li is None:
                continue
            ev['line'] = vst[li]['id']
            f0 = int(ev['t'] / FR + 1e-6)
            tail = vst[li]['end'] - ev['t']                 # an accent near the end of a line holds until the line ends
            ev['hold'] = min(P['protect_tail_max_s'], tail) if hold < tail < P['protect_tail_max_s'] + 0.1 else hold
            fr = np.arange(f0, min(NF, f0 + max(nwin, int(math.ceil((ev['hold'] + 0.1) / FR)))))
            fr = fr[speech_core[fr]]
            ev['n_fr'] = len(fr)
            if len(fr) == 0:
                ev['note'] = 'pause'
                continue
            cidx = fr[:, None] * CPF + np.arange(CPF)[None, :]
            kk = {k: kprof[k][cidx] for k in KNOBS}
            base = gains_db(kk, cidx)
            wv = dip_shape((cidx + 0.5) / CR, ev['t'], ev['hold'])
            vb = 10 ** (vst[li]['knobs']['vob'] / 10)
            w = wf[fr]

            def margins(d):
                gd = base.copy()
                gd[2:5] -= d * wv
                gd[1] -= min(P['protect_pitched_frac'] * d, P['protect_pitched_max_db']) * wv
                bgb, bgk = bg_frames(frame_lin(gd), fr)
                return (10 * math.log10(vb * (w * vo_kw_f[fr]).sum() / (w * bgk).sum()),
                        10 * math.log10(vb * (w * vo_band_f[fr]).sum() / (w * bgb).sum()))

            deficit = lambda m: max(0.0, tk - m[0]) + max(0.0, tb - m[1])
            m0 = margins(0.0)
            ev['pre'] = m0
            if deficit(m0) <= 0:
                ev['pred'] = m0
                continue
            mx = margins(P['protect_max_db'])
            if deficit(m0) - deficit(mx) < P['protect_min_gain_db']:
                ev['pred'] = m0
                ev['note'] = 'masker not drums/SFX'
                continue
            target_def = 0.0 if deficit(mx) <= 0 else deficit(mx) + P['protect_slack_db']
            a, b = 0.0, P['protect_max_db']
            for _ in range(24):
                m = 0.5 * (a + b)
                if deficit(margins(m)) <= target_def:
                    b = m
                else:
                    a = m
            ev['depth'] = b
            ev['pred'] = margins(b)
            c0 = max(0, int((ev['t'] - pre - att) * CR) - 1)
            c1 = min(NC, int((ev['t'] + ev['hold'] + rel) * CR) + 2)
            wv_ = dip_shape((np.arange(c0, c1) + 0.5) / CR, ev['t'], ev['hold'])
            PROT[2:5, c0:c1] = np.minimum(PROT[2:5, c0:c1], -b * wv_)
            PROT[1, c0:c1] = np.minimum(PROT[1, c0:c1], -min(P['protect_pitched_frac'] * b, P['protect_pitched_max_db']) * wv_)
        n_dip = sum(1 for e in events if e['depth'] > 0.05)
        log(f'pass {pass_ + 1} protect: {n_dip} dips, max {max([e["depth"] for e in events] + [0]):.1f} dB')

        # -------------------------------------------------------------- apply
        gdb = gains_db(kprof, np.arange(NC))
        vob = [solved[i]['vob'] for i in range(nl)]
        vo_bus, g_vo, rinfo = vo_bus_from(vob, g_est)
        ga = [10 ** (ctrl_to_audio(gdb[j], N) / 20)[:, None] for j in range(5)]
        music_d = pit_rest * ga[0] + pit_band * ga[1] + perc_rest * ga[2] + perc_band * ga[3]
        sfx_d = sfx_raw * ga[4]
        del ga
        vo_bus = signal.sosfiltfilt(dc_sos, vo_bus, axis=0)        # 12 Hz zero-phase subsonic / DC filter per bus
        music_d = signal.sosfiltfilt(dc_sos, music_d, axis=0)      # (linear, so the stems still sum to the mix)
        sfx_d = signal.sosfiltfilt(dc_sos, sfx_d, axis=0)
        # SFX bus transient limiter (gain-only, so the stems still sum): the stacked hit transients (impact crack + layers)
        # are shaved here, 4 dB under the master ceiling, instead of making the master limiter duck the whole mix at the hits
        g_sfx = limit(sfx_d, 10 ** ((P['tp_ceiling_db'] + P['sfx_tp_rel_db']) / 20) / g_est, P['sfx_lim_la_ms'], P['sfx_lim_rel_ms'])
        sfx_d *= g_sfx[:, None]
        mix = vo_bus + music_d + sfx_d

        # -------------------------------------------------------------- master: glue -> gain -> TP limiter -> fade
        Lg = rms_db_ctrl(mix, P['glue_rms_ms'])
        actg = Lg > -50
        T_g = calibrate_threshold(Lg[actg], P['glue_ratio'], P['glue_knee_db'],
                                  lambda gr: np.percentile(gr, 99), P['glue_p99_gr_db'])
        gr_g = ar_smooth(static_gr(Lg, T_g, P['glue_ratio'], P['glue_knee_db']), CR,
                         P['glue_att_ms'] / 1000, P['glue_rel_ms'] / 1000)
        g_glue = 10 ** (-ctrl_to_audio(gr_g, N) / 20)
        y0 = mix * g_glue[:, None]
        del mix
        gain_db = P['target_lufs'] - integrated(kpow(y0))
        for it in range(6):
            y = y0 * 10 ** (gain_db / 20)
            g_lim = limit(y, ceil, P['lim_la_ms'], P['lim_rel_ms'])
            z = y * (g_lim * fade)[:, None]
            I = integrated(kpow(z))
            if abs(I - P['target_lufs']) < 0.02:
                break
            gain_db += P['target_lufs'] - I
        del y, y0
        G = g_glue * 10 ** (gain_db / 20) * g_lim * fade
        log(f'pass {pass_ + 1} master: glue T {T_g:.1f} dB, gain {gain_db:+.2f} dB, I {I:.2f} LUFS')
        wf = (G[:NF * FH] ** 2).reshape(NF, FH).mean(axis=1)
        if vo_active_audio is None:
            vo_active_audio = np.zeros(N, bool)
            for l in vst:
                vo_active_audio[int(l['start'] * SR):int(l['end'] * SR)] = True
        g_est = float(np.median((g_glue * 10 ** (gain_db / 20))[vo_active_audio]))
    log('VO reverb', {k: round(v, 3) for k, v in rinfo.items()})
    del pit_rest, pit_band, perc_rest, perc_band, comps, C_band, C_kw

    # ------------------------------------------------------------------ write (TPDF dither, 24-bit)
    q = 2.0 ** 23
    rng = np.random.default_rng(7)
    dither = (rng.random((N, 2)) - rng.random((N, 2))) / q * fade[:, None]
    final = np.clip(np.round((z + dither) * q), -q, q - 1) / q
    sf.write(out_dir / 'final_mix.wav', final, SR, subtype='PCM_24')
    stems_out = {'vo': vo_bus * G[:, None], 'music_ducked': music_d * G[:, None], 'sfx': sfx_d * G[:, None]}
    stem_fmt = {}
    for k, s in stems_out.items():
        pk_ = float(np.abs(s).max())
        if pk_ < 1.0:
            sq = np.clip(np.round(s * q), -q, q - 1) / q
            sf.write(stem_dir / f'{k}.wav', sq, SR, subtype='PCM_24')
            stem_fmt[k] = 'PCM_24'
        else:
            sf.write(stem_dir / f'{k}.wav', s.astype(np.float32), SR, subtype='FLOAT')
            with open(stem_dir / f'{k}.wav', 'r+b') as fh:      # zero libsndfile's PEAK-chunk timestamp -> byte-identical re-runs
                head = fh.read(4096)
                p_ = head.find(b'PEAK')
                if p_ >= 0:
                    fh.seek(p_ + 12)
                    fh.write(b'\0\0\0\0')
            stem_fmt[k] = 'FLOAT (peaks above 0 dBFS on its own)'
    log('written')
    del z, stems_out, final, dither, vo_bus, music_d, sfx_d

    ctx = dict(tl=tl, vst=vst, vmeta=vmeta, rinfo=rinfo, edits=edits, events=events, gdb=gdb, AUTO=AUTO, PROT=PROT,
               S=S, Q=Q, PT=PT, duck_regs=duck_regs, bridged=bridged, kprof=kprof, gr_g=gr_g, T_g=T_g, g_lim=g_lim,
               g_vo=g_vo, g_sfx=g_sfx, gain_db=gain_db, G=G, music_raw=music_raw, stem_fmt=stem_fmt, layer_log=layer_log,
               k_raw=k_raw, no_png=no_png)
    verify(ctx)


# =============================================================================== verification
def fr_energy(x, h):
    n = len(x) // h
    e = (x[:n * h] ** 2)
    e = e.sum(axis=1) if e.ndim == 2 else e
    return e.reshape(n, h).sum(axis=1)


def third_oct(x):
    m = x.mean(axis=1) if x.ndim == 2 else x
    f, p = signal.welch(m, SR, nperseg=16384, noverlap=8192, window='hann')
    fc = 1000 * 2 ** (np.arange(-17, 14) / 3)
    out = []
    for c in fc:
        k = (f >= c / 2 ** (1 / 6)) & (f < c * 2 ** (1 / 6))
        out.append(10 * np.log10(p[k].sum() * (f[1] - f[0]) + 1e-30))
    return fc, np.array(out)


def nms(Ld, te, excl, k):
    Ld = Ld.copy()
    out = []
    for _ in range(k):
        i = int(np.argmax(Ld))
        out.append((float(te[i]), float(Ld[i])))
        Ld[(te > te[i] - excl) & (te < te[i] + excl)] = -200
    return out


def verify(ctx):
    out_dir = ROOT / 'assets/audio'
    stem_dir = out_dir / 'final_stems'
    vst, events, gdb, tl = ctx['vst'], ctx['events'], ctx['gdb'], ctx['tl']
    G, g_lim, gr_g = ctx['G'], ctx['g_lim'], ctx['gr_g']
    fin, sr = sf.read(out_dir / 'final_mix.wav', dtype='float64')
    vo_s, _ = sf.read(stem_dir / 'vo.wav', dtype='float64')
    mu_s, _ = sf.read(stem_dir / 'music_ducked.wav', dtype='float64')
    sx_s, _ = sf.read(stem_dir / 'sfx.wav', dtype='float64')
    bg_s = mu_s + sx_s
    rep = []
    o = rep.append
    q = 2.0 ** 23

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
    tail_zero = int(np.argmax(np.any(fin[::-1] != 0, axis=1)))
    stem_sum_err = a2db(np.sqrt(np.mean((vo_s + mu_s + sx_s - fin) ** 2)))
    lim_gr_db = -a2db(g_lim)
    lim_ctrl = lim_gr_db[:NC * HOP].reshape(NC, HOP).max(axis=1)

    o('=' * 110)
    o('ALBION JOURNAL - FINAL MIX - VERIFICATION REPORT')
    o('generated by audio-src/mix/build_mix.py (deterministic; driven by timeline/timeline.json)')
    o('=' * 110)
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
    o(f'  glue comp         : 2:1, knee 6 dB, 30/200 ms, threshold {ctx["T_g"]:.1f} dBFS-RMS; GR max {gr_g.max():.2f} dB,'
      f' mean (where >0.1 dB) {gr_g[gr_g > 0.1].mean():.2f} dB, time >1 dB {np.mean(gr_g > 1) * DUR:.1f} s')
    o(f'  master gain       : {ctx["gain_db"]:+.2f} dB (after glue) to land on {P["target_lufs"]} LUFS')
    dc = fin.mean(axis=0)
    lr = [integrated(kpow(fin[:, c])) for c in range(2)]
    corr = float(np.corrcoef(fin[:, 0], fin[:, 1])[0, 1])
    mono = integrated(kpow(fin.mean(axis=1)) * 2.0)
    o(f'  DC / balance      : DC L {dc[0]:+.1e}, R {dc[1]:+.1e}; L {lr[0]:.2f} / R {lr[1]:.2f} LUFS (diff {lr[0] - lr[1]:+.2f} LU);'
      f' L/R correlation {corr:.2f}; mono fold-down {mono - I_fin:+.2f} LU')

    # master limiter events (GR > 0.5 dB) and TP-near-ceiling events, classified
    hit_times = sorted({e['t'] for e in tl['events'] if e['type'] in ('impact', 'hit', 'stamp', 'anvil')})

    def classify(t_):
        for th in BIG_HITS:
            if th - 0.35 <= t_ <= (th + 0.6 if th < 116 else DUR):
                return 'big hit'
        for th in hit_times:
            if th - 0.05 <= t_ <= th + 0.6:
                return 'hit/impact/stamp'
        for l in vst:
            if l['start'] <= t_ <= l['end']:
                return 'VO line ' + l['id']
        return 'other'

    def segments(mask, val, gap):
        idx = np.flatnonzero(mask)
        segs = []
        for i in idx:
            if segs and i - segs[-1][1] <= gap:
                segs[-1][1] = i
                if val[i] > segs[-1][3]:
                    segs[-1][2], segs[-1][3] = i, val[i]
            else:
                segs.append([i, i, i, val[i]])
        return segs

    lim_ev = segments(lim_ctrl > 0.5, lim_ctrl, 30)
    lim_cls = [(s[2] / CR, s[3], classify(s[2] / CR)) for s in lim_ev]
    tpe = tp_envelope(fin)
    tpe_c = a2db(tpe[:NC * HOP].reshape(NC, HOP).max(axis=1))
    near = segments(tpe_c > P['tp_ceiling_db'] - 0.15, tpe_c, 30)
    near_cls = [(s[2] / CR, s[3], classify(s[2] / CR)) for s in near]
    o(f'  TP limiter        : ceiling {P["tp_ceiling_db"]} dBTP, 4x oversampled detector, {P["lim_la_ms"]:.0f} ms look-ahead ramp,'
      f' {P["lim_rel_ms"]:.0f} ms release; GR max {lim_gr_db.max():.2f} dB, time >1 dB {np.mean(lim_ctrl > 1) * DUR:.2f} s,'
      f' >3 dB {np.mean(lim_ctrl > 3) * DUR:.2f} s')
    o(f'                      events >0.5 dB GR: {len(lim_cls)} -> ' + ', '.join(f'{t_:.2f}s {g_:.1f}dB ({c_})' for t_, g_, c_ in lim_cls))
    nonhit = [e for e in lim_cls if e[2] not in ('big hit', 'hit/impact/stamp')]
    o(f'  [{"OK" if not nonhit else "WARN"}] master limiter only works on hits: {len(nonhit)} of {len(lim_cls)} events >0.5 dB outside hit windows'
      + (': ' + ', '.join(f'{t_:.2f}s {g_:.1f}dB ({c_})' for t_, g_, c_ in nonhit) if nonhit else ''))
    nvo = [e for e in near_cls if e[2].startswith('VO')]
    o(f'  near-ceiling (4x TP within 0.15 dB of {P["tp_ceiling_db"]}): {len(near_cls)} events; inside VO lines (not at a hit): {len(nvo)}'
      + (' -> ' + ', '.join(f'{t_:.2f}s ({c_})' for t_, _, c_ in nvo) if nvo else ''))
    o(f'  stems             : final_stems/vo.wav, music_ducked.wav, sfx.wav ({", ".join(f"{k}={v}" for k, v in ctx["stem_fmt"].items())});'
      f' printed through the master gain path; vo+music_ducked+sfx - final_mix residual RMS {stem_sum_err:.1f} dBFS (dither/quantisation only)')
    for k, s in (('vo', vo_s), ('music_ducked', mu_s), ('sfx', sx_s)):
        o(f'      {k:13s}: integrated {integrated(kpow(s)):6.2f} LUFS, sample peak {a2db(np.abs(s).max()):6.2f} dBFS, true peak {a2db(true_peak_lin(s)):6.2f} dBTP')
    o('')

    # ---------------------------------------------------------------- VO lines
    vmeta, rinfo = ctx['vmeta'], ctx['rinfo']
    o('[2] VOICE-OVER (per line, measured on the final stems = as heard in final_mix)')
    o(f'  chain: 24k->48k resample_poly(Kaiser 10) | HPF {P["hpf_hz"]:.0f} Hz {P["hpf_order"] * 6} dB/oct | '
      + ' | '.join(f'peak {g:+.1f} dB @{f:.0f} Hz Q{qq}' for f, g, qq in P['vo_eq'])
      + f' | de-esser {P["deess_band"][0] / 1000:.0f}-{P["deess_band"][1] / 1000:.0f} kHz {P["deess_ratio"]:.0f}:1 (thr {vmeta["deess_T"]:.1f} dBFS band peak, max {P["deess_max_db"]:.0f} dB)')
    o(f'         compressor {P["comp_ratio"]:.0f}:1 knee {P["comp_knee_db"]:.0f} dB, {P["comp_att_ms"]:.0f}/{P["comp_rel_ms"]:.0f} ms, thr {vmeta["comp_T"]:.1f} dBFS RMS'
      f' (all lines: GR median {vmeta["comp_gr_med"]:.1f} dB, P95 {vmeta["comp_gr_p95"]:.1f} dB, max {vmeta["comp_gr_max"]:.1f} dB on voiced frames)')
    o(f'         warmth: 2x-oversampled tanh, drive {P["sat_drive"]}, parallel mix {P["sat_mix"]:.0%} | air: SSB copy of {P["air_band"][0] / 1000:.1f}-{P["air_band"][1] / 1000:.0f} kHz'
      f' shifted +{P["air_shift_hz"] / 1000:.1f} kHz at {P["air_db"]:.0f} dB (adds {np.mean([l["air_rel_db"] for l in vst]):.1f} dB re line energy, 10.5-16 kHz)'
      f' | levelled per line to {P["vo_line_lufs"]} LUFS (dry, pre-master)')
    gvo_db = -a2db(ctx['g_vo'])
    gvo_c = gvo_db[:NC * HOP].reshape(NC, HOP).max(axis=1)
    vo_ev = segments(gvo_c > 1.0, gvo_c, 30)
    o(f'  VO peak limiter: true-peak (4x), ceiling {P["tp_ceiling_db"] + P["vo_tp_rel_db"]:.1f} dBTP as heard (3 dB under the master ceiling),'
      f' {P["vo_lim_la_ms"]} ms look-ahead, {P["vo_lim_rel_ms"]:.0f} ms release: GR max {gvo_db.max():.1f} dB, {len(vo_ev)} syllable onsets limited by >1 dB,'
      f' time >1 dB {np.mean(gvo_c > 1.0) * DUR:.2f} s; VO stem true peak {a2db(true_peak_lin(vo_s)):.2f} dBTP')
    gsx_db = -a2db(ctx['g_sfx'])
    gsx_c = gsx_db[:NC * HOP].reshape(NC, HOP).max(axis=1)
    sx_ev = segments(gsx_c > 1.0, gsx_c, 30)
    o(f'  SFX bus transient limiter: ceiling {P["tp_ceiling_db"] + P["sfx_tp_rel_db"]:.1f} dBTP as heard, {P["sfx_lim_la_ms"]} ms look-ahead, {P["sfx_lim_rel_ms"]:.0f} ms release:'
      f' GR max {gsx_db.max():.1f} dB, {len(sx_ev)} transients >1 dB (' + ', '.join(f'{s_[2] / CR:.2f}s {s_[3]:.1f}' for s_ in sx_ev[:12]) + ('...' if len(sx_ev) > 12 else '') + ')')
    o(f'  reverb: synthetic dark plate/room, pre-delay {rinfo["predelay_ms"]:.0f} ms, RT60 (Schroeder T20 of IR) {rinfo["rt60"]:.2f} s,'
      f' wet {rinfo["wet_rel_lu"]:+.1f} LU re dry, wet L/R correlation {rinfo["corr"]:.2f} (width on the wet only; dry is dual-mono centre)')
    for vid, e in ctx['edits'].items():
        o(f'  VO edit {vid}: internal pauses tightened (silence only, {P["tighten_xfade_ms"]:.0f} ms crossfades): '
          + ', '.join(f'{a:.2f}s {d0:.2f}->{d1:.2f}s' for a, d0, d1 in e['cuts'])
          + f'; last voiced frame {e["end_before"]:.2f} -> {e["end_after"]:.2f} s')
    for l in vst:
        if l['rides']:
            o(f'  phrase ride {l["id"]}: ' + ', '.join(f'"{lab}" {g:+.1f} dB ({a:.2f}-{b:.2f} s)' for lab, g, a, b in l['rides'])
              + f'  (line loudness +{l["ride_lift"]:.2f} LU; solver lift allowed {l["vob_cap"]:.2f} dB)')
    o(f'  ducking: key = dry VO RMS 10 ms; pauses < {P["duck_bridge_s"]} s bridged (unless a planned hit can punch through:'
      f' {", ".join(f"{t:g}" for t in P["punch_times"])}); look-ahead attack {P["duck_att_s"]:.2f} s finished {P["duck_pre_s"] * 1000:.0f} ms before'
      f' the first phoneme, hold {P["duck_hold_s"]:.2f} s, release {P["duck_rel_s"]:.2f} s (linear in dB, {P["duck_corner_s"] * 1000:.0f} ms corner smoothing);'
      f' {len(ctx["duck_regs"])} duck regions; hits inside bridged gaps get a drums/fx/SFX punch-through: {", ".join(f"{t:g}" for t in ctx["bridged"]) or "none"}')
    o(f'           pocket (slow 1-4 kHz EQ pocket on the orchestra): bridges {P["pocket_bridge_s"]} s, {P["pocket_att_s"]}/{P["pocket_rel_s"]} s ramps.'
      f' Nominal (effort 0): pitched broadband -{NOMINAL["b"]:.0f} dB + 1-4 kHz -{NOMINAL["band"]:.0f} dB; drums/fx_hits -{NOMINAL["perc"]} dB; SFX UI sounds -{NOMINAL["sfx"]:.0f} dB (impacts exempt near their accent).')
    o('  per-line solve: the minimal effort on the ladder ' + ' -> '.join(f'{k} {a:g}..{b:g}' for k, a, b in LADDER)
      + f' that gives >= +{P["ratio_target_db"] + P["ratio_margin_db"]:.1f} dB in 1-4 kHz (target +{P["ratio_target_db"]:.0f} + {P["ratio_margin_db"]} margin).')
    o('')

    sbf = bp_sos(1000.0, 4000.0, order=4)
    H20 = int(0.02 * SR)
    vb20 = fr_energy(signal.sosfiltfilt(sbf, vo_s, axis=0), H20)
    bb20 = fr_energy(signal.sosfiltfilt(sbf, bg_s, axis=0), H20)
    sxb20 = fr_energy(signal.sosfiltfilt(sbf, sx_s, axis=0), H20)
    mub20 = fr_energy(signal.sosfiltfilt(sbf, mu_s, axis=0), H20)
    pw_vo = kpow(vo_s)
    pw_bg = kpow(bg_s)
    vk20 = pw_vo[:len(pw_vo) // H20 * H20].reshape(-1, H20).sum(1)
    bk20 = pw_bg[:len(pw_bg) // H20 * H20].reshape(-1, H20).sum(1)
    sk = kpow(sx_s)
    sxk20 = sk[:len(sk) // H20 * H20].reshape(-1, H20).sum(1)
    mk = kpow(mu_s)
    muk20 = mk[:len(mk) // H20 * H20].reshape(-1, H20).sum(1)
    del sk, mk
    t20 = (np.arange(len(vb20)) + 0.5) * 0.02
    m_vo, st_m = win_mean(pw_vo, int(0.4 * SR), int(0.01 * SR))
    s_vo, st_s = win_mean(pw_vo, int(3.0 * SR), int(0.1 * SR))

    def core_frames(a, b, li):
        idx = np.where((t20 >= a) & (t20 < b))[0]
        lfr = np.where((t20 >= vst[li]['start']) & (t20 < vst[li]['end']))[0]
        thr = np.percentile(db(vk20[lfr]), 95) - 15
        return idx[db(vk20[idx]) > thr]

    def ratio(num, den, idx):
        return 10 * math.log10(num[idx].sum() / max(den[idx].sum(), 1e-30)) if len(idx) else float('nan')

    hdr = ('  line  start    end   dur  gap>  lineLU  Mvoic  STmax |  r1-4k  rKW | core: p10 1-4k  p10 KW  %<0 1-4k  %<0 KW |'
           ' worst 0.5s: 1-4k   KW  (at)  | effort  duck b/band/pocket/drm/drm.band/sfx/voB  r@nom  bg 1-4k pit/drm/sfx')
    o(hdr)
    o('  ' + '-' * (len(hdr) - 2))
    gaps, lineLU, rows = [], [], []
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
        core = core_frames(l['start'], l['end'], i)
        rb = ratio(vb20, bb20, core)
        rk = ratio(vk20, bk20, core)
        fb = db(vb20[core]) - db(bb20[core])
        fk = db(vk20[core]) - db(bk20[core])
        worst_b, worst_k, worst_t = 99.0, 99.0, 0.0
        for w0 in np.arange(l['start'], l['end'] - 0.25, 0.25):
            c = core_frames(w0, w0 + 0.5, i)
            if len(c) < 5:
                continue
            wb, wk = ratio(vb20, bb20, c), ratio(vk20, bk20, c)
            if min(wb, wk + 3) < min(worst_b, worst_k + 3):
                worst_b, worst_k, worst_t = wb, wk, w0
        nxt = vst[i + 1]['start'] if i + 1 < len(vst) else DUR
        gap = nxt - l['end']
        gaps.append(gap)
        l.update(lineLU=L_line, M_voiced=M_voiced, ST_max=ST_max, r_band=rb, r_kw=rk, p10b=float(np.percentile(fb, 10)),
                 p10k=float(np.percentile(fk, 10)), lt0b=float(100 * np.mean(fb < 0)), lt0k=float(100 * np.mean(fk < 0)),
                 worst_b=worst_b, worst_k=worst_k, worst_t=worst_t, gap=gap)
        rows.append(l)
        kn = l['knobs']
        o(f"  {l['id']:4s} {l['start']:6.2f} {l['end']:6.2f} {l['dur']:5.2f} {gap:5.2f}  {L_line:6.2f} {M_voiced:6.2f} {ST_max:6.2f} |"
          f"  {rb:+5.1f}  {rk:+5.1f} |      {l['p10b']:+6.1f}  {l['p10k']:+6.1f}    {l['lt0b']:4.0f}%   {l['lt0k']:4.0f}% |"
          f"       {worst_b:+5.1f} {worst_k:+5.1f} ({worst_t:6.2f}) | {l['effort']:+5.2f}  {kn['b']:.1f}/{kn['band']:.1f}/{kn['pocket']:.1f}/{kn['perc']:.1f}/{kn['pband']:.1f}/{kn['sfx']:.1f}/{kn['vob']:+.1f}"
          f"   {l['r_nominal']:+5.1f}   {100 * (l['share'][0] + l['share'][1]):3.0f}%/{100 * (l['share'][2] + l['share'][3]):3.0f}%/{100 * l['share'][4]:3.0f}%"
          f"  {'OK' if rb >= P['ratio_target_db'] and min(worst_b, worst_k) >= min(P['floor_band_db'], P['floor_kw_db']) - 0.5 else 'LOW'}")
    o('  columns: lineLU = BS.1770 gated loudness of the VO stem over the line (as heard); Mvoic = energy-mean momentary loudness of voiced 400 ms blocks;'
      ' STmax = max short-term (3 s) touching the line;')
    o('           r1-4k / rKW = VO / background (music_ducked+sfx) energy ratio over the line\'s speech-core 20 ms frames (VO within 15 dB of the line\'s'
      ' 95th percentile, K-weighted) in 1-4 kHz / broadband K-weighted;')
    o('           core p10 = 10th-percentile frame ratio, %<0 = share of speech-core frames where the background is louder than the VO;'
      ' worst 0.5s = lowest ratio over 0.5 s windows (0.25 s hop) of the line;')
    o('           effort/duck = solved ladder position and depths in dB (pitched broadband / pitched extra 1-4 kHz / slow pocket 1-4 kHz /'
      ' drums broadband / drums extra 1-4 kHz / SFX UI duck / VO line lift); r@nom = 1-4 kHz ratio at the nominal brief setting; bg = who fills the 1-4 kHz background.')
    o(f'           solver goal per line: >= +{P["ratio_target_db"] + P["ratio_margin_db"]:.1f} dB in 1-4 kHz over the speech-core frames AND every 0.5 s window >= +{P["floor_band_db"]:.0f} dB (1-4 kHz)'
      f' and >= +{P["floor_kw_db"]:.0f} dB (K-weighted); OK below = line >= +{P["ratio_target_db"]:.0f} dB and worst window within 0.5 dB of the floor.')
    spread = max(lineLU) - min(lineLU)
    medLU = float(np.median(lineLU))
    mv_all = [r['M_voiced'] for r in rows]
    o(f'  line loudness: mean {np.mean(lineLU):.2f} LUFS, median {medLU:.2f}, min {min(lineLU):.2f}, max {max(lineLU):.2f}, spread {spread:.2f} LU,'
      f' max |line - median| {max(abs(x - medLU) for x in lineLU):.2f} LU'
      f'  -> {"OK" if max(abs(x - medLU) for x in lineLU) <= 1.0 else "FAIL"} (+/-1 LU)')
    o(f'  voiced momentary: spread {max(mv_all) - min(mv_all):.2f} LU (min {min(mv_all):.2f}, max {max(mv_all):.2f})')
    rbs = [r['r_band'] for r in rows]
    rks = [r['r_kw'] for r in rows]
    o(f'  VO/background 1-4 kHz (speech-core): min {min(rbs):+.1f} dB ({rows[int(np.argmin(rbs))]["id"]}), median {np.median(rbs):+.1f} dB'
      f'  -> {"OK" if min(rbs) >= P["ratio_target_db"] else "FAIL"} (>= +{P["ratio_target_db"]:.0f} dB every line)')
    o(f'  VO/background broadband K-weighted (speech-core): min {min(rks):+.1f} dB ({rows[int(np.argmin(rks))]["id"]}), median {np.median(rks):+.1f} dB')
    o(f'  worst 0.5 s window anywhere: 1-4 kHz {min(r["worst_b"] for r in rows):+.1f} dB, K-weighted {min(r["worst_k"] for r in rows):+.1f} dB;'
      f' speech-core frames with background louder than VO: 1-4 kHz {np.mean([r["lt0b"] for r in rows]):.0f}% (max {max(r["lt0b"] for r in rows):.0f}%),'
      f' K-weighted {np.mean([r["lt0k"] for r in rows]):.0f}% (max {max(r["lt0k"] for r in rows):.0f}%)')
    o(f'  solver prediction vs measured (line 1-4 kHz, worst window 1-4 kHz): ' + ', '.join(f'{r["id"]} {r["r_pred"]:+.1f}/{r["r_band"]:+.1f} {r["wb_pred"]:+.1f}/{r["worst_b"]:+.1f}' for r in rows))
    lows = [r['id'] for r in rows if min(r['worst_b'], r['worst_k']) < min(P['floor_band_db'], P['floor_kw_db']) - 0.5]
    o(f'  [{"OK" if not lows else "WARN"}] worst 0.5 s window >= floor (-0.5 dB tolerance) on every line' + (': below on ' + ', '.join(lows) + ' (ladder exhausted)' if lows else ''))
    o(f'  lines needing more than nominal: {", ".join(r["id"] for r in rows if r["effort"] > 0.01) or "none"};'
      f' relaxed to 5 dB broadband: {", ".join(r["id"] for r in rows if r["effort"] <= -0.999) or "none"}')
    o('')

    # phrases
    o('  per phrase (speech-core frames):  line  phrase                                   span            1-4k     KW   p10 1-4k  p10 KW')
    for i, l in enumerate(vst):
        for p_ in l['phrases']:
            c = core_frames(p_['a'], p_['b'], i)
            if len(c) == 0:
                continue
            fb = db(vb20[c]) - db(bb20[c])
            fk = db(vk20[c]) - db(bk20[c])
            o(f'      {l["id"]}  {p_["label"][:38]:38s}  {p_["a"]:6.2f}-{p_["b"]:6.2f}   {ratio(vb20, bb20, c):+5.1f}  {ratio(vk20, bk20, c):+5.1f}'
              f'    {np.percentile(fb, 10):+5.1f}   {np.percentile(fk, 10):+5.1f}')
    o('')

    # overlap + accents inside lines
    o(f'  overlap check (lines): min gap between consecutive lines {min(gaps[:-1]):.3f} s ({vst[int(np.argmin(gaps[:-1]))]["id"]}->'
      f'{vst[int(np.argmin(gaps[:-1])) + 1]["id"]}); overlaps: {sum(g < 0 for g in gaps)}  -> {"OK" if min(gaps) > 0 else "FAIL"}'
      f'  (last line ends {vst[-1]["end"]:.2f} s)')
    o(f'  accents vs speech (every SFX impact/hit/stamp/anvil/coin/zap cue + detected drums/fx_hits accent within a line span;'
      f' window t..t+{P["protect_win_s"]:.1f} s, speech-core 20 ms frames, final stems; pass = VO/bg >= +{P["check_kw_db"]:.0f} dB KW and >= +{P["check_band_db"]:.0f} dB 1-4 kHz):')
    o('      t       line  source                 protect   VO/bg KW  1-4k | VO/SFX KW  1-4k | VO/music KW  1-4k | worst 20ms KW  1-4k')
    n_ev, n_fail, ev_rows = 0, 0, []
    for ev in events:
        li = next((i for i, l in enumerate(vst) if l['start'] - 0.05 <= ev['t'] <= l['end'] + 0.05), None)
        if li is None:
            continue
        c = core_frames(ev['t'], ev['t'] + P['protect_win_s'], li)
        src = ','.join(sorted(s.replace('sfx:', '') for s in ev['src']))
        if len(c) == 0:
            o(f'    {ev["t"]:7.2f}  {vst[li]["id"]}  {src[:22]:22s}  {ev["depth"]:4.1f} dB   lands in a pause (no speech-core frame in 0-300 ms)')
            continue
        n_ev += 1
        rk_, rb_ = ratio(vk20, bk20, c), ratio(vb20, bb20, c)
        ok = rk_ >= P['check_kw_db'] and rb_ >= P['check_band_db']
        n_fail += not ok
        ev_rows.append((ev['t'], rk_, rb_, ok))
        o(f'    {ev["t"]:7.2f}  {vst[li]["id"]}  {src[:22]:22s}  {ev["depth"]:4.1f} dB   {rk_:+6.1f} {rb_:+6.1f} | {ratio(vk20, sxk20, c):+6.1f} {ratio(vb20, sxb20, c):+6.1f} |'
          f'  {ratio(vk20, muk20, c):+6.1f} {ratio(vb20, mub20, c):+6.1f} |  {(db(vk20[c]) - db(bk20[c])).min():+6.1f} {(db(vb20[c]) - db(bb20[c])).min():+6.1f}'
          f'  {"OK" if ok else "LOW"}{"  (" + ev["note"] + ")" if ev.get("note") else ""}')
    o(f'  [{"OK" if n_fail == 0 else "WARN"}] accents landing on speech: {n_ev}, below the per-event threshold: {n_fail}'
      + ('' if not n_fail else ' -> ' + ', '.join(f'{t_:.2f}s ({k_:+.1f} KW / {b_:+.1f} 1-4k)' for t_, k_, b_, ok in ev_rows if not ok)))
    o('')

    # ---------------------------------------------------------------- ducking dynamics
    o('  ducking dynamics')
    t_c = (np.arange(NC) + 0.5) / CR
    excl = np.zeros(NC, bool)
    for th in BIG_HITS:
        excl |= (t_c >= th - 0.43) & (t_c <= th + 0.68)
    for th in OTHER_HITS:
        excl |= (t_c >= th - 0.13) & (t_c <= th + 0.68)
    pexcl = excl.copy()
    for ev in events:
        if ev['depth'] > 0.05:
            pexcl |= (t_c >= ev['t'] - 0.13) & (t_c <= ev['t'] + 0.44)

    def slope_stats(g, mask):
        s = (np.roll(g, -50) - np.roll(g, 50)) / 0.1          # dB/s over 100 ms
        s[:50] = 0
        s[-50:] = 0
        s = np.where(mask, 0.0, s)
        return float(s.min()), float(t_c[np.argmin(s)]), float(s.max()), float(t_c[np.argmax(s)]), float(np.mean(np.abs(s) > 20) * DUR)

    dk = ctx['AUTO'] + ctx['PROT']
    duck_b = gdb[0] - dk[0]
    duck_m = gdb[1] - dk[1]
    for nm, g, ex_ in (('pitched broadband (duck only)', duck_b, excl), ('pitched 1-4 kHz (duck + pocket)', duck_m, excl),
                       ('pitched broadband (all automation)', gdb[0], pexcl), ('pitched 1-4 kHz (all automation)', gdb[1], pexcl)):
        fmin, tmin, fmax, tmax, t20s = slope_stats(g, ex_)
        o(f'    designed gain slope, {nm:36s}: fastest attack {fmin:6.1f} dB/s ({tmin:6.2f}s), fastest release {fmax:+6.1f} dB/s ({tmax:6.2f}s),'
          f' time > 20 dB/s {t20s:.2f} s ({"hit/suck" if ex_ is excl else "hit/suck/protect-dip"} windows excluded)')
    # measured gains (music_ducked vs raw score), 10 ms frames, like the review: 50 ms median + 30 ms mean, slope over 100 ms.
    # The aggregate also moves when a less-ducked drum/stamp accent momentarily dominates the score (composition, not
    # gain), so it is shown twice: with hit/suck/protect windows excluded, and also with every accent window excluded.
    aexcl = pexcl.copy()
    for ev in events:
        aexcl |= (t_c >= ev['t'] - 0.13) & (t_c <= ev['t'] + 0.44)
    for th in hit_times:
        aexcl |= (t_c >= th - 0.13) & (t_c <= th + 0.68)
    raw = signal.sosfiltfilt(signal.butter(2, P['dc_hpf_hz'], 'highpass', fs=SR, output='sos'), ctx['music_raw'].astype(np.float64), axis=0)
    H10 = 480
    G2 = (G[:N // H10 * H10] ** 2).reshape(-1, H10).mean(1)
    meas = {}
    for nm, sos in (('broadband', None), ('1-4 kHz', signal.butter(4, [1100, 3600], 'bandpass', fs=SR, output='sos'))):
        a_ = raw if sos is None else signal.sosfiltfilt(sos, raw, axis=0)
        b_ = mu_s if sos is None else signal.sosfiltfilt(sos, mu_s, axis=0)
        er, em = fr_energy(a_, H10), fr_energy(b_, H10)
        okf = db(er / H10) > -75
        for style, gg in (('mix automation', db(em) - db(er * G2)), ('as the review measured', db(em) - db(er))):
            gg = np.where(okf, gg, np.nan)
            ii = np.arange(len(gg))
            gd = np.interp(ii, ii[~np.isnan(gg)], gg[~np.isnan(gg)])
            gd = uniform_filter1d(median_filter(gd, 5), 3)
            tt = (ii + 0.5) * 0.01
            s0 = (np.roll(gd, -5) - np.roll(gd, 5)) / 0.1
            s0[:5] = 0
            s0[-5:] = 0
            for exn, exm in (('hit/suck/protect', pexcl), ('+ all accents', aexcl)):
                m_ = np.interp(tt, t_c, exm.astype(float)) > 0.5
                s = np.where(m_, 0.0, s0)
                meas[(nm, style, exn)] = s
                o(f'    measured music gain slope, {nm:9s}, {style:22s}, excl. {exn:16s}: fastest attack {s.min():6.1f} dB/s ({tt[np.argmin(s)]:6.2f}s),'
                  f' fastest release {s.max():+6.1f} dB/s ({tt[np.argmax(s)]:6.2f}s), time > 20 dB/s {np.mean(np.abs(s) > 20) * DUR:.2f} s')
    # where pumping would be heard: around each line's start and end (accents excluded)
    bnd = np.zeros(NC, bool)
    for l in vst:
        bnd |= (t_c >= l['start'] - 0.8) & (t_c <= l['start'] + 0.3)
        bnd |= (t_c >= l['end'] - 0.3) & (t_c <= l['end'] + 1.2)
    for nm in ('broadband', '1-4 kHz'):
        s = meas[(nm, 'as the review measured', '+ all accents')]
        tt = (np.arange(len(s)) + 0.5) * 0.01
        m_ = np.interp(tt, t_c, bnd.astype(float)) > 0.5
        sb_ = np.where(m_, s, 0.0)
        o(f'    measured music gain slope at line starts/ends ({nm:9s}, as the review measured, accents excluded): fastest attack {sb_.min():6.1f} dB/s'
          f' ({tt[np.argmin(sb_)]:6.2f}s), fastest release {sb_.max():+6.1f} dB/s ({tt[np.argmax(sb_)]:6.2f}s), time > 20 dB/s {np.mean(np.abs(sb_) > 20) * DUR:.2f} s')
    # the fastest measured moves vs the designed gains at the same instant (composition check)
    def dslope(g, t_):
        i = int(t_ * CR)
        return (g[min(NC - 1, i + 50)] - g[max(0, i - 50)]) / 0.1
    tops = []
    for key in (('broadband', 'as the review measured', '+ all accents'), ('1-4 kHz', 'as the review measured', '+ all accents')):
        s_ = meas[key].copy()
        tt = (np.arange(len(s_)) + 0.5) * 0.01
        for _ in range(3):
            k = int(np.argmax(np.abs(s_)))
            tops.append((key[0], tt[k], s_[k]))
            s_[max(0, k - 30):k + 30] = 0
    o('    fastest measured moves vs the designed gains there (dB/s; pitched / pitched 1-4k / drums+fx): '
      + '; '.join(f'{nm} {t_:.2f}s {v:+.0f} -> designed {dslope(gdb[0], t_):+.0f} / {dslope(gdb[1], t_):+.0f} / {dslope(gdb[2], t_):+.0f}' for nm, t_, v in tops))
    rel_d = max(slope_stats(duck_b, excl)[2], slope_stats(duck_m, excl)[2], slope_stats(gdb[0], pexcl)[2], slope_stats(gdb[1], pexcl)[2])
    rel_m = max(meas[('broadband', 'mix automation', '+ all accents')].max(), meas[('1-4 kHz', 'mix automation', '+ all accents')].max())
    o(f'  [{"OK" if rel_d <= 20.0 else "WARN"}] designed (actual automation) release slopes <= 20 dB/s: max {rel_d:+.1f} dB/s.'
      f' Measured score-gain release away from accents: max {rel_m:+.1f} dB/s'
      + (' - where the designed gains are flat this is the score\'s own composition changing (a drum/stamp hit, ducked less than'
         ' the orchestra, briefly dominating the score), not a gain move' if rel_m > 20.0 else ''))
    gm = gdb[0] - dk[0]
    rec = []
    for i in range(len(vst) - 1):
        g0, g1 = vst[i]['end'], vst[i + 1]['start']
        sel = (t_c >= g0) & (t_c <= g1)
        if not sel.any():
            continue
        lvl = gm[sel].max()
        rec.append(f"{vst[i]['id']}->{vst[i + 1]['id']} {g1 - g0:.1f}s: max {lvl:+.1f} dB")
    o('    duck in the gaps (pitched broadband duck gain, max inside the gap; 0 = fully released): ' + '; '.join(rec))
    o('')

    # ---------------------------------------------------------------- bar table
    o('[3] LOUDNESS PER 2 s BAR (final mix; barLU = K-weighted energy over the bar; STmax = max 3 s; Mmax = max 400 ms;'
      ' music = raw score sum, same master gain, no ducking; VO% = bar time covered by a VO line)')
    m_fin, st_mf = win_mean(pw_fin, int(0.4 * SR), int(0.01 * SR))
    s_fin, st_sf = win_mean(pw_fin, int(3.0 * SR), int(0.1 * SR))
    pw_mus = kpow(raw * G[:, None])
    del raw
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
    o('[4] BIG-HIT / ONSET CHECK (momentary 400 ms and 50 ms loudness of final_mix, 10 ms hop, window end time;'
      ' "phone" = same after a 4th-order 180 Hz high-pass, a crude phone-speaker proxy)')
    phone = signal.butter(4, 180, 'high', fs=SR, output='sos')
    pw_ph = kpow(signal.sosfilt(phone, fin, axis=0))
    hit_res = {}
    for nm, pw, win in (('full-range M400', pw_fin, 0.4), ('phone M400', pw_ph, 0.4), ('full-range S50', pw_fin, 0.05), ('phone S50', pw_ph, 0.05)):
        m_, st_ = win_mean(pw, int(win * SR), int(0.01 * SR))
        te = (st_ + int(win * SR)) / SR
        Ld = lufs(m_)
        ex = np.zeros(len(Ld), bool)
        for th in BIG_HITS:
            ex |= (te >= th - 0.02) & (te <= (th + 0.5 + win if th < 116 else DUR + 1))
        M_else = float(Ld[~ex].max())
        t_else = float(te[~ex][np.argmax(Ld[~ex])])
        rows_h = []
        for th in BIG_HITS:
            sel = (te >= th) & (te <= (th + 0.5 + win if th < 116 else th + 2.0))
            mp = float(Ld[sel].max())
            mt = float(te[sel][np.argmax(Ld[sel])])
            ctxv = float(np.median(Ld[(te >= th - 2.0) & (te <= th - 0.3)]))
            rows_h.append((th, mp, mt, ctxv))
        pk_ = nms(Ld, te, 1.5, 12)
        hit_res[nm] = (rows_h, M_else, t_else, pk_)
        o(f'  {nm}:  ' + '  '.join(f'{th:5.0f}s {mp:6.2f} ({mt:6.2f}, +{mp - ctxv:4.1f} over t-2..t-0.3)' for th, mp, mt, ctxv in rows_h))
        if 'M400' in nm:
            ok = all(r[1] > M_else for r in rows_h)
            verdict = f'[{"OK" if ok else "FAIL"}] every big hit louder than anything else'
        else:
            ok = all(r[1] > M_else - 1.0 for r in rows_h)
            verdict = f'[{"OK" if ok else "WARN"}] every big hit transient within 1 dB of / above any other transient' if 'full' in nm else '(info: VO syllables are near-full-band on a phone)'
        o(f'      loudest outside the hits: {M_else:.2f} at {t_else:.2f} s; weakest hit margin {min(r[1] for r in rows_h) - M_else:+.2f} dB  -> {verdict}')
        o('      top-12 (1.5 s NMS): ' + ', '.join(f'{t_:.2f}s {m_:.1f}{"*" if any(th - 0.02 <= t_ <= (th + 0.5 + win if th < 116 else DUR + 1) for th in BIG_HITS) else ""}' for t_, m_ in pk_)
          + '   (* = big hit)')
    mont = []
    m50, st50 = win_mean(pw_fin, int(0.05 * SR), int(0.01 * SR))
    S50 = lufs(m50)
    t50 = (st50 + int(0.05 * SR)) / SR
    for th in [80.0 + k for k in range(8)]:
        sel = (t50 >= th) & (t50 <= th + 0.12)
        ctxv = float(np.median(S50[(t50 >= th + 0.3) & (t50 <= th + 0.7)]))
        mont.append((th, float(S50[sel].max()), float(S50[sel].max()) - ctxv))
    o('  montage cuts (S50 peak / contrast vs the half-beat after): ' + ', '.join(f'{t_:.0f}s {p:.1f}/{c:+.1f}' for t_, p, c in mont))
    o(f'  hit treatment: suck-out {", ".join(f"{th:g}s -{d:g} dB" for th, d in P["suck"])} ({P["suck_start_s"]:.2f}-{P["suck_snap_s"] * 1000:.0f} ms before);'
      f' trims ' + ', '.join(f'{t0:g}-{t1:g}s {g:+.1f} dB' for t0, _, t1, _, g in P['music_trims'])
      + f'; sub <{P["hit_sub_hz"]:.0f} Hz {P["hit_sub_db"]:+.1f} dB on the hits; rides (from the hit, {P["ride_hold_s"]} s hold, {P["ride_out_s"]} s out):'
      f' score pitched {P["ride_pitched_db"]:+.1f} dB, drums/fx {P["ride_perc_db"]:+.1f} dB, SFX {P["ride_sfx_db"]:+.1f} dB;'
      f' layers on the SFX bus: drum-body tone ({P["tone_f0"]:.0f}->{P["tone_f1"]:.0f} Hz, partials 1-4, {P["tone_rel_db"]:+.0f} dB re the score hit) +'
      f' virtual bass ({P["vbass_band"][0]:.0f}-{P["vbass_band"][1]:.0f} Hz harmonics of the hit\'s own sub, {P["vbass_rel_db"]:+.0f} dB) + '
      + ', '.join(f'{th:g}s {iv} 150-500 Hz body {P["hit_body_db"]:+.0f} dB / {hv} >700 Hz crack {P["hit_crack_db"]:+.0f} dB / {av} >400 Hz ring {P["hit_anvil_db"]:+.0f} dB' for th, iv, hv, av in ctx['layer_log']))
    o('')

    # ---------------------------------------------------------------- spectrum
    fc, Lf = third_oct(fin)
    _, Lv = third_oct(vo_s)
    tot = 10 * np.log10(np.sum(10 ** (Lf / 10)))
    k2 = (fc >= 125) & (fc <= 8000)
    slope = np.polyfit(np.log2(fc[k2]), Lf[k2], 1)[0]

    def band(L, lo, hi):
        k = (fc >= lo * 0.99) & (fc <= hi * 1.01)
        return 10 * np.log10(np.sum(10 ** (L[k] / 10)))

    i1k = int(np.argmin(np.abs(fc - 1000)))
    vref = Lv[i1k]
    o('[5] SPECTRUM (1/3-octave band power, Welch)')
    o(f'  final mix: slope 125 Hz-8 kHz {slope:.2f} dB/oct; 8 kHz -> 10 kHz band step {Lf[np.argmin(np.abs(fc - 10079))] - Lf[np.argmin(np.abs(fc - 8000))]:+.1f} dB;'
      f' 10-16 kHz {band(Lf, 10000, 16000) - tot:+.1f} dB re total; sub 20-50 Hz {band(Lf, 20, 50) - tot:+.1f} dB; 2-5 kHz {band(Lf, 2000, 5000) - tot:+.1f} dB')
    o(f'  VO stem re its 1 kHz band: 125 Hz {Lv[np.argmin(np.abs(fc - 125))] - vref:+.1f}, 160 Hz {Lv[np.argmin(np.abs(fc - 160))] - vref:+.1f},'
      f' 250-800 Hz mean {np.mean(Lv[(fc >= 248) & (fc <= 810)]) - vref:+.1f}, 2.5-8 kHz mean {np.mean(Lv[(fc >= 2480) & (fc <= 8100)]) - vref:+.1f},'
      f' 12.5 kHz {Lv[np.argmin(np.abs(fc - 12699))] - vref:+.1f}; VO 160 Hz band {Lv[np.argmin(np.abs(fc - 160))] - tot:+.1f} dB re the mix total')
    o('')
    o('[6] FILES')
    for pth in ['final_mix.wav', 'final_stems/vo.wav', 'final_stems/music_ducked.wav', 'final_stems/sfx.wav',
                'final_mix_report.txt', 'final_mix_analysis.png']:
        o(f'  {out_dir / pth}')
    o(f'  build script: {ROOT / "audio-src/mix/build_mix.py"}  (runtime {time.time() - T0:.0f} s)')
    txt = '\n'.join(rep) + '\n'
    (out_dir / 'final_mix_report.txt').write_text(txt)
    print(txt)

    if not ctx['no_png']:
        tm_end = (st_mf + int(0.4 * SR)) / SR
        make_png(out_dir / 'final_mix_analysis.png', fin, vo_s, mu_s, vst, ctx, tm_end, lufs(m_fin), st_sf, s_fin,
                 st_s, s_vo, I_fin, tp4, LRA_fin, tl)
        log('png written')


def make_png(path, fin, vo_s, mu_s, vst, ctx, tm_end, Mdb, st_sf, s_fin, st_s, s_vo, I_fin, tp4, LRA_fin, tl):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.gridspec import GridSpec

    gdb = ctx['gdb']
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

    ax = fig.add_subplot(gs[1])
    f, t, Sg = signal.spectrogram(fin.mean(axis=1), SR, nperseg=4096, noverlap=4096 - 1200, window='hann', mode='psd')
    from scipy.interpolate import interp1d
    flog = np.geomspace(30, 20000, 360)
    Sd = interp1d(f, 10 * np.log10(Sg + 1e-14), axis=0)(flog)
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
    ax.set_title('Loudness - the music stays down across short pauses, comes back in the long gaps, the hits stay on top (dotted = -14 LUFS target)')
    ax.legend(loc='lower right', bbox_to_anchor=(1.0, 1.0), frameon=False, ncol=4, fontsize=9)

    ax = fig.add_subplot(gs[3])
    tc = (np.arange(NC) + 0.5) / CR
    ax.plot(tc, gdb[0], color=C_MU, lw=1.4, label='pitched stems, broadband')
    ax.plot(tc, gdb[1], color=C_BAND, lw=1.2, label='pitched stems, 1-4 kHz')
    ax.plot(tc, gdb[2], color=INK2, lw=1.0, label='drums + fx_hits (incl. accent-protect dips)')
    ax.plot(tc, gdb[4] - P['sfx_fader_db'], color=C_SX, lw=1.0, label='SFX (re fader)')
    for ev in ctx['events']:
        if ev['depth'] > 0.05:
            ax.plot([ev['t']], [-ev['depth'] - 0.3], marker='v', color=C_SX, ms=4)
    spans(ax)
    ax.set_xlim(0, DUR)
    ax.set_ylim(min(-13.0, float(np.floor(gdb[:4].min())) - 1), 2)
    ax.set_ylabel('gain dB')
    ax.set_xlabel('time (s)')
    ax.set_title(f'Ducking + automation: {P["duck_att_s"]:.2f} s look-ahead attack / {P["duck_rel_s"]:.2f} s release, pauses < {P["duck_bridge_s"]} s bridged,'
                 ' slow 1-4 kHz pocket, pre-hit suck-outs, montage/finale trims; triangles = accent-protect dips under words')
    ax.legend(loc='lower right', bbox_to_anchor=(1.0, 1.0), frameon=False, ncol=4, fontsize=9)

    ax = fig.add_subplot(gs[4])
    ids = [l['id'] for l in vst]
    x = np.arange(len(ids))
    ax.bar(x - 0.2, [l['r_band'] for l in vst], width=0.38, color=C_VO, label='VO / background, 1-4 kHz')
    ax.bar(x + 0.2, [l['r_kw'] for l in vst], width=0.38, color=C_MU, label='VO / background, broadband K-weighted')
    ax.plot(x - 0.2, [l['worst_b'] for l in vst], ls='none', marker='_', ms=14, mew=2, color=INK, label='worst 0.5 s window, 1-4 kHz')
    ax.axhline(P['ratio_target_db'], color=INK, ls='--', lw=1, label=f'+{P["ratio_target_db"]:.0f} dB target (1-4 kHz)')
    ax.axhline(0, color=GRID, lw=1)
    for xi, l in zip(x, vst):
        ax.text(xi - 0.2, l['r_band'] + 0.3, f"{l['r_band']:.1f}", ha='center', fontsize=7.5, color=INK2)
    ax.set_xticks(x)
    ax.set_xticklabels([f"{l['id']}\n{l['start']:.1f}s" for l in vst], fontsize=8)
    ax.set_ylabel('dB')
    ax.set_title('Per-line VO-to-background ratio (speech-core frames of each line, measured on the final stems)')
    ax.legend(loc='lower right', bbox_to_anchor=(1.0, 1.0), frameon=False, ncol=4, fontsize=9)
    ax.grid(axis='y', color=GRID, lw=0.6)
    ax.set_axisbelow(True)
    fig.savefig(path, dpi=100)
    plt.close(fig)


if __name__ == '__main__':
    main()
