"""Synthesis recipes for every SFX type used by the Albion Journal film.

Every recipe returns a `Sound`: a (n, 2) float array plus `anchor`, the sample
index of the perceptual accent. The assembler places a sound so that `anchor`
lands exactly on the timeline time:
    impact/hit/stamp/anvil/coin/fire/sparkle/glint/zap/click/key/pop/tick
        -> anchor = transient peak (the hit)          ... placed on t
    whoosh -> anchor = loudest point (the cut)        ... placed on t + dur
    swell  -> anchor = top of the crescendo           ... placed on t + dur
    riser / reverse -> anchor = the abrupt end         ... placed on t + dur
Layers are peak-normalised (`nz`) and mixed with dB gains so the recipes read
like a session's fader sheet. Everything is seeded -> bit-identical re-renders.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from dsp import (SR, additive_saw, bp, damped_sine, dc_block, decay_env, fade, hp,
                 lognorm_band, lp, modal, noise, ns, pad_to, pan, peak_eq,
                 phase_from_freq, reverb, rng, saturate, shaped_noise, stereo,
                 t60_env, taxis, undb, widen, place)

# D minor pentatonic (D F G A C) - the film is in D minor at 120 BPM
NOTE_HZ = {"D": 146.832, "F": 174.614, "G": 195.998, "A": 220.000, "C": 261.626}  # octave 3
PENTA = ["D", "F", "G", "A", "C"]


def note_hz(name: str, octave: int) -> float:
    """`octave` counts ladder octaves starting on D (D3 F3 G3 A3 C4 = ladder octave 3)."""
    return NOTE_HZ[name] * 2 ** (octave - 3)


def note_label(name: str, octave: int) -> str:
    """Scientific pitch name for a ladder note (C sits above A, i.e. in the next octave)."""
    return f"{name}{octave + (1 if name == 'C' else 0)}"


@dataclass
class Sound:
    data: np.ndarray            # (n, 2)
    anchor: int                 # accent sample index
    anchor_kind: str            # 'transient' | 'loudest' | 'end'
    desc: str = ""
    meta: dict = field(default_factory=dict)


def nz(x):
    """Peak-normalise a layer to 1.0."""
    m = np.abs(x).max()
    return x / m if m > 0 else x


def finish(x, anchor, peak_db, kind, desc, fout=0.0, fin=0.0, dc=True, meta=None):
    x = stereo(x)
    if dc:
        x = dc_block(x)
    x = fade(x, fin, fout)
    x = nz(x) * undb(peak_db)
    return Sound(x.astype(np.float64), int(anchor), kind, desc, meta or {})


def burst(n, seed, f_hp, tau, attack=0.0001):
    return hp(noise(n, seed), f_hp, 2) * decay_env(n, tau, attack)


def pre_pad(x, n_pre):
    """Prepend silence (mono or stereo)."""
    shape = (n_pre,) + x.shape[1:]
    return np.concatenate([np.zeros(shape), x], axis=0)


# ======================================================================= crash
def crash(n, seed, tau=0.9, bright=1.0):
    """Synthetic crash cymbal: spectrally-shaped decaying noise wash (HF decays
    faster) + an 808-style ring of six inharmonic band-limited squares + a bank of
    inharmonic partials for shimmer + a 4 ms bright attack. Stereo."""
    r = rng(seed)

    def mag(times, freqs):
        f = np.maximum(freqs, 1.0)
        shape = (f / 2600) ** 2 / (1 + (f / 2600) ** 2)
        shape = shape / (1 + (f / (13000 * bright)) ** 4)
        shape = shape * (1 + 0.9 * np.exp(-0.5 * (np.log2(f / 4700) / 0.45) ** 2)
                         + 0.6 * np.exp(-0.5 * (np.log2(f / 8300) / 0.35) ** 2))
        tauf = tau * np.clip((f / 5000.0) ** -0.4, 0.35, 1.5)
        # decay RELATIVE to the master envelope (applied in the time domain below,
        # so the attack is sample-sharp instead of smeared by the STFT window)
        return shape[:, None] * np.exp(-times[None, :] * (1 / tauf[:, None] - 1 / tau))

    wash = np.stack([shaped_noise(n, seed * 7 + c, mag) for c in range(2)], axis=1)
    wash *= decay_env(n, tau, 0.0002)[:, None]
    t = taxis(n)
    sq = np.zeros(n)
    for f in np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * r.uniform(0.97, 1.03):
        ph = 2 * np.pi * f * t + r.uniform(0, 2 * np.pi)
        for k in range(1, 40, 2):
            if k * f > 18000:
                break
            sq += np.sin(k * ph) / k
    metal = bp(sq, 3200, 11000, 2) * decay_env(n, tau * 0.55, 0.0003)
    fr = np.exp(r.uniform(np.log(1800), np.log(11500), 36))
    part = modal(n, 1.0, fr, r.uniform(0.3, 1.0, 36), r.uniform(0.25, 1.4, 36) * tau * 1.5, seed=seed + 3)
    att = burst(n, seed + 4, 3000, 0.004)
    m = 0.35 * nz(metal) + 0.25 * nz(part) + 0.45 * nz(att)
    out = 0.75 * nz(wash) + np.stack([m * 0.9, m * 0.9], axis=1)
    return out


# ====================================================================== impact
def impact(strength=2, seed=0):
    s = int(np.clip(strength, 1, 3))
    D = {1: 0.8, 2: 1.3, 3: 2.0}[s]
    n = ns(D + {1: 1.0, 2: 1.4, 3: 2.0}[s])
    t = taxis(n)
    r = rng(seed)
    # 1. sub drop: sine sweep 55 -> 28 Hz, 3 ms attack, decay over D
    x = np.clip(t / D, 0, 1)
    env = (1 - x) ** 1.5 * np.exp(-2.0 * x)
    a = ns(0.003)
    env[:a] *= np.linspace(0, 1, a)
    fsub = 28 + (55 - 28) * np.exp(-t / (0.28 * D))
    sub = saturate(np.sin(phase_from_freq(fsub)) * env, 1.8)
    # 2. punchy body: pitched thump (210 -> 62 Hz) + tom overtone + mid knock
    body = damped_sine(n, 62, [0.10, 0.14, 0.20][s - 1], glide=(210, 0.022), attack=0.0006)
    body += 0.45 * damped_sine(n, 118, 0.06, glide=(340, 0.012), attack=0.0005)
    body = saturate(nz(body), 2.2)
    knock = bp(noise(n, seed + 11), 160, 1100, 2) * decay_env(n, 0.030, 0.0004)
    # 3. bright transient: crack + click + metal ring (+ crash wash for 2/3)
    crack = np.stack([burst(n, seed + 21, 1700, [0.016, 0.024, 0.036][s - 1]),
                      burst(n, seed + 22, 1700, [0.016, 0.024, 0.036][s - 1])], axis=1)
    click = burst(n, seed + 23, 4500, 0.0012)
    ratios = np.array([1.0, 1.483, 2.137, 2.796, 3.413, 4.531, 5.921, 7.07]) * r.uniform(0.98, 1.02, 8)
    metal_l = modal(n, r.uniform(1050, 1250), ratios, [1, .8, .7, .6, .5, .4, .3, .25],
                    np.array([.7, .6, .5, .42, .36, .3, .25, .2]) * [0.7, 1.0, 1.4][s - 1], seed=seed + 31, detune_hz=3)
    metal_r = modal(n, r.uniform(1050, 1250), ratios, [1, .8, .7, .6, .5, .4, .3, .25],
                    np.array([.7, .6, .5, .42, .36, .3, .25, .2]) * [0.7, 1.0, 1.4][s - 1], seed=seed + 32, detune_hz=3)
    metal = np.stack([metal_l, metal_r], axis=1)
    dry = (stereo(nz(sub)) * undb(0)
           + stereo(body) * undb(-2.5)
           + stereo(nz(knock)) * undb(-11)
           + nz(crack) * undb([-5, -3, -1.5][s - 1])
           + stereo(nz(click)) * undb(-5)
           + nz(metal) * undb([-20, -17, -15][s - 1]))
    if s >= 2:
        cr = crash(n, seed + 41, tau=[0, 0.45, 0.85][s - 1])
        dry += nz(cr) * undb([0, -15, -11][s - 1])
    # 4. short dark reverb tail (sub excluded so the low end stays tight)
    send = stereo(body) * 1.0 + nz(crack) * 0.5 + nz(metal) * 0.4 + stereo(nz(knock)) * 0.4
    wet = reverb(send, "chamber_dark" if s < 3 else "hall_dark", [-12, -10, -7][s - 1], out_len=n)
    out = dry + wet
    if s == 3:
        out = widen(out, 1.25)
    desc = (f"Trailer impact S{s}: sub drop 55->28 Hz ({D:.1f} s decay, tanh-saturated), "
            f"pitched body thump 210->62 Hz + 118 Hz tom overtone + 160-1100 Hz knock, "
            f"stereo HP-noise crack + 4.5 kHz click, 8-mode inharmonic metal ring"
            + (", synthetic crash wash" if s >= 2 else "") + f", short dark {'chamber' if s < 3 else 'hall'} tail (sub kept dry). Accent = transient at sample 0.")
    return finish(out, 0, {1: -5.0, 2: -3.0, 3: -1.0}[s], "transient", desc, fout=0.4)


# ========================================================================= hit
def hit(seed=0):
    r = rng(seed)
    n = ns(0.40)
    k = r.uniform(0.96, 1.04)
    thump = saturate(nz(damped_sine(n, 58 * k, 0.075, glide=(185 * k, 0.018), attack=0.0005)), 2.0)
    knock = damped_sine(n, 880 * k, 0.008, attack=0.0002)
    clk = burst(n, seed + 1, 4200, 0.0013) + 0.6 * damped_sine(n, 3300 * k, 0.003, attack=0.0001)
    snap = bp(noise(n, seed + 2), 900, 5000, 2) * decay_env(n, 0.012, 0.0002)
    dry = (stereo(thump) + stereo(nz(knock)) * undb(-14) + stereo(nz(clk)) * undb(-7)
           + pan(nz(snap), r.uniform(-0.2, 0.2)) * undb(-12))
    wet = reverb(stereo(thump) * 0.4 + stereo(nz(clk)) * 0.5 + pan(nz(snap), 0) * 0.4, "room", -12, out_len=n)
    desc = "Tight cinematic hit: saturated thump 185->58 Hz (tau 75 ms), 880 Hz knock, 4.2 kHz click + 3.3 kHz ping, mid snap, small room. 0.4 s."
    return finish(dry + wet, 0, -7.0, "transient", desc, fout=0.12)


# ======================================================================= stamp
def stamp(seed=0):
    r = rng(seed)
    n = ns(0.30)
    k = r.uniform(0.95, 1.05)
    thud = saturate(nz(damped_sine(n, 78 * k, 0.045, glide=(150 * k, 0.010), attack=0.0006)), 1.6)
    mass = lp(noise(n, seed + 1), 320, 2) * decay_env(n, 0.028, 0.0006)
    wood = modal(n, 205 * k, [1.0, 2.02, 3.37], [1.0, 0.6, 0.35], [0.12, 0.08, 0.05], seed=seed + 2)
    slap = bp(noise(n, seed + 3), 650, 6500, 2) * decay_env(n, 0.016, 0.0003)
    slap = peak_eq(slap, 2200, 4, 0.8)
    crinkle = np.zeros(n)
    for _ in range(7):
        p = ns(r.uniform(0.002, 0.045))
        crinkle[p:p + 24] += r.uniform(0.3, 1.0) * r.standard_normal(min(24, n - p))
    crinkle = hp(crinkle, 3000) * decay_env(n, 0.03, 0.0)
    dry = (stereo(thud) + stereo(nz(mass)) * undb(-8) + stereo(nz(wood)) * undb(-13)
           + stereo(nz(slap)) * undb(-2) + pan(nz(crinkle), r.uniform(-0.3, 0.3)) * undb(-15))
    wet = reverb(stereo(nz(slap)) * 0.5 + stereo(thud) * 0.5, "room", -14, out_len=n)
    desc = "Rubber/wood stamp on paper: low thud 150->78 Hz + 320 Hz LP 'mass', 205 Hz woody modes, 0.65-6.5 kHz paper slap (+4 dB @2.2 kHz, 2 dB under the thud) with crinkle micro-clicks, small room. 0.3 s."
    return finish(dry + wet, 0, -3.5, "transient", desc, fout=0.08)


# ====================================================================== whoosh
def whoosh(dur=0.5, seed=0, direction=1):
    D = float(dur)
    big = float(np.clip((D - 0.25) / 0.25, 0, 1))
    tail = 0.10 + 0.30 * D
    n = ns(D + tail)
    t = taxis(n)
    u = t - D                                  # 0 at the cut
    wa = 0.10 * D + 0.010                      # approach width
    wd = 0.45 * wa                             # departure (faster)
    w = np.where(u < 0, wa, wd)
    env = (1.0 / (1.0 + (u / w) ** 2)) ** 0.9 * np.exp(-np.abs(u) / (1.2 * w))
    env *= np.clip((t[-1] - t) / 0.03, 0, 1)   # make sure we reach 0 at the end
    f_lo, f_pk = (650.0 - 350 * big), (4200.0 - 1400 * big)
    width = 1.05 + 0.25 * big

    def fc_at(tt):
        uu = tt - D
        ww = np.where(uu < 0, wa, wd)
        e = (1.0 / (1.0 + (uu / ww) ** 2))
        app = f_lo * (f_pk / f_lo) ** np.sqrt(e)
        dep = f_pk * (0.5 + 0.5 * np.sqrt(e))           # doppler drop after the pass
        return np.where(uu < 0, app, dep)

    def mag_air(times, freqs):
        return lognorm_band(freqs, fc_at(times), width) / (np.sqrt(np.maximum(freqs, 50) / 1000) ** 0.3)[:, None]

    def mag_whistle(times, freqs):
        return lognorm_band(freqs, 1.45 * fc_at(times), 0.16)

    def mag_body(times, freqs):
        return lognorm_band(freqs, 170 + 120 * (fc_at(times) / f_pk), 0.9)

    air = shaped_noise(n, seed * 13 + 1, mag_air)
    air2 = shaped_noise(n, seed * 13 + 2, mag_air)
    whis = shaped_noise(n, seed * 13 + 3, mag_whistle)
    body = shaped_noise(n, seed * 13 + 4, mag_body)
    snap_env = np.exp(-np.abs(u) / np.where(u < 0, 0.006, 0.005))
    snap = hp(noise(n, seed * 13 + 5), 3500, 2) * snap_env
    p = direction * 0.8 * np.tanh(u / (1.5 * wa))
    moving = (air + undb(-11) * whis) * env
    out = (pan(moving, p)
           + np.stack([air2, -air2], axis=1) * env[:, None] * undb(-12)
           + stereo(body * env ** 1.3) * undb(-8 - 10 * (1 - big))
           + pan(snap, p) * undb(-10))
    if big > 0:
        out += reverb(out, "room", -16, out_len=n) * big

    desc = (f"Air swish {D:.2f} s: STFT-shaped noise band ({width:.2f} oct) sweeping {f_lo:.0f}->{f_pk:.0f} Hz into the cut "
            f"then doppler-dropping, whistle band at 1.45x, low air body, 3.5 kHz 'snap' on the cut, constant-power pan "
            f"{'L->R' if direction > 0 else 'R->L'} crossing centre at the cut. Anchor = measured loudest point (15 ms RMS), placed on t+dur.")
    snd = finish(out, ns(D), -5.0 - 3.0 * (1 - big), "loudest", desc, fout=0.02, dc=True)
    # anchor = the actual loudest point (15 ms Hann RMS), searched +-12 ms around the design peak
    pw = (snd.data ** 2).sum(axis=1)
    k = np.hanning(ns(0.015)); k /= k.sum()
    rms = np.convolve(pw, k, mode="same")
    a0 = ns(D)
    lo, hi = a0 - ns(0.012), min(len(rms), a0 + ns(0.012))
    snd.anchor = lo + int(np.argmax(rms[lo:hi]))
    return snd


# ======================================================================= swell
def swell(dur=0.5, seed=0):
    D = float(dur)
    rel = 0.09
    n = ns(D + rel)
    t = taxis(n)
    x = np.clip(t / D, 0, 1)
    env = x ** (2.5 * max(1.0, D / 0.5))         # same final-approach steepness for any length
    after = t > D
    env[after] = (1 - np.clip((t[after] - D) / rel, 0, 1)) ** 2
    f = 36.708 * 2 ** ((-2 + 2 * x) / 12)                # bends up into D1
    ph = phase_from_freq(f)
    sub = saturate(np.sin(ph) + 0.35 * np.sin(2 * ph), 1.3) * env

    def mag(times, freqs):
        xx = np.clip(times / D, 0, 1)
        return lognorm_band(freqs, 250 * (1800 / 250) ** xx, 1.2)
    air_env = x ** (3.5 * max(1.0, D / 0.5))
    air_env[after] = env[after]
    air = np.stack([shaped_noise(n, seed + c, mag) for c in range(2)], axis=1) * air_env[:, None]
    out = stereo(nz(sub)) + nz(air) * undb(-9)
    snd = finish(out, ns(D), -8.0, "loudest", "", fout=0.0)
    # anchor = the actual loudest point: one-period (D1) boxcar RMS of the sub band, searched -20..+5 ms
    from scipy import signal as _sig
    lo_ = _sig.sosfiltfilt(_sig.butter(4, 250, fs=SR, output="sos"), snd.data.mean(axis=1))
    w = ns(1 / 36.708)
    rms = np.convolve(lo_ ** 2, np.ones(w) / w, mode="same")
    a0 = ns(D)
    lo, hi = max(0, a0 - ns(0.020)), min(len(rms), a0 + ns(0.005))
    snd.anchor = lo + int(np.argmax(rms[lo:hi]))
    snd.desc = (f"Sub/air swell {D:.2f} s: D1 sine (+octave, bends up 2 st) and 250->1800 Hz air band, power-law crescendo "
                f"into t+dur, 90 ms release. Anchor = measured loudest point (one-period RMS), "
                f"{1000 * (snd.anchor - a0) / SR:+.1f} ms from the envelope top.")
    return snd


# ======================================================================= riser
def riser(dur=2.0, seed=0, bpm=120.0):
    D = float(dur)
    n = ns(D)
    t = taxis(n)
    x = t / D
    r = rng(seed)
    beat = 60.0 / bpm
    # noise: band-pass sweeping 350 Hz -> 11 kHz, narrowing
    def mag(times, freqs):
        xx = np.clip(times / D, 0, 1)
        return lognorm_band(freqs, 350 * (11000 / 350) ** (xx ** 1.6), 1.4 - 0.8 * xx)
    nse = np.stack([shaped_noise(n, seed * 5 + c, mag) for c in range(2)], axis=1)
    nse *= undb(-34 * (1 - x) ** 0.85)[:, None]
    # detuned saws D3/A3/D4 rising two octaves, opening low-pass
    pitch = 2 ** (2 * x ** 1.7)
    cut = 600 * (9000 / 600) ** (x ** 1.3)
    L = np.zeros(n); R = np.zeros(n)
    for base in (146.832, 220.0, 293.665):
        for cents, wl in ((-11, 0.85), (0, 0.5), (9, 0.15)):
            sw = additive_saw(base * 2 ** (cents / 1200) * pitch, cut, phase0=r.uniform(0, 6.28), max_h=60)
            L += wl * sw; R += (1 - wl) * sw
    tones = np.stack([L, R], axis=1) * undb(-38 * (1 - x) ** 0.85)[:, None]
    sub = np.sin(phase_from_freq(73.416 * pitch ** 0.5)) * undb(-30 * (1 - x) ** 0.9)
    # tempo-locked tremolo: 8ths -> 16ths -> 32nds, phase-locked to the downbeat at the end
    rem = D - t
    b1 = max(beat / 2, round(D / 2 / (beat / 2)) * (beat / 2))
    b2 = max(beat / 4, round(D / 4 / (beat / 4)) * (beat / 4))
    b2 = min(b2, b1 - beat / 4) if b1 > beat / 4 else b2
    period = np.where(rem > b1, beat / 2, np.where(rem > b2, beat / 4, beat / 8))
    depth = 0.15 + 0.45 * x
    trem = 1 - depth * (0.5 - 0.5 * np.cos(2 * np.pi * rem / period))
    out = (nz(nse) * undb(-3) + nz(tones) * undb(-4)) * trem[:, None] + stereo(nz(sub)) * undb(-9)
    out = widen(out, 1.0 + 0.4 * 1)
    x2 = finish(out, n, -7.0, "end", "", fout=0.0015, fin=min(0.25 * D, 0.4))
    x2.desc = (f"Tension riser {D:.2f} s: noise band 350 Hz->11 kHz (narrowing), 9 detuned band-limited saws "
               f"(D3/A3/D4, +-10 cents) rising 2 octaves through an opening LP, rising D2 sub, exponential crescendo, "
               f"tremolo locked to {bpm:g} BPM (8ths->16ths->32nds) phase-aligned to the end; 1.5 ms cut at t+dur.")
    return x2


# ===================================================================== reverse
def reverse(dur=1.0, seed=0):
    D = float(dur)
    fwd_len = ns(D) + ns(0.05)
    tau = max(0.12, 0.45 * D)                       # ~19 dB of exponential crescendo over the reversed length
    cr = crash(fwd_len, seed + 1, tau=tau, bright=1.1)
    cr = cr + reverb(cr, "plate", -12, out_len=fwd_len)
    # 'reverse reverb': the dark hall excited by a 4 ms low burst (predelay trimmed so it also ends on the cut)
    kick = lp(noise(ns(0.004), seed + 2), 900, 2) * np.hanning(ns(0.004))
    swl = reverb(kick, "hall_dark", 0, out_len=fwd_len + ns(0.04))[ns(0.028):ns(0.028) + fwd_len]
    swl *= np.exp(-taxis(fwd_len) / max(0.25, 0.6 * D))[:, None]
    fwd = nz(cr) + nz(swl) * undb(-6)
    rev = fwd[:ns(D)][::-1].copy()
    tt = taxis(len(rev)) / D
    rev *= (tt ** 0.8)[:, None]
    desc = (f"Reverse cymbal {D:.2f} s: synthetic crash (shaped noise + 808-style square ring + 36 partials, sharp attack, "
            f"tau {tau:.2f} s) with a touch of plate, plus a 'reverse reverb' (dark hall excited by a 4 ms low burst); "
            f"time-reversed so the crash attack is the last sample, extra fade-in; 1.5 ms cut exactly at t+dur.")
    return finish(rev, len(rev), -9.0, "end", desc, fout=0.0015)


# ======================================================================== fire
def fire(dur=1.0, seed=0):
    D = float(dur)
    pre = ns(0.008)
    n = pre + ns(D + 0.15)
    t = taxis(n)
    tt = t - pre / SR
    r = rng(seed)
    env = np.where(tt < 0, np.clip(1 + tt / 0.008, 0, 1) ** 2,
                   np.exp(-np.maximum(tt, 0) / (0.38 * D)) * (0.75 + 0.25 * np.exp(-np.maximum(tt, 0) / 0.05)))
    turb = lp(noise(n, seed + 1), 9, 2)
    turb = 1 + 0.55 * turb / (np.abs(turb).max() + 1e-9)

    def mag(times, freqs):
        tm = np.maximum(times - pre / SR, 0)
        fc = 700 + 1600 * np.exp(-tm / 0.12)
        return lognorm_band(freqs, fc, 1.6)
    roar = np.stack([shaped_noise(n, seed * 3 + c, mag) for c in range(2)], axis=1) * (env * turb)[:, None]
    rumble = lp(noise(n, seed + 5), 220, 2) * env * turb
    thump = damped_sine(n, 70, 0.06, glide=(130, 0.02))
    thump = pre_pad(thump[:-pre], pre)
    crack = np.zeros((n, 2))
    # crackles: Poisson process, dense at ignition, thinning out
    tcur = 0.0
    first = True
    while True:
        lam = 45 * np.exp(-tcur / 0.5) + 8
        tcur += 0 if first else r.exponential(1 / lam)
        if tcur > D * 0.95:
            break
        p0 = pre + ns(tcur)
        ln = int(r.integers(10, 70))
        amp = (1.0 if first else min(1.0, 0.18 * r.pareto(2.2) + 0.12)) * np.exp(-tcur / 0.7)
        if not first and tcur < 0.03:
            amp *= 0.4            # keep the ignition crackle the clear accent
        g = hp(r.standard_normal(ln + 40), r.uniform(1500, 4500), 2)[:ln + 40] * np.exp(-np.arange(ln + 40) / (ln * 0.35))
        place(crack, pan(g * amp, r.uniform(-0.7, 0.7)), p0)
        if r.random() < 0.25:
            pop_ = damped_sine(ns(0.012), r.uniform(900, 2600), 0.0025) * amp * 0.6
            place(crack, pan(pop_, r.uniform(-0.6, 0.6)), p0)
        first = False
    sizzle = hp(noise(n, seed + 9), 6500, 2) * env * (0.5 + 0.5 * np.abs(lp(noise(n, seed + 10), 30)) / 0.1)
    snap = pre_pad(burst(n - pre, seed + 12, 2500, 0.003), pre)      # ignition snap = the accent
    out = (nz(roar) + stereo(nz(rumble)) * undb(-9) + stereo(nz(thump)) * undb(-12)
           + nz(crack) * undb(-5) + stereo(nz(sizzle)) * undb(-22) + stereo(nz(snap)) * undb(-2))
    out += reverb(out, "room", -14, out_len=n)
    desc = (f"Ember/fire whoosh {D:.1f} s: 8 ms ignition flare + 2.5 kHz ignition snap at the anchor, turbulent noise roar (band falls 2.3 kHz->700 Hz) "
            f"+ LP rumble + 70 Hz thump, Poisson crackles (45/s -> 8/s) with occasional resonant pops, HF sizzle, room.")
    return finish(out, pre, -7.0, "transient", desc, fout=0.25)


# ======================================================================== coin
def _clink(n, f0, seed):
    r = rng(seed)
    ratios = np.array([1.0, 1.47, 2.03, 2.61, 3.20, 3.88, 4.62]) * r.uniform(0.985, 1.015, 7)
    amps = np.array([1, .7, .55, .45, .35, .25, .2]) * r.uniform(0.6, 1.0, 7)
    t60 = np.array([0.9, .7, .55, .45, .38, .3, .25])
    ring = modal(n, f0, ratios, amps, t60, seed=seed + 1, detune_hz=2.5, attack=0.0002)
    contact = burst(n, seed + 2, 6000, 0.0008)
    return nz(ring) + 0.6 * nz(contact)


def coin(seed=0):
    r = rng(seed)
    n = ns(1.2)
    out = np.zeros((n, 2))
    for dt, f0, g, p in ((0.0, 2900, 0, -0.25), (0.075 + r.uniform(-0.01, 0.01), 2450, -4, 0.3),
                         (0.165 + r.uniform(-0.01, 0.01), 3300, -9, -0.1)):
        c = _clink(n - ns(dt), f0 * r.uniform(0.97, 1.03), seed + int(f0))
        place(out, pan(c, p) * undb(g), ns(dt))
    t = taxis(n)
    sh = np.zeros((n, 2))
    env = (1 - np.exp(-t / 0.05)) * t60_env(n, 1.0, 0.0)
    for i in range(12):
        f = np.exp(r.uniform(np.log(6500), np.log(11000)))
        tw = np.abs(lp(r.standard_normal(n), r.uniform(6, 12), 2))
        tw = tw / (tw.max() + 1e-9)
        sh += pan(np.sin(2 * np.pi * f * t + r.uniform(0, 6.28)) * tw ** 2 * env, r.uniform(-0.8, 0.8))
    chime = (damped_sine(n, 1760.0, 0.9 / 6.9) + 0.8 * pad_to(np.r_[np.zeros(ns(0.04)), damped_sine(n, 2349.3, 0.8 / 6.9)], n))
    out = nz(out) + nz(sh) * undb(-17) + stereo(nz(chime)) * undb(-24)
    out += reverb(out, "plate", -10, out_len=n)
    desc = ("Silver coin shimmer: three modal coin clinks (7 inharmonic disc modes, f0 2.45-3.3 kHz, beating pairs) at 0 / ~75 / ~165 ms, "
            "12-partial 6.5-11 kHz twinkle shimmer tail, a faint A6+D7 glass chime, bright plate. 1.2 s.")
    return finish(out, 0, -7.0, "transient", desc, fout=0.3)


# ======================================================================= anvil
def anvil(seed=0, f0=587.33):
    r = rng(seed)
    n = ns(2.0)
    ratios = [1.0, 2.76, 5.40, 8.93, 13.3]
    amps = [1.0, 0.65, 0.5, 0.32, 0.2]
    t60 = [1.5, 1.15, 0.8, 0.55, 0.38]
    ringL = modal(n, f0, ratios, amps, t60, seed=seed + 1, detune_hz=1.2, attack=0.0002)
    ringR = modal(n, f0, ratios, amps, t60, seed=seed + 2, detune_hz=1.2, attack=0.0002)
    ring = np.stack([ringL, ringR], axis=1)
    clang = modal(n, 1.0, [3710, 4930, 6280, 9120], [1, .8, .6, .4], [.15, .12, .1, .08], seed=seed + 3)
    hammer = burst(n, seed + 4, 3000, 0.0006)
    body = damped_sine(n, 140, 0.06, glide=(210, 0.012)) + 0.5 * nz(lp(noise(n, seed + 5), 400) * decay_env(n, 0.025))
    sparks = np.zeros((n, 2))
    for i in range(18):
        tt = 0.02 + r.exponential(0.12)
        if tt > 0.6:
            continue
        ln = int(r.integers(8, 26))
        g = hp(r.standard_normal(ln + 30), 5000, 2) * np.exp(-np.arange(ln + 30) / (ln * 0.4))
        place(sparks, pan(g * np.exp(-tt / 0.25) * r.uniform(0.4, 1.0), r.uniform(-0.8, 0.8)), ns(tt))
    out = (nz(ring) + stereo(nz(clang)) * undb(-9) + stereo(nz(hammer)) * undb(-5)
           + stereo(nz(body)) * undb(-7) + nz(sparks) * undb(-17))
    out += reverb(nz(ring) * 0.6 + stereo(nz(body)) * 0.5, "hall_dark", -12, out_len=n)
    desc = (f"Blacksmith anvil: modal synthesis, partials {', '.join(str(x) for x in ratios)} x {f0:.1f} Hz (D5) with beating pairs, "
            f"T60 1.5 s -> 0.38 s (higher modes die faster), L/R decorrelated; 3.7-9.1 kHz clang modes, 0.6 ms hammer click, "
            f"210->140 Hz body + LP thud, 18 spark micro-crackles, dark hall.")
    return finish(out, 0, -3.5, "transient", desc, fout=0.35)


# ===================================================================== sparkle
def _chime(n, f, t60):
    c = damped_sine(n, f, t60 / 6.9, attack=0.0005)
    if 2.76 * f < 19000:
        c += 0.3 * damped_sine(n, 2.76 * f, t60 / 6.9 * 0.35, attack=0.0005)
    if 5.4 * f < 19000:
        c += 0.12 * damped_sine(n, 5.4 * f, t60 / 6.9 * 0.2, attack=0.0005)
    return c


def sparkle(seed=0):
    r = rng(seed)
    n = ns(0.85)
    ladder = [note_hz(nm, o) for o in (6, 7) for nm in PENTA]
    start = int(r.integers(0, 3))
    direction = 1 if seed % 2 == 0 else -1
    out = np.zeros((n, 2))
    tcur = 0.0
    gap = 0.055
    count = 7
    for i in range(count):
        f = ladder[start + i]
        if i > 0:
            tcur += gap * r.uniform(0.78, 1.22)
            gap *= 0.93
        amp = undb(-1.2 * i + r.uniform(-1, 1)) if i else 1.0
        c = _chime(n - ns(tcur), f, 0.5 * (1500 / f) ** 0.4)
        place(out, pan(c * amp, direction * (-0.5 + 1.1 * i / (count - 1))), ns(tcur))
    glit = np.zeros((n, 2))
    for i in range(25):
        tt = r.uniform(0.005, 0.5)
        g = hp(r.standard_normal(40), 8000, 2) * np.exp(-np.arange(40) / 8)
        place(glit, pan(g * r.uniform(0.3, 1), r.uniform(-0.9, 0.9)), ns(tt))
    out = nz(out) + nz(glit) * undb(-16)
    out += reverb(out, "plate", -8, out_len=n)
    desc = "Magic sparkle: 7 quick ascending bell chimes on D-minor pentatonic (D6..A7 ladder, sine + 2.76x/5.4x partials), ~55 ms accelerating spacing with +-22% random micro-timing, panned across, 25 HF glitter ticks, bright plate. Accent = first chime."
    return finish(out, 0, -12.0, "transient", desc, fout=0.3)


# ======================================================================= glint
def glint(seed=0, note=("D", 7)):
    r = rng(seed)
    pre = ns(0.06)
    n = pre + ns(0.5)
    f = note_hz(*note)
    ping = (damped_sine(n - pre, f, 0.45 / 6.9, attack=0.0004) + damped_sine(n - pre, f + 2.2, 0.45 / 6.9, attack=0.0004, phase=1.0)) * 0.5
    ping += 0.35 * damped_sine(n - pre, 2.76 * f, 0.12 / 6.9, attack=0.0004)
    if 5.4 * f < 19000:
        ping += 0.15 * damped_sine(n - pre, 5.4 * f, 0.06 / 6.9, attack=0.0004)
    ping = pre_pad(ping, pre)
    t = taxis(n)
    u = t - pre / SR
    sheen_env = np.where(u < 0, np.clip((u + 0.06) / 0.06, 0, 1) ** 3, np.exp(-np.maximum(u, 0) / 0.004))
    sheen = hp(noise(n, seed + 1), 7000, 2) * sheen_env
    ticks = np.zeros((n, 2))
    for dt in (0.015, 0.04, 0.07):
        g = hp(r.standard_normal(30), 9000, 2) * np.exp(-np.arange(30) / 6)
        place(ticks, pan(g, r.uniform(-0.6, 0.6)), pre + ns(dt + r.uniform(-0.004, 0.004)))
    out = stereo(nz(ping)) + stereo(nz(sheen)) * undb(-24) + nz(ticks) * undb(-20)
    out += reverb(out, "plate", -9, out_len=n)
    desc = f"Glint: bright {note_label(*note)} ({f:.0f} Hz) ping as a 2.2 Hz beating pair + 2.76x/5.4x metallic partials, a soft 60 ms HF 'sheen' leading into the ping, 3 micro-glitter ticks, plate. Accent = ping."
    return finish(out, pre, -11.0, "transient", desc, fout=0.15)


# ========================================================================= zap
def zap(seed=0):
    r = rng(seed)
    n = ns(0.5)
    t = taxis(n)
    crack = burst(n, seed + 1, 2500, 0.003)
    # buzzing arc: S&H jittered fundamental, band-limited saw, random gate
    f = np.empty(n)
    i = 0
    while i < n:
        ln = ns(r.uniform(0.004, 0.015))
        f[i:i + ln] = r.uniform(70, 160)
        i += ln
    f = lp(f, 300, 1)
    arc = hp(additive_saw(f, np.full(n, 6000.0), phase0=0, max_h=70), 300, 2)
    gate = np.zeros(n)
    i = 0
    while i < n:
        ln = ns(r.uniform(0.003, 0.025))
        on = r.random() < 0.85 * np.exp(-i / SR / 0.25)
        gate[i:i + ln] = 1.0 if on else 0.0
        i += ln
    gate[:ns(0.02)] = 1.0
    gate = lp(gate, 900, 1)
    sizzle = hp(noise(n, seed + 2), 3500, 2) * lp(np.roll(gate, ns(0.002)), 900, 1)
    env = decay_env(n, 0.12, 0.0002)
    zing = np.sin(phase_from_freq(900 + 2300 * np.exp(-t / 0.05) + 40 * np.sin(2 * np.pi * 37 * t))) * decay_env(n, 0.07, 0.0003)
    thump = damped_sine(n, 85, 0.045, glide=(160, 0.012))
    pans = np.repeat(r.uniform(-0.7, 0.7, n // ns(0.02) + 1), ns(0.02))[:n]
    pans = lp(pans, 40, 1)
    out = (stereo(nz(crack)) + pan(nz(arc * gate * env), pans) * undb(-3) + pan(nz(sizzle * env), -pans) * undb(-6)
           + stereo(nz(zing)) * undb(-13) + stereo(nz(thump)) * undb(-8))
    out += reverb(out, "plate", -14, out_len=n)
    desc = "Electric zap: 2.5 kHz HP crack, gated buzzing arc (band-limited saw with sample-and-hold 70-160 Hz jitter, thinning random gate), sizzle bursts, 3.2k->900 Hz 'zing', 85 Hz thump, bursts arc across the stereo field, plate. 0.5 s."
    return finish(out, 0, -7.0, "transient", desc, fout=0.12)


# ======================================================================= click
def _click_part(n, k, amp, low=True, seed=0):
    x = (damped_sine(n, 3100 * k, 0.0014, attack=0.0001)
         + 0.5 * damped_sine(n, 5900 * k, 0.0007, attack=0.0001)
         + 0.45 * damped_sine(n, 1150 * k, 0.0030, attack=0.0002)
         + 0.35 * nz(burst(n, seed, 4500, 0.0005)))
    if low:
        x += 0.22 * damped_sine(n, 190, 0.006, attack=0.0006)
    return x * amp


def click(seed=0):
    r = rng(seed)
    n = ns(0.15)
    k = r.uniform(0.97, 1.03)
    x = np.zeros(n)
    x += _click_part(n, k, 1.0, True, seed + 1)
    rel = ns(0.035 + r.uniform(-0.003, 0.003))
    x[rel:] += _click_part(n - rel, k * 1.12, undb(-5), False, seed + 2)
    out = stereo(nz(x))
    out += reverb(out, "room", -22, out_len=n)
    desc = "UI mouse click: press + release ~35 ms later (release +12% pitch, -5 dB); each = 3.1/5.9 kHz plastic resonances + 1.15 kHz body + 0.5 ms HP tick (press adds a 190 Hz micro-thock), whisper of room."
    return finish(out, 0, -10.0, "transient", desc, fout=0.03)


# ========================================================================= key
def key(seed=0, space=False):
    r = rng(seed)
    n = ns(0.16)
    k = r.uniform(0.93, 1.07) * (0.8 if space else 1.0)
    def part(m, kk, amp, thock):
        x = (damped_sine(m, 1850 * kk, 0.0022, attack=0.0002)
             + 0.6 * damped_sine(m, 3500 * kk, 0.0011, attack=0.0001)
             + 0.5 * nz(bp(noise(m, seed + int(kk * 1000)), 1500, 7000) * decay_env(m, 0.0012, 0.0001)))
        if thock:
            x += (0.6 if space else 0.35) * damped_sine(m, (230 if space else 380) * kk, 0.009 if space else 0.005, attack=0.0004)
        return x * amp
    x = part(n, k, 1.0, True)
    if space:
        for dt in (0.005, 0.011):
            x[ns(dt):] += 0.25 * part(n - ns(dt), k * 1.3, 1.0, False)
    rel = ns(r.uniform(0.045, 0.07))
    x[rel:] += part(n - rel, k * 1.08, undb(-10 + (2 if space else 0)), False)
    out = pan(nz(x), r.uniform(-0.15, 0.15))
    out += reverb(out, "room", -24, out_len=n)
    lvl = -12.0 + r.uniform(-1.5, 1.5)
    desc = ("Keystroke: soft mechanical tick (1.85/3.5 kHz damped modes + band noise) with a 380 Hz bottom-out thock and a "
            "-10 dB release 45-70 ms later; per-key seeded pitch (+-7%), level (+-1.5 dB), release timing and pan" + (
                "; SPACE variant: lower 230 Hz thock + stabiliser rattle." if space else "."))
    return finish(out, 0, lvl, "transient", desc, fout=0.03)


# ========================================================================= pop
def pop(note="D", octave=5, seed=0):
    r = rng(seed)
    n = ns(0.10)
    f = note_hz(note, octave) * r.uniform(0.997, 1.003)
    t = taxis(n)
    finst = f * (1 + 0.06 * np.exp(-t / 0.012))       # ~1 semitone drop
    ph = phase_from_freq(finst)
    tone = np.sin(ph) + 0.18 * np.sin(2 * ph) + 0.05 * np.sin(3 * ph)
    att = ns(0.0015)
    env = np.exp(-np.maximum(t - att / SR, 0) / 0.030)
    env[:att] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, att))
    pluck = lp(noise(n, seed + 1), 4000) * decay_env(n, 0.0015, 0.0002)
    x = tone * env + 0.12 * nz(pluck)
    x = fade(x, 0, 0.02)
    m = ns(0.25)
    x = pad_to(x, m)
    out = stereo(nz(x))
    out += reverb(out, "room", -20, out_len=m)
    desc = f"UI pop {note_label(note, octave)} ({f:.0f} Hz): round sine bloop (+2nd/3rd harmonic) with a ~1 semitone pitch drop in 12 ms, 1.5 ms soft attack, 30 ms decay (~80 ms), tiny LP pluck noise, whisper of room."
    return finish(out, att, -15.0, "transient", desc, fout=0.05)


# ======================================================================== tick
def tick(seed=0):
    r = rng(seed)
    n = ns(0.020)
    k = r.uniform(0.96, 1.04)
    x = (damped_sine(n, 6300 * k, 0.0011, attack=0.00008)
         + 0.45 * damped_sine(n, 9400 * k, 0.0006, attack=0.00008)
         + 0.25 * nz(burst(n, seed + 1, 6000, 0.0003, 0.00005)))
    out = pan(nz(x), r.uniform(-0.1, 0.1))
    desc = "Counter tick: dry 6.3 kHz + 9.4 kHz damped modes with a 0.3 ms HP noise tick, ~15 ms, seeded +-4% pitch."
    return finish(out, 0, -17.0, "transient", desc, fout=0.005, dc=False)


RECIPES = {
    "impact": impact, "hit": hit, "stamp": stamp, "whoosh": whoosh, "swell": swell,
    "riser": riser, "reverse": reverse, "fire": fire, "coin": coin, "anvil": anvil,
    "sparkle": sparkle, "glint": glint, "zap": zap, "click": click, "key": key,
    "pop": pop, "tick": tick,
}
