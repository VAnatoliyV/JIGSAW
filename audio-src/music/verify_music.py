#!/usr/bin/env python3
"""Objective verification of the rendered score (nobody can listen to it).

Checks: duration / rate / peaks / true peak / integrated loudness (pyloudnorm
and ffmpeg ebur128), per-bar loudness curve, spectral-flux onsets at every
accent event, stems (non-silent, sum == pre-limiter mix), presets, VO-band
occupancy of the melody stem, final Picardy chord, tail silence, MIDI grid.
Writes music_verification.txt and spectrogram.png next to the mix.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dsp  # noqa: E402
import score as sc_mod  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TIMELINE = os.path.join(ROOT, 'timeline', 'timeline.json')
OUT_DIR = os.path.join(ROOT, 'assets', 'audio', 'music')
MIX = os.path.join(OUT_DIR, 'music_mix.wav')
STEM_DIR = os.path.join(OUT_DIR, 'stems')
STEMS = ['drums_perc', 'low', 'strings', 'brass', 'choir_pads', 'melody', 'fx_hits']
SR = 48000

_lines = []


def out(s=''):
    print(s)
    _lines.append(s)


def db(x):
    return 20 * np.log10(max(float(x), 1e-12))


def ffmpeg_ebur128(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-filter_complex',
                        'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True)
    txt = r.stderr
    summ = txt[txt.rfind('Summary:'):]
    i = re.search(r'I:\s+(-?[\d.]+) LUFS', summ)
    lra = re.search(r'LRA:\s+(-?[\d.]+) LU', summ)
    tp = re.search(r'Peak:\s+(-?[\d.]+) dBFS', summ)
    return (float(i.group(1)) if i else None, float(lra.group(1)) if lra else None,
            float(tp.group(1)) if tp else None)


def section_of(t, tl):
    for s in tl['sections']:
        if s['start'] <= t < s['end']:
            return s['name']
    return tl['sections'][-1]['name']


def spectral_flux(mono, n_fft=512, hop=48):
    f, t, Z = signal.stft(mono, fs=SR, nperseg=n_fft, noverlap=n_fft - hop, boundary='zeros', padded=True)
    band = (f >= 30) & (f <= 12000)
    mag = np.abs(Z[band]) ** 0.5
    flux = np.maximum(0, np.diff(mag, axis=1)).sum(axis=0)
    # diff between frame k-1 and k is attributed to frame k (its centre time)
    return t[1:], flux


def accent_events(tl):
    evs = []
    for e in tl['events']:
        if (e['type'] == 'impact' and e.get('strength', 0) >= 2) or e['type'] in ('hit', 'stamp'):
            evs.append(e)
    return evs


def main():
    tl = json.load(open(TIMELINE))
    x, sr = sf.read(MIX, dtype='float64', always_2d=True)
    info = sf.info(MIX)
    out('=' * 78)
    out('ALBION JOURNAL MUSIC -- VERIFICATION')
    out('=' * 78)

    # ------------------------------------------------------------------ 1
    out('\n[1] FORMAT / LEVELS')
    dur = len(x) / sr
    out(f'  file          : {MIX}')
    out(f'  format        : {info.subtype}, {sr} Hz, {x.shape[1]} ch')
    out(f'  duration      : {dur:.6f} s  ({len(x)} samples)  -> {"OK" if abs(dur - 120) <= 0.001 else "FAIL"}')
    sp = np.abs(x).max()
    tp = dsp.true_peak(x)
    L = dsp.integrated_loudness(x)
    fI, fLRA, fTP = ffmpeg_ebur128(MIX)
    out(f'  sample peak   : {db(sp):.2f} dBFS')
    out(f'  true peak 4x  : {db(tp):.2f} dBTP  -> {"OK" if db(tp) <= -1.0 else "FAIL"}')
    out(f'  integrated    : {L:.2f} LUFS (pyloudnorm)  |  ffmpeg ebur128: I={fI} LUFS, LRA={fLRA} LU, TP={fTP} dBTP')
    tail = x[int(119.8 * sr):]
    pre_tail = x[int(119.3 * sr):int(119.8 * sr)]
    out(f'  last 0.2 s    : max |x| = {np.abs(tail).max():.2e}  -> {"silent OK" if np.abs(tail).max() == 0 else "FAIL"}')
    out(f'  119.3-119.8 s : RMS {db(np.sqrt((pre_tail ** 2).mean())):.1f} dBFS (near-silence before the cut)')

    # ------------------------------------------------------------------ 2
    out('\n[2] LOUDNESS CURVE PER BAR  (bar LUFS = K-weighted energy over the 2 s bar;'
        ' ST = short-term 3 s; M = momentary 0.4 s)')
    st_t, st = dsp.window_loudness(x, 3.0, 0.1)
    m_t, mm = dsp.window_loudness(x, 0.4, 0.05)
    out(f'  {"bar":>3s} {"t0":>6s} {"section":10s} {"barLUFS":>8s} {"ST@end":>7s} {"STmax":>6s} {"Mmax":>6s}  graph')
    bar_l = []
    for b in range(1, 61):
        t0, t1 = (b - 1) * 2.0, b * 2.0
        lb = dsp.segment_loudness(x, t0, t1)
        bar_l.append(lb)
        st_end = st[np.argmin(np.abs(st_t - t1))] if t1 >= 3.0 else float('nan')
        sel = (st_t > t0) & (st_t <= t1)
        stmax = st[sel].max() if sel.any() else float('nan')
        msel = (m_t > t0) & (m_t <= t1 + 1e-9)
        mmax = mm[msel].max() if msel.any() else float('nan')
        bars = '#' * int(max(0, (lb + 40)))
        out(f'  {b:3d} {t0:6.1f} {section_of(t0, tl):10s} {lb:8.1f} {st_end:7.1f} {stmax:6.1f} {mmax:6.1f}  {bars}')
    bl = np.array(bar_l)

    def avg(b0, b1):
        return 10 * np.log10(np.mean(10 ** (bl[b0 - 1:b1] / 10)))
    shape = [('hook bars 1-3', 1, 3), ('hook bars 4-6', 4, 6), ('build 7-8', 7, 8), ('drop 9-16', 9, 16),
             ('feat1 17-24', 17, 24), ('feat2 25-32', 25, 32), ('feat3 33-40', 33, 40),
             ('montage 41-44', 41, 44), ('breakdown 45-48', 45, 48), ('bar 49 hit', 49, 49),
             ('metric 50-52', 50, 52), ('finale 53-58', 53, 58), ('outro 59-60', 59, 60)]
    out('\n  section averages (energy mean of bar LUFS):')
    for nm, a, b in shape:
        out(f'    {nm:16s} {avg(a, b):6.1f} LUFS')
    checks = [
        ('hook 1-3 quieter than drop 9-16', avg(1, 3) < avg(9, 16) - 3),
        ('build 7-8 louder than bars 4-6', avg(7, 8) > avg(4, 6)),
        ('features quieter than drop', max(avg(17, 24), avg(25, 32), avg(33, 40)) < avg(9, 16)),
        ('breakdown 45-48 clearly quieter than drop/finale', avg(45, 48) < min(avg(9, 16), avg(53, 58)) - 4),
        ('bar 49 louder than breakdown', avg(49, 49) > avg(45, 48) + 4),
        ('finale 53-58 is the loudest section (multi-bar sections)', avg(53, 58) >= max(avg(a, b) for _, a, b in shape if b > a and (a, b) != (53, 58)) - 0.01),
        ('bar 49 hit >= drop average (huge hit)', avg(49, 49) >= avg(9, 16)),
        ('outro decays (bar 60 < bar 59 - 10 dB)', bl[59] < bl[58] - 10),
    ]
    for nm, ok in checks:
        out(f'    [{"OK" if ok else "!!"}] {nm}')

    # ------------------------------------------------------------------ 3
    out('\n[3] ACCENT TIMING (spectral flux, 512-pt STFT, 1 ms hop, search +/-60 ms)')
    mono = x.mean(axis=1)
    ft, flux = spectral_flux(mono)
    rows = []
    for e in accent_events(tl):
        t = e['t']
        sel = (ft >= t - 0.06) & (ft <= t + 0.06)
        k = np.argmax(flux[sel])
        tm = ft[sel][k]
        loc = (ft >= t - 0.5) & (ft <= t + 0.5)
        prom = flux[sel][k] / (np.median(flux[loc]) + 1e-12)
        rows.append((t, e['type'], e.get('strength', ''), e.get('note', ''), tm, (tm - t) * 1000, prom))
    out(f'  {"event t":>8s} {"type":7s} {"str":>3s} {"label":24s} {"measured":>9s} {"delta ms":>8s} {"flux/median":>11s}')
    for r in rows:
        flag = 'OK' if abs(r[5]) <= 15 else '!!'
        out(f'  {r[0]:8.3f} {r[1]:7s} {str(r[2]):>3s} {r[3][:24]:24s} {r[4]:9.4f} {r[5]:8.1f} {r[6]:11.1f}  {flag}')
    deltas = np.array([r[5] for r in rows])
    out(f'  -> {len(rows)} accents, mean delta {deltas.mean():+.1f} ms, max |delta| {np.abs(deltas).max():.1f} ms, '
        f'{int((np.abs(deltas) <= 15).sum())}/{len(rows)} within +/-15 ms')

    # ------------------------------------------------------------------ 4
    out('\n[4] STEMS')
    stems = {}
    for s in STEMS:
        p = os.path.join(STEM_DIR, s + '.wav')
        y, ssr = sf.read(p, dtype='float64', always_2d=True)
        stems[s] = y
        st_info = sf.info(p)
        secs = []
        for sec in tl['sections']:
            seg = y[int(sec['start'] * ssr):int(sec['end'] * ssr)]
            secs.append(db(np.sqrt((seg ** 2).mean())))
        silent = max(secs) < -60
        out(f'  {s:11s} {st_info.subtype:5s} {ssr} Hz {y.shape[1]}ch {len(y) / ssr:.6f}s  peak {db(np.abs(y).max()):6.1f} dBFS  '
            f'{"SILENT!" if silent else "ok"}')
        out('      RMS/section: ' + ' '.join(f'{sec["name"][:5]}={v:5.1f}' for sec, v in zip(tl['sections'], secs)))
    ssum = sum(stems.values())
    out(f'  sum of stems: integrated {dsp.integrated_loudness(ssum):.2f} LUFS, true peak {db(dsp.true_peak(ssum)):.2f} dBTP (pre-limiter)')
    resid = x - ssum
    out(f'  mix - sum(stems): residual RMS {db(np.sqrt((resid ** 2).mean())):.1f} dBFS '
        f'(= limiter action only), correlation {np.corrcoef(x.ravel(), ssum.ravel())[0, 1]:.5f}')

    # ------------------------------------------------------------------ 5
    out('\n[5] PRESETS (expected name vs SoundFont preset at that bank/program)')
    pj = os.path.join(OUT_DIR, 'music_presets.json')
    sys.path.insert(0, HERE)
    from build_music import SF2, sf2_presets
    sfp = sf2_presets(SF2)
    allok = True
    for r in json.load(open(pj)):
        name = sfp.get((r['bank'], r['program']))
        ok = name == r['wanted'] and 'piano' not in name.lower()
        allok &= ok
        out(f'  {r["part"]:11s} {r["stem"]:11s} bank {r["bank"]:3d} prog {r["program"]:3d}  {r["wanted"]:20s} -> {name:20s} {"OK" if ok else "!!"}')
    out(f'  -> all presets resolved without fallback: {allok} (FluidSynth logs are also scanned for '
        f'"not found/substituted" during the build)')

    # ------------------------------------------------------------------ 6
    out('\n[6] VOICE-OVER BAND (1-4 kHz) -- melody stem level during VO vs. in gaps')
    mel = stems['melody'].mean(axis=1)
    sos = signal.butter(4, [1000, 4000], 'bandpass', fs=SR, output='sos')
    mb = signal.sosfilt(sos, mel)
    allb = signal.sosfilt(sos, ssum.mean(axis=1))
    vo = sc_mod.vo_windows(tl)
    mask = np.zeros(len(mb), bool)
    for a, b, _ in vo:
        mask[int(a * SR):int(b * SR)] = True
    fmask = np.zeros(len(mb), bool)        # feature sections only (16-80 s, 88-104 s)
    for a, b in ((32, 80), (88, 104)):
        fmask[int(a * SR):int(b * SR)] = True
    def rms(v, m):
        return db(np.sqrt((v[m] ** 2).mean())) if m.any() else float('nan')
    out(f'  melody 1-4k, whole film : VO {rms(mb, mask):6.1f} dBFS | no-VO {rms(mb, ~mask):6.1f} dBFS')
    out(f'  melody 1-4k, features   : VO {rms(mb, mask & fmask):6.1f} dBFS | no-VO {rms(mb, ~mask & fmask):6.1f} dBFS')
    out(f'  full music 1-4k         : VO {rms(allb, mask):6.1f} dBFS | no-VO {rms(allb, ~mask):6.1f} dBFS')
    out('  per line (melody 1-4k RMS while the line plays):')
    for a, b, vid in vo:
        m = np.zeros(len(mb), bool)
        m[int(a * SR):int(b * SR)] = True
        out(f'    {vid:4s} {a:6.2f}-{b:6.2f}s  melody {rms(mb, m):6.1f} dBFS   music total {rms(allb, m):6.1f} dBFS')

    # ------------------------------------------------------------------ 7
    out('\n[7] HARMONY CHECK -- final chord (116.1-117.5 s): chroma energy')
    seg = mono[int(116.1 * SR):int(117.5 * SR)]
    F = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    fr = np.fft.rfftfreq(len(seg), 1 / SR)
    chroma = np.zeros(12)
    sel = (fr > 70) & (fr < 1500)
    pcs = np.round(12 * np.log2(fr[sel] / 440.0) + 69).astype(int) % 12
    np.add.at(chroma, pcs, F[sel] ** 2)
    chroma /= chroma.max()
    names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    out('  ' + ' '.join(f'{n}:{v:.2f}' for n, v in zip(names, chroma)))
    out(f'  F# / F ratio = {chroma[6] / max(chroma[5], 1e-9):.1f}  -> {"D MAJOR (Picardy) OK" if chroma[6] > 3 * chroma[5] else "!!"}')

    # ------------------------------------------------------------------ 8
    out('\n[8] MIDI GRID / TEMPO (music_mix.mid)')
    import mido
    mid = mido.MidiFile(os.path.join(OUT_DIR, 'music_mix.mid'))
    tempos = set()
    sigs = set()
    off = 0
    non = 0
    for tr in mid.tracks:
        tk = 0
        for m in tr:
            tk += m.time
            if m.type == 'set_tempo':
                tempos.add(m.tempo)
            if m.type == 'time_signature':
                sigs.add((m.numerator, m.denominator))
            if m.type == 'note_on' and m.velocity > 0:
                non += 1
                if tk % 120:                     # 32nd note = 120 ticks @ 960 tpb
                    off += 1
    out(f'  tempo events: {sorted(tempos)} us/beat (500000 = 120 BPM), time signature {sorted(sigs)}')
    out(f'  {non} note-ons, {off} off the 32nd-note grid -> {"OK" if off == 0 else "!!"}')
    out(f'  tracks: {len(mid.tracks)} (conductor + one per part), length {mid.length:.2f} s')

    # ------------------------------------------------------------------ 9
    out('\n[9] LOW END -- sub band (<60 Hz) punch vs smear: 50 ms RMS envelope p90/p10 per section')
    sos = signal.butter(4, 60, 'lowpass', fs=SR, output='sos')
    lo = signal.sosfilt(sos, mono)
    e = np.sqrt((lo[:len(lo) // 2400 * 2400].reshape(-1, 2400) ** 2).mean(axis=1))
    for s in tl['sections']:
        seg = e[int(s['start'] * 20):int(s['end'] * 20)]
        out(f'  {s["name"]:10s} sub RMS {db(np.sqrt((seg ** 2).mean())):6.1f} dBFS   p90/p10 {db(np.percentile(seg, 90) / max(np.percentile(seg, 10), 1e-9)):5.1f} dB')
    sos2 = signal.butter(4, [60, 250], 'bandpass', fs=SR, output='sos')
    sos3 = signal.butter(4, [250, 4000], 'bandpass', fs=SR, output='sos')
    sos4 = signal.butter(4, 4000, 'highpass', fs=SR, output='sos')
    out('  spectral balance per section (dB re. 250-4k band): <60 | 60-250 | >4k')
    b1, b2, b3, b4 = (signal.sosfilt(q, mono) for q in (sos, sos2, sos3, sos4))
    for s in tl['sections']:
        i0, i1 = int(s['start'] * SR), int(s['end'] * SR)
        r = [db(np.sqrt((bb[i0:i1] ** 2).mean())) for bb in (b1, b2, b3, b4)]
        out(f'  {s["name"]:10s} {r[0] - r[2]:6.1f} | {r[1] - r[2]:6.1f} | {r[3] - r[2]:6.1f}')

    # ------------------------------------------------------------------ 10
    out('\n[10] STEREO IMAGE (L/R balance, inter-channel correlation)')
    def img(y):
        l, r = y[:, 0], y[:, 1]
        bal = db(np.sqrt((l ** 2).mean())) - db(np.sqrt((r ** 2).mean()))
        corr = float(np.corrcoef(l, r)[0, 1])
        return bal, corr
    for s in STEMS:
        bal, corr = img(stems[s])
        out(f'  {s:11s} L-R balance {bal:+5.1f} dB   correlation {corr:5.2f}')
    bal, corr = img(x)
    out(f'  {"MIX":11s} L-R balance {bal:+5.1f} dB   correlation {corr:5.2f}   mono fold-down loss '
        f'{dsp.integrated_loudness(np.repeat(x.mean(axis=1, keepdims=True), 2, axis=1)) - L:+.1f} LU')

    # ------------------------------------------------------------------ spectrogram
    make_spectrogram(x, tl, bl)
    out(f'\nspectrogram: {os.path.join(OUT_DIR, "spectrogram.png")}')
    with open(os.path.join(OUT_DIR, 'music_verification.txt'), 'w') as f:
        f.write('\n'.join(_lines) + '\n')


def make_spectrogram(x, tl, bar_l):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    mono = x.mean(axis=1)
    f, t, Z = signal.stft(mono, fs=SR, nperseg=4096, noverlap=4096 - 1024)
    S = 20 * np.log10(np.abs(Z) + 1e-9)
    S -= S.max()
    fig, axes = plt.subplots(4, 1, figsize=(26, 15), dpi=90, gridspec_kw=dict(height_ratios=[5, 1.3, 1.3, 1.3]), sharex=True)
    ax = axes[0]
    sel = f >= 20
    ax.pcolormesh(t, f[sel], S[sel], shading='auto', cmap='magma', vmin=-80, vmax=0)
    ax.set_yscale('log')
    ax.set_ylim(20, 22000)
    ax.set_ylabel('Hz')
    ax.set_title('Albion Journal score -- music_mix.wav (log-frequency spectrogram, sections and accent events marked)')
    for s in tl['sections']:
        for a in axes:
            a.axvline(s['start'], color='cyan', lw=0.8, alpha=0.7)
        ax.text(s['start'] + 0.2, 15000, s['name'], color='cyan', fontsize=10)
    for e in accent_events(tl):
        ax.axvline(e['t'], color='white', lw=0.5, alpha=0.35, ls='--')
    ax2 = axes[1]
    env_t = np.arange(0, len(mono) // 480) * 0.01
    env = np.sqrt((mono[:len(env_t) * 480].reshape(-1, 480) ** 2).mean(axis=1))
    pk = np.abs(mono[:len(env_t) * 480]).reshape(-1, 480).max(axis=1)
    ax2.fill_between(env_t, -pk, pk, color='#7aa6c2', lw=0)
    ax2.fill_between(env_t, -env, env, color='#1f4e79', lw=0)
    ax2.set_ylim(-1, 1)
    ax2.set_ylabel('wave')
    ax3 = axes[2]
    ax3.step(np.arange(60) * 2.0, bar_l, where='post', color='#c0392b')
    ax3.set_ylabel('bar LUFS')
    ax3.set_ylim(-45, -5)
    ax3.grid(alpha=0.3)
    ax4 = axes[3]
    for (lo_, hi_, col, lab) in ((None, 60, '#8e44ad', 'sub <60 Hz'), (60, 250, '#d35400', '60-250 Hz'),
                                 (1000, 4000, '#16a085', '1-4 kHz (VO band)')):
        if lo_ is None:
            sos = signal.butter(4, hi_, 'lowpass', fs=SR, output='sos')
        else:
            sos = signal.butter(4, [lo_, hi_], 'bandpass', fs=SR, output='sos')
        b = signal.sosfilt(sos, mono)
        e = np.sqrt((b[:len(b) // 2400 * 2400].reshape(-1, 2400) ** 2).mean(axis=1))
        ax4.plot(np.arange(len(e)) * 0.05, 20 * np.log10(e + 1e-9), color=col, lw=0.8, label=lab)
    for a_, b_, _ in sc_mod.vo_windows(tl):
        ax4.axvspan(a_, b_, color='#bbbbbb', alpha=0.25, lw=0)
    ax4.set_ylim(-70, -5)
    ax4.set_ylabel('band dBFS')
    ax4.legend(loc='lower left', fontsize=8, ncol=3)
    ax4.grid(alpha=0.3)
    ax4.set_xlabel('time (s)   (grey spans = VO lines)')
    ax4.set_xlim(0, 120)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT_DIR, 'spectrogram.png'))
    plt.close(fig)


if __name__ == '__main__':
    main()
