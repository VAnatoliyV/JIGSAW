#!/usr/bin/env python3
"""Albion Journal -- 120 s product-film score.

Single re-runnable entry point:

    python3 build_music.py            # compose, render, mix, master, verify
    python3 build_music.py --no-verify

Pipeline
  1. score.build_score(timeline.json)   -> parts (notes on a 120 BPM grid) + fx events
  2. each part -> its own MIDI file -> FluidSynth (MuseScore_General_Full.sf2),
     rendered DRY (no reverb/chorus), 48 kHz float
  3. numpy layers (booms, risers, reverse cymbals, sub drone, anvil)
  4. per-part gain / EQ / stereo placement, per-stem hall reverb (synthetic IR,
     RT60 2.2 s, 20 ms pre-delay, low end kept out of the send)
  5. bus compressor (gain curve applied identically to every stem, so the stems
     sum exactly to the pre-limiter mix), loudness to -16 LUFS, true-peak limiter
     at -1.3 dBTP
  6. writes music_mix.wav (24-bit), stems/*.wav (32-bit float), music_mix.mid

Temporary renders go to $MUSIC_BUILD_TMP (default: <system tmp>/albion_music_build).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

import mido
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import dsp  # noqa: E402
import score as sc_mod  # noqa: E402
import synth  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TIMELINE = os.path.join(ROOT, 'timeline', 'timeline.json')
OUT_DIR = os.path.join(ROOT, 'assets', 'audio', 'music')
STEM_DIR = os.path.join(OUT_DIR, 'stems')
SF2 = '/usr/share/sounds/sf2/MuseScore_General_Full.sf2'
SR = 48000
DUR = 120.0
N = int(DUR * SR)
TPS = 1920            # MIDI ticks per second (960 per beat at 120 BPM)
FS_GAIN = '0.5'

STEMS = ['drums_perc', 'low', 'strings', 'brass', 'choir_pads', 'melody', 'fx_hits']

# Mixer: per-part trim in dB (applied on top of score velocities)
MIX = {
    'taiko': 0.0, 'taiko_hi': -1.0, 'bassdrum': 0.0, 'timpani': -1.5, 'snare': -4.0,
    'msnare': -3.0, 'frame': -1.0, 'tamb': -5.0,
    'orchhit': -6.0, 'cymbals': -8.0, 'kitcym': -8.0,
    'basses': 4.0, 'basses_sus': 1.0, 'bass_pizz': 2.0, 'bass_stab': 1.0, 'tuba': -4.0,
    'trombones': -6.0, 'trb_stab': -8.0,
    'vln1_sus': -2.0, 'vla_sus': 0.0, 'vc_sus': 1.0, 'ost_hi': 1.0, 'ost_lo': 4.0,
    'vc_ost': 4.0, 'vc_stab': -2.0, 'pizz_stab': 0.0, 'str_stab': -4.0, 'trem_vln': -1.0,
    'trem_vla': 2.0, 'trem_vc': 3.0, 'pizz': 3.0, 'harp': 0.0, 'lute': 2.0, 'vc_theme': 0.0,
    'horns': -3.0, 'brass_sect': -6.0,
    'choir_l': -2.0, 'choir_r': -2.0, 'oohs_l': 0.0, 'oohs_r': 0.0, 'drone': 4.0,
    'horn_lead': 0.0, 'vln_lead': -1.0, 'trp_lead': -4.0, 'flute': 1.0, 'fiddle': 5.0,
}
FX_MIX = {  # kind: (stem, gain dB, reverb send, pan)
    'boom': ('fx_hits', -1.0, 0.06, 0.0),
    'swell': ('fx_hits', -2.0, 0.05, 0.0),
    'riser': ('fx_hits', -6.0, 0.30, 0.0),
    'revcym': ('fx_hits', -5.0, 0.25, 0.0),
    'subdrone': ('low', 0.0, 0.0, 0.0),
    'anvil': ('drums_perc', -4.0, 0.30, 0.2),
}
WET = 0.9            # global reverb return level
TARGET_LUFS = -16.0
CEILING_DB = -1.3


# ----------------------------------------------------------------------------
# SoundFont preset table
# ----------------------------------------------------------------------------
def sf2_presets(path):
    out = {}
    with open(path, 'rb') as f:
        def walk(off, end):
            f.seek(off)
            while f.tell() < end:
                hdr = f.read(8)
                if len(hdr) < 8:
                    break
                cid, size = hdr[:4], struct.unpack('<I', hdr[4:])[0]
                pos = f.tell()
                if cid == b'LIST':
                    if f.read(4) == b'pdta':
                        walk(pos + 4, pos + size)
                elif cid == b'phdr':
                    raw = f.read(size)
                    for i in range(size // 38):
                        r = raw[i * 38:(i + 1) * 38]
                        name = r[:20].split(b'\0')[0].decode('latin1')
                        prog, bank = struct.unpack('<HH', r[20:24])
                        out[(bank, prog)] = name
                f.seek(pos + size + (size & 1))
        walk(12, os.path.getsize(path))
    return out


# ----------------------------------------------------------------------------
# MIDI
# ----------------------------------------------------------------------------
def part_events(part, channel):
    ev = []
    if not part.drum:
        ev.append((0, 0, mido.Message('control_change', channel=channel, control=0, value=part.bank)))
    ev.append((0, 1, mido.Message('program_change', channel=channel, program=part.prog)))
    ev.append((0, 2, mido.Message('control_change', channel=channel, control=7, value=127)))
    ev.append((0, 2, mido.Message('control_change', channel=channel, control=10, value=64)))
    ev.append((0, 2, mido.Message('control_change', channel=channel, control=91, value=0)))
    ev.append((0, 2, mido.Message('control_change', channel=channel, control=93, value=0)))
    for (t, cc, val) in part.ccs:
        ev.append((int(round(t * TPS)), 3, mido.Message('control_change', channel=channel, control=cc, value=val)))
    for (t, d, p, v) in part.notes:
        t0 = int(round(t * TPS))
        t1 = max(t0 + 1, int(round((t + d) * TPS)))
        ev.append((t0, 5, mido.Message('note_on', channel=channel, note=p, velocity=v)))
        ev.append((t1, 4, mido.Message('note_off', channel=channel, note=p, velocity=0)))
    return ev


def to_track(events, name=None, port=None, end_tick=None):
    tr = mido.MidiTrack()
    if name:
        tr.append(mido.MetaMessage('track_name', name=name, time=0))
    if port is not None:
        tr.append(mido.MetaMessage('midi_port', port=port, time=0))
    events = sorted(events, key=lambda e: (e[0], e[1]))
    last = 0
    for tk, _, m in events:
        tr.append(m.copy(time=tk - last))
        last = tk
    if end_tick is not None and end_tick > last:
        tr.append(mido.MetaMessage('end_of_track', time=end_tick - last))
    return tr


def tempo_track(timeline, fx):
    tr = mido.MidiTrack()
    tr.append(mido.MetaMessage('track_name', name='Albion Journal - conductor', time=0))
    tr.append(mido.MetaMessage('set_tempo', tempo=500000, time=0))
    tr.append(mido.MetaMessage('time_signature', numerator=4, denominator=4, time=0))
    tr.append(mido.MetaMessage('key_signature', key='Dm', time=0))
    marks = [(s['start'], 'SECTION ' + s['name']) for s in timeline['sections']]
    marks += [(e['t'], 'FX %s %s' % (e['kind'], e.get('size', ''))) for e in fx if 't' in e]
    marks += [(e['t0'], 'FX %s %.2f-%.2f' % (e['kind'], e['t0'], e['t1'])) for e in fx if 't0' in e]
    marks += [(e['t1'] - e['dur'], 'FX %s -> %.2f' % (e['kind'], e['t1'])) for e in fx if e['kind'] == 'revcym']
    ev = [(int(round(t * TPS)), 0, mido.MetaMessage('marker', text=txt)) for t, txt in marks]
    events = sorted(ev, key=lambda e: e[0])
    last = 0
    for tk, _, m in events:
        tr.append(m.copy(time=tk - last))
        last = tk
    return tr


def write_part_midi(part, path):
    mid = mido.MidiFile(type=1, ticks_per_beat=960)
    ch = 9 if part.drum else 0
    t0 = mido.MidiTrack()
    t0.append(mido.MetaMessage('set_tempo', tempo=500000, time=0))
    t0.append(mido.MetaMessage('time_signature', numerator=4, denominator=4, time=0))
    mid.tracks.append(t0)
    ev = part_events(part, ch)
    # keep the file alive until 122 s so every release tail is rendered
    ev.append((int(122 * TPS), 6, mido.Message('control_change', channel=ch, control=11,
                                                 value=part.ccs[-1][2] if part.ccs else 127)))
    mid.tracks.append(to_track(ev, name=part.name))
    mid.save(path)


def write_merged_midi(sc, timeline, path):
    mid = mido.MidiFile(type=1, ticks_per_beat=960)
    mid.tracks.append(tempo_track(timeline, sc.fx))
    mel_slots = [(port, ch) for port in range(8) for ch in range(16) if ch != 9]
    drum_port = 0
    mi = 0
    for part in sc.parts.values():
        if part.drum:
            port, ch = drum_port, 9
            drum_port += 1
        else:
            port, ch = mel_slots[mi]
            mi += 1
        label = f'{part.name} [{part.stem}] {part.preset} (bank {part.bank} prog {part.prog})'
        mid.tracks.append(to_track(part_events(part, ch), name=label, port=port))
    mid.save(path)


# ----------------------------------------------------------------------------
# Rendering
# ----------------------------------------------------------------------------
def render_part(part, workdir):
    mpath = os.path.join(workdir, part.name + '.mid')
    write_part_midi(part, mpath)
    h = hashlib.sha1(open(mpath, 'rb').read() + SF2.encode() + FS_GAIN.encode()).hexdigest()[:16]
    wpath = os.path.join(workdir, f'{part.name}_{h}.wav')
    logpath = wpath + '.log'
    if not os.path.exists(wpath):
        cmd = ['fluidsynth', '-ni', '-o', 'synth.reverb.active=0', '-o', 'synth.chorus.active=0',
               '-o', 'synth.polyphony=1024', '-r', str(SR), '-g', FS_GAIN, '-T', 'wav', '-O', 'float',
               '-F', wpath + '.tmp', SF2, mpath]
        r = subprocess.run(cmd, capture_output=True, text=True)
        os.replace(wpath + '.tmp', wpath)
        with open(logpath, 'w') as f:
            f.write(r.stdout + '\n' + r.stderr)
    warns = [ln for ln in open(logpath).read().splitlines()
             if 'not found' in ln.lower() or 'substitut' in ln.lower() or 'error' in ln.lower()]
    return wpath, warns


def load_fit(path):
    x, sr = sf.read(path, dtype='float32', always_2d=True)
    assert sr == SR, (path, sr)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    out = np.zeros((N, 2), dtype=np.float64)
    m = min(N, len(x))
    out[:m] = x[:m]
    return out


def render_crash(workdir):
    part = sc_mod.Part('crash_src', 'fx_hits', 128, 48, 'Orchestra Kit', drum=True)
    part.notes = [(0.0, 3.0, sc_mod.K_CRASH, 127)]
    part.ccs = [(0.0, 11, 127)]
    mpath = os.path.join(workdir, 'crash_src.mid')
    mid = mido.MidiFile(type=1, ticks_per_beat=960)
    t0 = mido.MidiTrack()
    t0.append(mido.MetaMessage('set_tempo', tempo=500000, time=0))
    mid.tracks.append(t0)
    ev = part_events(part, 9)
    ev.append((int(4 * TPS), 6, mido.Message('control_change', channel=9, control=11, value=127)))
    mid.tracks.append(to_track(ev))
    mid.save(mpath)
    wpath = os.path.join(workdir, 'crash_src.wav')
    subprocess.run(['fluidsynth', '-ni', '-o', 'synth.reverb.active=0', '-o', 'synth.chorus.active=0',
                    '-r', str(SR), '-g', FS_GAIN, '-T', 'wav', '-O', 'float', '-F', wpath, SF2, mpath],
                   capture_output=True, text=True, check=True)
    x, _ = sf.read(wpath, dtype='float64', always_2d=True)
    return x


# ----------------------------------------------------------------------------
# Mixing
# ----------------------------------------------------------------------------
def process_part(part, x):
    if part.hp:
        x = dsp.hp(x, part.hp, order=2)
    if part.lp:
        x = dsp.lp(x, part.lp, order=2)
    for (f0, g, q) in part.peq:
        x = dsp.peaking(x, f0, g, q)
    x = x * 10 ** (MIX.get(part.name, 0.0) / 20)
    return dsp.place(x, part.pan, part.width)


def add_at(buf, y, t, gain=1.0):
    i0 = int(round(t * SR))
    if i0 >= N:
        return
    j0 = max(0, -i0)
    i0c = max(0, i0)
    m = min(len(y) - j0, N - i0c)
    if m > 0:
        buf[i0c:i0c + m] += y[j0:j0 + m] * gain


def fx_buffers(sc, crash):
    """Returns {stem: (dry, send)} contributions of the numpy layers + level table."""
    dry = {s: np.zeros((N, 2)) for s in STEMS}
    send = {s: np.zeros((N, 2)) for s in STEMS}
    for e in sc.fx:
        k = e['kind']
        stem, gdb, snd, pan = FX_MIX[k]
        g = 10 ** (gdb / 20)
        if k == 'boom':
            y, t = synth.boom(e['size']), e['t']
        elif k == 'swell':
            y, t = synth.swell(e['t1'] - e['t0']), e['t0']
        elif k == 'riser':
            y, t = synth.riser(e['t1'] - e['t0'], e.get('level', 1.0)), e['t0']
        elif k == 'revcym':
            y, t = synth.reverse_cymbal(crash, e['dur'], e.get('level', 1.0)), e['t1'] - e['dur']
        elif k == 'subdrone':
            y = synth.subdrone(e['t1'] - e['t0'], e['f'], e['level'], e['fade_in'], e['fade_out'])
            t = e['t0']
        elif k == 'anvil':
            y, t = synth.anvil(e['vel']), e['t']
        else:
            raise ValueError(k)
        y = dsp.place(y, pan, 1.0) * e.get('gain', 1.0)
        add_at(dry[stem], y, t, g)
        add_at(send[stem], y, t, g * snd)
    return dry, send


def end_fade():
    env = np.ones(N)
    t = np.arange(N) / SR
    a, b = 117.3, 119.8
    x = np.clip((t - a) / (b - a), 0, 1)
    env *= np.cos(0.5 * np.pi * x) ** 2
    env[t >= b] = 0.0
    return env


def active_loudness(x):
    """Loudness of a part over the windows where it is actually playing."""
    _, m = dsp.window_loudness(x, 0.4, 0.1)
    if not np.isfinite(m).any() or m.max() < -90:
        return -120.0, 0.0
    act = m > m.max() - 25
    lin = 10 ** (m[act] / 10)
    return 10 * np.log10(lin.mean()), act.mean() * DUR


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-verify', action='store_true')
    ap.add_argument('--part-report', action='store_true', help='print per-part loudness table')
    args = ap.parse_args()
    t_start = time.time()

    timeline = json.load(open(TIMELINE))
    assert abs(timeline['bpm'] - 120) < 1e-9 and abs(timeline['duration'] - DUR) < 1e-9
    sc = sc_mod.build_score(timeline)
    bad = sc_mod.check_grid(sc)
    assert not bad, f'off-grid notes: {bad[:10]}'

    # ---- preset sanity: every (bank, prog) must exist with the expected name
    presets = sf2_presets(SF2)
    preset_rows = []
    for part in sc.parts.values():
        key = (128 if part.drum else part.bank, part.prog)
        name = presets.get(key)
        ok = name == part.preset
        preset_rows.append((part.name, part.stem, key, part.preset, name, ok))
        if not ok:
            raise SystemExit(f'preset mismatch for {part.name}: wanted {part.preset} at {key}, sf2 has {name}')

    workdir = os.environ.get('MUSIC_BUILD_TMP', os.path.join(tempfile.gettempdir(), 'albion_music_build'))
    os.makedirs(workdir, exist_ok=True)
    os.makedirs(STEM_DIR, exist_ok=True)

    print(f'[1/5] rendering {len(sc.parts)} parts with FluidSynth ...', flush=True)
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
        results = dict(zip(sc.parts.keys(), ex.map(lambda p: render_part(p, workdir), sc.parts.values())))
    warnings = {k: w for k, (_, w) in results.items() if w}
    if warnings:
        raise SystemExit(f'FluidSynth preset warnings: {warnings}')

    print('[2/5] mixing ...', flush=True)
    dry = {s: np.zeros((N, 2)) for s in STEMS}
    send = {s: np.zeros((N, 2)) for s in STEMS}
    part_table = []
    for name, part in sc.parts.items():
        x = process_part(part, load_fit(results[name][0]))
        dry[part.stem] += x
        send[part.stem] += x * part.send
        if args.part_report:
            part_table.append((name, part.stem, *active_loudness(x)))
    crash = render_crash(workdir)
    fdry, fsend = fx_buffers(sc, crash)
    for s in STEMS:
        dry[s] += fdry[s]
        send[s] += fsend[s]
    if args.part_report:
        print(f'{"part":12s} {"stem":11s} {"activeLUFS":>10s} {"active s":>8s}')
        for row in part_table:
            print(f'{row[0]:12s} {row[1]:11s} {row[2]:10.1f} {row[3]:8.1f}')

    print('[3/5] reverb ...', flush=True)
    ir = dsp.make_hall_ir(rt60=2.2, predelay=0.020)
    stems = {}
    for s in STEMS:
        wet = dsp.reverb(send[s], ir) * WET
        stems[s] = dry[s] + wet
    env = end_fade()
    for s in STEMS:
        stems[s] = dsp.hp(stems[s], 25, order=2) * env[:, None]     # subsonic clean-up

    print('[4/5] bus compression, loudness, limiter ...', flush=True)
    pre = sum(stems[s] for s in STEMS)
    G = 10 ** ((TARGET_LUFS - dsp.integrated_loudness(pre)) / 20)
    for it in range(5):
        gc = dsp.compressor_gain(pre * G, thr_db=-13.0, ratio=1.6, knee_db=8.0, attack=0.030, release=0.30)
        mixc = pre * G * gc[:, None]
        gl = dsp.limiter_gain(mixc, ceiling_db=CEILING_DB)
        final = mixc * gl[:, None]
        L = dsp.integrated_loudness(final)
        print(f'   iter {it}: makeup {20*np.log10(G):+.2f} dB  -> {L:.2f} LUFS, '
              f'max comp GR {-20*np.log10(gc.min()):.1f} dB, max limiter GR {-20*np.log10(gl.min()):.1f} dB', flush=True)
        if abs(L - TARGET_LUFS) < 0.05:
            break
        G *= 10 ** ((TARGET_LUFS - L) / 20)
    tp = dsp.true_peak(final)
    if 20 * np.log10(tp) > -1.05:
        final *= 10 ** ((-1.1 - 20 * np.log10(tp)) / 20)
    final[int(119.8 * SR):] = 0.0

    print('[5/5] writing ...', flush=True)
    stem_scale = G * gc[:, None]
    for s in STEMS:
        y = (stems[s] * stem_scale).astype(np.float32)
        sf.write(os.path.join(STEM_DIR, f'{s}.wav'), y, SR, subtype='FLOAT')
    sf.write(os.path.join(OUT_DIR, 'music_mix.wav'), final, SR, subtype='PCM_24')
    write_merged_midi(sc, timeline, os.path.join(OUT_DIR, 'music_mix.mid'))
    with open(os.path.join(OUT_DIR, 'music_presets.json'), 'w') as f:
        json.dump([dict(part=r[0], stem=r[1], bank=r[2][0], program=r[2][1], wanted=r[3], soundfont=r[4],
                        ok=r[5]) for r in preset_rows], f, indent=1)
    print(f'done in {time.time() - t_start:.0f} s')

    if not args.no_verify:
        import verify_music
        verify_music.main()


if __name__ == '__main__':
    main()
