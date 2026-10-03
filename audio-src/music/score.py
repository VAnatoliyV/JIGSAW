"""Albion Journal film score -- the composition.

Everything is written on a strict 120 BPM / 4/4 grid (beat = 0.5 s, bar = 2.0 s,
16th = 0.125 s, rolls on 32nds = 0.0625 s).  Bar 1 beat 1 is t = 0.000 s.

The score is data: a set of Parts (one GM/SF2 preset each, rendered dry by
FluidSynth) plus a list of numpy-synthesised layers (booms, risers, reverse
cymbals, sub drone, anvil).  build_music.py renders and mixes it.

Key: D minor with Dorian colour (B natural on the IV chord, G major), Picardy
D major on the final hit (bar 59, t = 116 s).

Heroic motif (4 bars, "the Journal theme"):
    | D4  A4.  G4 F4 | E4.  F4 G4-- | A4  D5.  C5 B4 | A4------ |
    |  q  q.   e  q  |  q.  e  h    |  q  q.   e  q  |  w       |
    harmony:  Dm   |  C/E   |  F   G   |   A
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

BEAT = 0.5
BAR = 2.0
SIX = 0.125     # 16th note
T32 = 0.0625    # 32nd note (rolls only)

_PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def P(name: str) -> int:
    """'D4' -> 62, 'C#5' -> 73, 'Bb3' -> 58 (MIDI, C4 = 60)."""
    letter = name[0]
    i = 1
    acc = 0
    while i < len(name) and name[i] in '#b':
        acc += 1 if name[i] == '#' else -1
        i += 1
    return 12 * (int(name[i:]) + 1) + _PC[letter] + acc


def pcl(n: str) -> int:
    v = _PC[n[0]]
    for ch in n[1:]:
        v += 1 if ch == '#' else -1
    return v % 12


def T(bar: int, beat: float = 1.0) -> float:
    return (bar - 1) * BAR + (beat - 1) * BEAT


def S(bar: int, six: float) -> float:
    return (bar - 1) * BAR + six * SIX


# ----------------------------------------------------------------------------
# Harmony
# ----------------------------------------------------------------------------
CHORDS = {
    'Dm': ('D', ['D', 'F', 'A']),
    'D': ('D', ['D', 'F#', 'A']),
    'C': ('C', ['C', 'E', 'G']),
    'C/E': ('E', ['C', 'E', 'G']),
    'F': ('F', ['F', 'A', 'C']),
    'G': ('G', ['G', 'B', 'D']),
    'G/B': ('B', ['G', 'B', 'D']),
    'G/D': ('D', ['G', 'B', 'D']),
    'Gm': ('G', ['G', 'Bb', 'D']),
    'A': ('A', ['A', 'C#', 'E']),
    'Asus4': ('A', ['A', 'D', 'E']),
    'Bb': ('Bb', ['Bb', 'D', 'F']),
    'Bb/D': ('D', ['Bb', 'D', 'F']),
    'Eb': ('Eb', ['Eb', 'G', 'Bb']),
}

HARMONY = {
    1: 'Dm', 2: 'Dm', 3: 'Dm', 4: 'Dm', 5: 'Bb/D', 6: 'G/D', 7: 'C', 8: 'A',
    9: 'Dm', 10: 'C/E', 11: [(1, 'F'), (3, 'G')], 12: 'A',
    13: 'Dm', 14: 'C/E', 15: 'Bb', 16: 'A',
    17: 'Dm', 18: 'C', 19: 'G/B', 20: 'Dm', 21: 'Dm', 22: 'C', 23: 'Bb',
    24: [(1, 'Asus4'), (3, 'A')],
    25: 'Dm', 26: 'Bb', 27: 'Gm', 28: 'A', 29: 'Dm', 30: 'Eb', 31: 'Dm', 32: 'A',
    33: 'Dm', 34: 'G', 35: 'Dm', 36: 'G', 37: 'F', 38: 'C', 39: 'G', 40: 'A',
    41: 'Dm', 42: 'C/E', 43: [(1, 'F'), (3, 'G')], 44: [(1, 'Asus4'), (3, 'A')],
    45: 'Dm', 46: 'Dm', 47: 'C/E', 48: [(1, 'Bb'), (3, 'A')],
    49: 'Dm', 50: 'Bb', 51: 'G', 52: [(1, 'Asus4'), (3, 'A')],
    53: 'Dm', 54: 'C/E', 55: [(1, 'F'), (3, 'G')], 56: 'A', 57: 'Bb', 58: 'C',
    59: 'D', 60: 'D',
}


def chord_at(t: float) -> str:
    bar = int(t // BAR + 1e-9) + 1
    beat = (t - (bar - 1) * BAR) / BEAT + 1
    h = HARMONY[min(bar, 60)]
    if isinstance(h, str):
        return h
    cur = h[0][1]
    for b, sym in h:
        if beat + 1e-9 >= b:
            cur = sym
    return cur


def segments(bar: int):
    """[(t0, t1, sym)] chord segments of a bar."""
    h = HARMONY[bar]
    if isinstance(h, str):
        return [(T(bar), T(bar + 1), h)]
    out = []
    for i, (b, sym) in enumerate(h):
        b1 = h[i + 1][0] if i + 1 < len(h) else 5
        out.append((T(bar, b), T(bar, b1), sym))
    return out


def chord_pcs(sym):
    return [pcl(x) for x in CHORDS[sym][1]]


def root_pc(sym):
    return pcl(CHORDS[sym][1][0])


def bass_pc(sym):
    return pcl(CHORDS[sym][0])


def lowest(pc: int, lo: int) -> int:
    p = lo
    while p % 12 != pc:
        p += 1
    return p


def tones_in(sym, lo, hi):
    pcs = chord_pcs(sym)
    return [p for p in range(lo, hi + 1) if p % 12 in pcs]


def triad(sym, lo):
    """root, third, fifth stacked from the lowest root >= lo."""
    pcs = chord_pcs(sym)
    r = lowest(pcs[0], lo)
    return r, r + (pcs[1] - pcs[0]) % 12, r + (pcs[2] - pcs[0]) % 12


def voicing(sym, lo, hi, n=None):
    v = tones_in(sym, lo, hi)
    if n is not None and len(v) > n:
        v = v[-n:]
    return v


# ----------------------------------------------------------------------------
# Themes (beat offsets, duration in beats, pitch)
# ----------------------------------------------------------------------------
THEME_A = [(0, 1, 'D4'), (1, 1.5, 'A4'), (2.5, 0.5, 'G4'), (3, 1, 'F4'),
           (4, 1.5, 'E4'), (5.5, 0.5, 'F4'), (6, 2, 'G4'),
           (8, 1, 'A4'), (9, 1.5, 'D5'), (10.5, 0.5, 'C5'), (11, 1, 'B4'),
           (12, 4, 'A4')]
THEME_B = [(0, 1, 'D4'), (1, 1.5, 'A4'), (2.5, 0.5, 'G4'), (3, 1, 'F4'),
           (4, 1.5, 'E4'), (5.5, 0.5, 'F4'), (6, 1, 'G4'), (7, 1, 'A4'),
           (8, 1.5, 'Bb4'), (9.5, 0.5, 'C5'), (10, 1, 'D5'), (11, 1, 'F5'),
           (12, 1.5, 'E5'), (13.5, 0.5, 'D5'), (14, 2, 'C#5')]
FIN_EXT = [(0, 1.5, 'Bb4'), (1.5, 0.5, 'C5'), (2, 1, 'D5'), (3, 1, 'F5'),
           (4, 1.5, 'E5'), (5.5, 0.5, 'D5'), (6, 2, 'E5')]
CELL_DARK = [(0, 1, 'D4'), (1, 1.5, 'A4'), (2.5, 0.5, 'G4'), (3, 1, 'F4'),
             (4, 1.5, 'E4'), (5.5, 0.5, 'F4'), (6, 1, 'G4'), (7, 1, 'A4')]
ANSWER = [(0, 1, 'A4'), (1, 1.5, 'D5'), (2.5, 0.5, 'C5'), (3, 1, 'B4'), (4, 4, 'A4')]


# ----------------------------------------------------------------------------
# Parts
# ----------------------------------------------------------------------------
@dataclass
class Part:
    name: str
    stem: str
    bank: int
    prog: int
    preset: str            # expected SF2 preset name (verified at build time)
    drum: bool = False
    pan: float = 0.0       # -1 .. 1
    width: float = 1.0     # stereo width of the rendered sample image
    send: float = 0.3      # reverb send
    gain: float = 0.0      # dB, mixer
    hp: float | None = None
    lp: float | None = None
    peq: list = field(default_factory=list)   # [(freq, gain_db, q)]
    notes: list = field(default_factory=list)  # (t, dur, pitch, vel)
    ccs: list = field(default_factory=list)    # (t, cc, value)

    def n(self, t, dur, pitch, vel, human=True):
        if isinstance(pitch, str):
            pitch = P(pitch)
        vel = int(vel)
        if human:
            vel += _rng.randint(-3, 3)
        self.notes.append((round(t, 6), round(dur, 6), int(pitch), max(1, min(127, vel))))

    def acc(self, t, dur, pitch, vel):       # accent: exact velocity, no humanising
        self.n(t, dur, pitch, vel, human=False)

    def expr(self, t, val):
        self.ccs.append((round(t, 6), 11, int(max(0, min(127, val)))))

    def ramp(self, t0, t1, v0, v1, step=T32, curve=1.0):
        k = int(round((t1 - t0) / step))
        for i in range(k + 1):
            x = i / max(1, k)
            self.expr(t0 + i * step, v0 + (v1 - v0) * (x ** curve))

    def finalize(self):
        # dedupe identical (start, pitch) keeping the strongest, then make
        # sure repeated pitches never overlap (note-off before next note-on)
        best = {}
        for t, d, p, v in self.notes:
            k = (t, p)
            if k not in best or v > best[k][3]:
                best[k] = (t, max(d, best.get(k, (0, 0, 0, 0))[1]), p, v)
        notes = sorted(best.values())
        last = {}
        out = []
        for i, (t, d, p, v) in enumerate(notes):
            out.append([t, d, p, v])
            if p in last:
                j = last[p]
                if out[j][0] + out[j][1] > t - 0.004:
                    out[j][1] = max(0.03, t - out[j][0] - 0.004)
            last[p] = len(out) - 1
        self.notes = [tuple(x) for x in out]
        self.ccs.sort()


_rng = random.Random(1209)


class Score:
    def __init__(self):
        self.parts: dict[str, Part] = {}
        self.fx: list[dict] = []

    def add(self, *a, **k):
        p = Part(*a, **k)
        self.parts[p.name] = p
        return p

    def __getitem__(self, k):
        return self.parts[k]


def make_parts(sc: Score):
    A = sc.add
    # ---- drums & percussion ------------------------------------------------
    A('taiko', 'drums_perc', 128, 48, 'Orchestra Kit', drum=True, pan=0.0, send=0.20, hp=30)
    A('taiko_hi', 'drums_perc', 0, 116, 'Taiko Drum', pan=0.12, send=0.22, hp=50)
    A('bassdrum', 'drums_perc', 8, 116, 'Concert Bass Drum', pan=0.0, send=0.18, hp=25)
    A('timpani', 'drums_perc', 0, 47, 'Timpani', pan=-0.15, send=0.30, hp=35)
    A('snare', 'drums_perc', 128, 48, 'Orchestra Kit', drum=True, pan=0.05, send=0.28, hp=120)
    A('msnare', 'drums_perc', 128, 56, 'Marching Snare', drum=True, pan=0.0, send=0.28, hp=120)
    A('frame', 'drums_perc', 128, 48, 'Orchestra Kit', drum=True, pan=-0.18, send=0.22, hp=60)
    A('tamb', 'drums_perc', 128, 48, 'Orchestra Kit', drum=True, pan=0.35, send=0.25, hp=300, lp=9000)
    # ---- fx / hits ---------------------------------------------------------
    A('orchhit', 'fx_hits', 0, 55, 'Orchestra Hit', pan=0.0, send=0.32, hp=90)
    A('cymbals', 'fx_hits', 128, 58, 'Marching Cymbals', drum=True, pan=0.0, send=0.30, hp=250)
    A('kitcym', 'fx_hits', 128, 48, 'Orchestra Kit', drum=True, pan=-0.08, send=0.32, hp=250)
    # ---- low (basses, low brass) -------------------------------------------
    A('basses', 'low', 50, 48, 'Basses Fast', pan=0.22, send=0.12, hp=30)
    A('basses_sus', 'low', 50, 49, 'Basses Slow', pan=0.22, send=0.14, hp=30)
    A('bass_pizz', 'low', 50, 45, 'Basses Pizzicato', pan=0.22, send=0.16, hp=30)
    A('bass_stab', 'low', 50, 48, 'Basses Fast', pan=0.15, send=0.14, hp=30)
    A('tuba', 'low', 0, 58, 'Tuba', pan=0.10, send=0.14, hp=28)
    A('trombones', 'low', 0, 57, 'Trombone', pan=0.18, send=0.26, hp=45)
    A('trb_stab', 'low', 0, 57, 'Trombone', pan=0.08, send=0.24, hp=40)
    # ---- strings -----------------------------------------------------------
    A('vln1_sus', 'strings', 20, 49, 'Violins Slow', pan=-0.50, send=0.42, hp=180)
    A('vla_sus', 'strings', 30, 49, 'Violas Slow', pan=0.22, send=0.40, hp=120)
    A('vc_sus', 'strings', 40, 49, 'Celli Slow', pan=0.42, send=0.36, hp=60)
    A('ost_hi', 'strings', 25, 48, 'Violins2 Fast', pan=-0.35, send=0.32, peq=[(2600, -2.5, 0.9)], hp=180)
    A('ost_lo', 'strings', 30, 48, 'Violas Fast', pan=0.30, send=0.32, hp=110)
    A('vc_ost', 'strings', 40, 48, 'Celli Fast', pan=0.45, send=0.30, hp=55)
    A('vc_stab', 'strings', 40, 48, 'Celli Fast', pan=0.35, send=0.30, hp=50)
    A('pizz_stab', 'strings', 40, 45, 'Celli Pizzicato', pan=0.30, send=0.30, hp=50)
    A('str_stab', 'strings', 0, 48, 'Strings Fast', pan=-0.10, send=0.34, hp=150)
    A('trem_vln', 'strings', 20, 44, 'Violins Tremolo', pan=-0.45, send=0.42, hp=180)
    A('trem_vla', 'strings', 30, 44, 'Violas Tremolo', pan=0.25, send=0.40, hp=120)
    A('trem_vc', 'strings', 40, 44, 'Celli Tremolo', pan=0.45, send=0.36, hp=60)
    A('pizz', 'strings', 0, 45, 'Strings Pizzicato', pan=-0.15, send=0.34, hp=100)
    A('harp', 'strings', 0, 46, 'Harp', pan=-0.32, send=0.42, peq=[(2500, -2.5, 0.9)], hp=120)
    A('lute', 'strings', 0, 24, 'Nylon String Guitar', pan=0.55, send=0.30, peq=[(2500, -2.0, 0.9)], hp=110)
    A('vc_theme', 'strings', 40, 48, 'Celli Fast', pan=0.40, send=0.34, hp=60)
    # ---- brass (harmony) ---------------------------------------------------
    A('horns', 'brass', 0, 60, 'French Horns', pan=-0.30, send=0.40, hp=80)
    A('brass_sect', 'brass', 0, 61, 'Brass Section', pan=0.10, send=0.36, hp=90)
    # ---- choir & pads ------------------------------------------------------
    A('choir_l', 'choir_pads', 0, 52, 'Choir Aahs', pan=-0.62, send=0.48, peq=[(2800, -1.5, 0.8)], hp=120)
    A('choir_r', 'choir_pads', 0, 52, 'Choir Aahs', pan=0.62, send=0.48, peq=[(2800, -1.5, 0.8)], hp=110)
    A('oohs_l', 'choir_pads', 0, 53, 'Voice Oohs', pan=-0.55, send=0.46, hp=110)
    A('oohs_r', 'choir_pads', 0, 53, 'Voice Oohs', pan=0.55, send=0.46, hp=100)
    A('drone', 'choir_pads', 0, 109, 'Bagpipe', pan=0.25, send=0.38, hp=120, lp=6000)
    # ---- melody / lead lines -----------------------------------------------
    A('horn_lead', 'melody', 0, 60, 'French Horns', pan=-0.25, send=0.38, hp=90)
    A('vln_lead', 'melody', 20, 48, 'Violins Fast', pan=-0.40, send=0.38, hp=180)
    A('trp_lead', 'melody', 0, 56, 'Trumpet', pan=-0.08, send=0.36, hp=150)
    A('flute', 'melody', 0, 73, 'Flute', pan=-0.42, send=0.42, hp=200)
    A('fiddle', 'melody', 0, 110, 'Fiddle', pan=0.32, send=0.36, hp=160)


# Orchestra-kit keys
K_BD, K_SN, K_TAMB, K_SPLASH, K_CRASH, K_CRASH2 = 36, 38, 54, 55, 57, 59
K_TRI, K_BELLTREE, K_TAIKO_S, K_TAIKO_L = 81, 84, 86, 87
K_TUMBA, K_CONGA, K_BONGO = 64, 63, 61
# Marching cymbals / snare keys
M_CRASH, M_SMASH, M_ROLL, M_SNARE, M_RIM, M_HALF = 72, 89, 93, 50, 52, 74


def low_stack(sym, lo):
    """bass note + chord tones just above it (power voicing when in root position)."""
    b = lowest(bass_pc(sym), lo)
    if bass_pc(sym) == root_pc(sym):
        return [b, b + 7, b + 12]
    r = lowest(root_pc(sym), b + 1)
    return sorted(set([b, r - 5 if r - 5 > b else r + 7, r]))


def timp_pitch(sym, use_bass=True):
    pc = bass_pc(sym) if use_bass else root_pc(sym)
    return lowest(pc, 38)          # D2 .. C#3


# ----------------------------------------------------------------------------
# Accents (impacts, hits, stamps)
# ----------------------------------------------------------------------------
def accent(sc: Score, t: float, kind: str, sym: str | None = None, cym=None, boom=None, scale=1.0):
    """One accent = instant transient layers (taiko, bass drum, timpani, orchestra
    hit, rimshot crack, pizzicato, numpy boom with click) + body layers (low
    brass / strings / brass stabs, which swell after the hit)."""
    sym = sym or chord_at(t)

    def V(v):
        return int(max(1, min(127, round(v * scale))))

    r_lo = lowest(bass_pc(sym), 36)        # C2..B2
    rt = lowest(root_pc(sym), 45)           # A2..G#3
    big = kind == 'impact3'
    hook = kind == 'hookhit'
    if kind in ('impact3', 'impact2', 'hookhit'):
        v = 127 if big else 120
        sc['taiko'].acc(t, 0.4, K_TAIKO_L, V(v))
        sc['taiko'].acc(t, 0.4, K_TAIKO_S, V(114 if big else 106))
        sc['taiko'].acc(t, 0.4, K_BD, V(v - 8))
        sc['taiko_hi'].acc(t, 0.4, 41, V(v - 5))
        sc['bassdrum'].acc(t, 1.0, 36, V(v))
        sc['timpani'].acc(t, 0.6, timp_pitch(sym), V(v))
        sc['orchhit'].acc(t, 0.4, rt + 12, V(118 if big else 108))
        sc['orchhit'].acc(t, 0.4, rt, V(110 if big else 100))
        sc['msnare'].acc(t, 0.2, M_RIM, V(120 if big else 108))
        sc['pizz_stab'].acc(t, 0.5, r_lo + 12, V(v))
        sc['bass_pizz'].acc(t, 0.5, r_lo, V(v))
        stab = 0.9 if big else (0.28 if hook else 0.42)
        for p in low_stack(sym, 45):
            sc['trb_stab'].acc(t, stab, p, V(v))
        sc['tuba'].acc(t, stab, lowest(bass_pc(sym), 33), V(v))
        sc['bass_stab'].acc(t, 0.35, r_lo, V(v))
        vs = low_stack(sym, 36)
        sc['vc_stab'].acc(t, 0.35, vs[0], V(v))
        sc['vc_stab'].acc(t, 0.35, vs[1], V(v - 8))
        for p in voicing(sym, 55, 70):
            sc['str_stab'].acc(t, 0.3, p, V(v - 10))
        if big or hook:
            for p in voicing(sym, 57, 69):
                sc['brass_sect'].acc(t, 0.3 if hook else 0.8, p, V(112))
        sc.fx.append(dict(kind='boom', t=t, size=boom or ('big' if big else ('hook' if hook else 'med')), gain=scale ** 3))
    elif kind in ('hit', 'stamp', 'stamp_big'):
        heavy = kind != 'stamp'
        sc['taiko'].acc(t, 0.4, K_TAIKO_L, V(122 if heavy else 112))
        sc['taiko'].acc(t, 0.4, K_TAIKO_S, V(110 if heavy else 104))
        sc['taiko'].acc(t, 0.4, K_BD, V(108 if heavy else 96))
        sc['bassdrum'].acc(t, 0.8, 36, V(112 if heavy else 96))
        sc['timpani'].acc(t, 0.4, timp_pitch(sym), V(115 if heavy else 104))
        sc['msnare'].acc(t, 0.2, M_RIM, V(108 if heavy else 96))
        sc['pizz_stab'].acc(t, 0.4, r_lo + 12, V(118 if heavy else 106))
        sc['bass_pizz'].acc(t, 0.4, r_lo, V(118 if heavy else 106))
        for p in low_stack(sym, 45)[:2]:
            sc['trb_stab'].acc(t, 0.3, p, V(118 if heavy else 100))
        sc['tuba'].acc(t, 0.3, lowest(bass_pc(sym), 33), V(115 if heavy else 98))
        sc['bass_stab'].acc(t, 0.25, r_lo, V(120 if heavy else 108))
        sc['vc_stab'].acc(t, 0.25, low_stack(sym, 36)[0], V(118 if heavy else 106))
        sc['orchhit'].acc(t, 0.3, rt + 12, V(104 if heavy else 92))
        if heavy:
            for p in voicing(sym, 57, 69):
                sc['brass_sect'].acc(t, 0.3, p, V(110))
            for p in voicing(sym, 55, 70):
                sc['str_stab'].acc(t, 0.25, p, V(105))
        sc.fx.append(dict(kind='boom', t=t, size=boom or ('med' if heavy else 'small'), gain=scale ** 3))
    # cymbals: instant layers (half-crash, splash) carry the attack, the crash
    # (slow 40 ms bloom) only adds the sustain
    if cym == 'crash_big':
        sc['cymbals'].acc(t, 2.0, M_HALF, V(124))
        sc['kitcym'].acc(t, 1.0, K_SPLASH, V(112))
        sc['kitcym'].acc(t, 2.0, K_CRASH, V(100))
        sc['cymbals'].acc(t, 2.0, M_CRASH, V(92))
    elif cym == 'crash':
        sc['cymbals'].acc(t, 2.0, M_HALF, V(114))
        sc['kitcym'].acc(t, 2.0, K_CRASH, V(90))
    elif cym == 'half':
        sc['cymbals'].acc(t, 2.0, M_HALF, V(104))
    elif cym == 'splash':
        sc['kitcym'].acc(t, 1.0, K_SPLASH, V(102))


HOOK_HIT_CHORDS = ['Dm', 'Dm', 'Bb', 'C']


def section_of(t, timeline):
    for s in timeline['sections']:
        if s['start'] <= t < s['end']:
            return s['name']
    return timeline['sections'][-1]['name']


def accent_events(timeline):
    return sorted([e for e in timeline['events']
                   if (e['type'] == 'impact' and e.get('strength', 0) >= 2) or e['type'] in ('hit', 'stamp')],
                  key=lambda e: e['t'])


def place_builds(sc: Score, timeline):
    """Risers, reverse cymbals and the opening sub swell straight from timeline.json
    (each ends exactly where the event ends, with a short suck-out before the hit)."""
    for e in timeline['events']:
        if e['type'] == 'riser':
            lvl = 1.0 if e['dur'] >= 4 else (0.85 if e['dur'] >= 2 else 0.7)
            sc.fx.append(dict(kind='riser', t0=e['t'], t1=e['t'] + e['dur'], level=lvl))
        elif e['type'] == 'reverse':
            sc.fx.append(dict(kind='revcym', t1=e['t'] + e['dur'], dur=e['dur'], level=1.0 if e['dur'] >= 1 else 0.9))
        elif e['type'] == 'swell':
            sc.fx.append(dict(kind='swell', t0=e['t'], t1=e['t'] + e['dur']))


def place_accents(sc: Score, timeline):
    """Every impact (strength 2/3), hit and stamp in timeline.json gets an accent."""
    hook_i = 0
    run_i = 0
    last_hit = -10.0
    finale_stamp = 0
    for e in accent_events(timeline):
        t, typ = e['t'], e['type']
        sec = section_of(t, timeline)
        if typ == 'impact' and e.get('strength', 0) >= 3:
            if sec == 'outro':
                accent(sc, t, 'impact3', 'D', cym='crash_big', boom='huge')
                sc['cymbals'].acc(t, 2.0, M_SMASH, 110)
            elif sec == 'metric':
                accent(sc, t, 'impact3', cym='crash_big', boom='huge')
                sc['cymbals'].acc(t, 2.0, M_SMASH, 116)
            elif sec == 'hook':
                accent(sc, t, 'impact3', cym='crash_big', boom='big', scale=0.86)
            else:
                accent(sc, t, 'impact3', cym='crash_big', boom='big')
            if sec in ('hook', 'metric'):
                for part, lo, hi in ((sc['choir_l'], 62, 74), (sc['choir_r'], 50, 62)):
                    for q in voicing(chord_at(t), lo, hi):
                        part.acc(t, 1.2 if sec == 'hook' else 1.7, q, 100 if sec == 'hook' else 112)
        elif typ == 'impact':
            if sec == 'hook':
                accent(sc, t, 'hookhit', HOOK_HIT_CHORDS[hook_i % len(HOOK_HIT_CHORDS)], scale=0.80)
                hook_i += 1
            else:
                accent(sc, t, 'impact2', cym='half')
        elif typ == 'hit':
            run_i = run_i + 1 if t - last_hit <= 1.01 else 0
            last_hit = t
            cym = 'crash_big' if run_i == 0 else ('crash' if run_i % 2 == 0 else 'splash')
            accent(sc, t, 'hit', cym=cym)
        elif typ == 'stamp':
            if sec in ('finale', 'outro'):
                accent(sc, t, 'stamp_big', cym='crash' if finale_stamp == 0 else 'splash')
                finale_stamp += 1
            else:
                accent(sc, t, 'stamp', scale=0.9)


# ----------------------------------------------------------------------------
# Pattern helpers
# ----------------------------------------------------------------------------
ACC332 = (0, 3, 6, 8, 11, 14)


def ost_r58(part, bar, lo, v_acc, v_norm, dur=0.11, octave=0, sixes=range(16)):
    """3-3-2 16th ostinato: R 5 8 | R 5 8 | R 5 | R 5 8 | R 5 8 | R 5."""
    shape = ['R', '5', '8', 'R', '5', '8', 'R', '5', 'R', '5', '8', 'R', '5', '8', 'R', '5']
    for s in sixes:
        t = S(bar, s)
        r, th, fi = triad(chord_at(t), lo)
        p = {'R': r, '5': fi, '8': r + 12}[shape[s]] + 12 * octave
        part.n(t, dur, p, v_acc if s in ACC332 else v_norm)


def bass332(part, bar, lo, v_acc, v_norm, dur=0.2, sixes=ACC332):
    for s in sixes:
        t = S(bar, s)
        part.n(t, dur, lowest(bass_pc(chord_at(t)), lo), v_acc if s in (0, 8) else v_norm)


def pad(part, bar, lo, hi, vel, n=None, legato=0.98, offset=0, until_bar=None):
    for (t0, t1, sym) in segments(bar):
        for p in voicing(sym, lo, hi, n):
            part.n(t0, (t1 - t0) * legato, p + offset, vel)


def pad_bars(part, bars, lo, hi, vel, n=None, merge=True):
    """Sustained chord pad; tied across bars when the chord does not change."""
    segs = []
    for b in bars:
        segs += segments(b)
    merged = []
    for s in segs:
        if merge and merged and merged[-1][2] == s[2] and abs(merged[-1][1] - s[0]) < 1e-6:
            merged[-1] = (merged[-1][0], s[1], s[2])
        else:
            merged.append(s)
    for (t0, t1, sym) in merged:
        for p in voicing(sym, lo, hi, n):
            part.n(t0, (t1 - t0) - 0.02, p, vel)


def lute8(part, bar, lo, v_acc, v_norm, dur=0.4):
    for i in range(8):
        t = T(bar) + i * 0.25
        r, th, fi = triad(chord_at(t), lo)
        p = [r, fi, r + 12, th + 12, fi + 12, th + 12, r + 12, fi][i]
        part.n(t, dur, p, v_acc if i in (0, 4) else v_norm)


def harp16(part, bar, lo, v_acc, v_norm):
    for s in range(16):
        t = S(bar, s)
        sym = chord_at(t)
        tones = [p for p in tones_in(sym, lo, lo + 26)][:8]
        seq = tones + tones[::-1]
        part.n(t, 0.4, seq[s % len(seq)], v_acc if s % 4 == 0 else v_norm)


def melody(part, theme, t0, vel, transpose=0, legato=0.96, accent_vel=None, last_dur=None):
    for i, (b, d, name) in enumerate(theme):
        dur = d * BEAT
        if last_dur is not None and i == len(theme) - 1:
            dur = last_dur
        v = vel
        if accent_vel is not None and abs((b % 4)) < 1e-6:
            v = accent_vel
        part.n(t0 + b * BEAT, dur * legato, P(name) + transpose, v)


def roll(part, t0, t1, pitch, v0, v1, step=T32, curve=1.0):
    k = int(round((t1 - t0) / step))
    for i in range(k):
        x = i / max(1, k - 1)
        part.acc(t0 + i * step, step * 0.9, pitch, int(v0 + (v1 - v0) * x ** curve))


# ----------------------------------------------------------------------------
# The score
# ----------------------------------------------------------------------------
def build_score(timeline) -> Score:
    sc = Score()
    make_parts(sc)
    p = sc.parts

    # Default expression for every part.
    for part in p.values():
        part.expr(0.0, 127)

    # ======================================================================
    # HOOK  bars 1-8  (0-16 s)
    # ======================================================================
    # -- bars 1-3: low drone + choir hum, hits only on the five kinetic words
    sc.fx.append(dict(kind='subdrone', t0=0.0, t1=12.6, f=36.71, level=0.36, fade_in=1.2, fade_out=1.6))
    p['basses_sus'].n(0.0, 11.96, 'D2', 76)
    p['basses_sus'].ramp(0.0, 4.0, 62, 96)
    p['basses_sus'].ramp(6.0, 12.0, 104, 92)
    p['basses_sus'].n(12.0, 1.96, 'C2', 88)
    p['basses_sus'].n(14.0, 1.96, 'A1', 96)
    p['basses_sus'].ramp(12.0, 16.0, 92, 127)
    p['vc_sus'].n(0.0, 11.96, 'D3', 62)
    p['vc_sus'].n(0.0, 7.96, 'A2', 66)            # chromatic creep A-Bb-B-C-C#
    p['vc_sus'].n(8.0, 1.96, 'Bb2', 70)
    p['vc_sus'].n(10.0, 1.96, 'B2', 74)
    p['vc_sus'].ramp(0.0, 4.0, 60, 100)
    p['vc_sus'].expr(6.0, 100)
    for part, notes in ((p['oohs_r'], ['D3', 'A3']), (p['oohs_l'], ['A3', 'D4'])):
        for nm in notes:
            part.n(0.0, 5.9, nm, 72)
        part.ramp(0.0, 4.0, 44, 84)
        part.ramp(4.0, 6.0, 84, 72)
    p['drone'].n(2.0, 3.9, 'D3', 48)
    p['drone'].n(2.0, 3.9, 'A3', 44)
    p['drone'].ramp(2.0, 4.0, 40, 92)
    p['drone'].ramp(4.0, 6.0, 92, 60)


    # -- bars 4-6: pizzicato 8th ostinato over the creeping low strings
    def pizz_bar(bar, vel_acc, vel_norm, upto=8):
        for i in range(upto):
            t = T(bar) + i * 0.25
            sym = chord_at(t)
            b = lowest(bass_pc(sym), 45)
            up = [q for q in tones_in(sym, b + 5, b + 24)][:3]
            pitch = [b, up[0], up[1], up[0], up[2], up[0], up[1], up[0]][i]
            p['pizz'].n(t, 0.2, pitch, vel_acc if i % 4 == 0 else vel_norm)
    for bar, va, vn in ((4, 88, 70), (5, 90, 72), (6, 92, 74), (7, 96, 78)):
        pizz_bar(bar, va, vn)
    pizz_bar(8, 100, 84, upto=4)
    for bar in (4, 5, 6):
        for beat in (1, 3):
            p['bass_pizz'].n(T(bar, beat), 0.4, 'D2', 92 if beat == 1 else 80)
    for bar in (4, 5, 6, 7, 8):
        pad(p['oohs_r'], bar, 48, 60, 58)
        pad(p['oohs_l'], bar, 57, 67, 54)
    p['oohs_r'].expr(6.0, 70)
    p['oohs_l'].expr(6.0, 70)
    p['oohs_r'].ramp(12.0, 16.0, 70, 120)
    p['oohs_l'].ramp(12.0, 16.0, 70, 120)


    # -- bars 7-8: build -- snare roll, rising strings, riser into the drop
    rise = [('E4', 12.0, 0.5), ('G4', 12.5, 0.5), ('A4', 13.0, 0.5), ('C5', 13.5, 0.5),
            ('A4', 14.0, 0.5), ('C#5', 14.5, 0.5), ('E5', 15.0, 1.0)]
    for nm, t, d in rise:
        p['trem_vln'].n(t, d - 0.02, nm, 96)
        p['trem_vln'].n(t, d - 0.02, P(nm) - 12, 84)
    p['trem_vln'].expr(0.0, 72)
    p['trem_vln'].ramp(12.0, 16.0, 72, 127, curve=1.2)
    for (t0, nm) in ((12.0, ['G3', 'C4']), (14.0, ['A3', 'E4'])):
        for q in nm:
            p['trem_vla'].n(t0, 1.96, q, 92)
    p['trem_vla'].expr(0.0, 72)
    p['trem_vla'].ramp(12.0, 16.0, 72, 127, curve=1.2)
    p['trem_vc'].n(12.0, 1.96, 'C3', 96)
    p['trem_vc'].n(14.0, 1.96, 'C#3', 102)
    p['trem_vc'].expr(0.0, 70)
    p['trem_vc'].ramp(12.0, 16.0, 70, 127)
    roll(p['msnare'], 12.0, 13.0, M_SNARE, 40, 56, step=0.25)
    roll(p['msnare'], 13.0, 14.0, M_SNARE, 56, 72, step=SIX)
    roll(p['taiko'], 13.0, 14.0, K_TAIKO_S, 62, 84, step=0.25)
    roll(p['taiko'], 14.0, 15.0, K_TAIKO_S, 84, 100, step=0.25)
    roll(p['msnare'], 14.0, 15.0, M_SNARE, 72, 94, step=SIX)
    roll(p['msnare'], 15.0, 16.0 - SIX, M_SNARE, 88, 124, step=T32, curve=1.3)
    roll(p['timpani'], 14.0, 16.0 - SIX, P('A2'), 40, 118, step=T32, curve=1.6)
    roll(p['taiko_hi'], 14.0, 15.0, 45, 60, 92, step=0.25)
    roll(p['taiko_hi'], 15.0, 16.0 - SIX, 45, 92, 124, step=SIX)
    for q in ('G3', 'C4', 'E4'):
        p['horns'].n(12.0, 1.96, q, 70)
    for q in ('A3', 'C#4', 'E4'):
        p['horns'].n(14.0, 1.96, q, 90)
    p['horns'].expr(0.0, 76)
    p['horns'].ramp(12.0, 16.0, 76, 127)
    p['trombones'].n(14.0, 1.96, 'A2', 88)
    p['trombones'].n(14.0, 1.96, 'E3', 84)
    p['trombones'].expr(0.0, 50)
    p['trombones'].ramp(14.0, 16.0, 50, 127)
    # reset expressions at the drop
    for nm in ('trem_vln', 'trem_vla', 'trem_vc', 'horns', 'trombones', 'oohs_l', 'oohs_r',
               'basses_sus'):
        p[nm].expr(16.0, 127)

    # ======================================================================
    # REVEAL  bars 9-16 (16-32 s) -- DROP A: full heroic theme
    # ======================================================================
    melody(p['horn_lead'], THEME_A, T(9), 100, accent_vel=110)
    melody(p['horn_lead'], THEME_B, T(13), 102, accent_vel=112)
    melody(p['vln_lead'], THEME_A, T(9), 86, accent_vel=94)
    melody(p['vln_lead'], THEME_B, T(13), 88, accent_vel=96)
    melody(p['vc_theme'], THEME_A, T(9), 92, transpose=-12, accent_vel=100)
    melody(p['vc_theme'], THEME_B, T(13), 94, transpose=-12, accent_vel=102)
    pad_bars(p['choir_l'], range(9, 17), 60, 72, 100)
    pad_bars(p['choir_r'], range(9, 17), 48, 60, 100)
    pad_bars(p['horns'], range(9, 17), 53, 64, 84)
    pad_bars(p['brass_sect'], range(9, 17), 55, 67, 70)
    for bar in range(9, 17):
        for beat in (1, 3):
            t = T(bar, beat)
            sym = chord_at(t)
            ls = low_stack(sym, 45)
            p['trombones'].n(t, 0.95, ls[0], 92 if beat == 1 else 82)
            p['trombones'].n(t, 0.95, ls[1], 86 if beat == 1 else 78)
        p['tuba'].n(T(bar), 0.9, lowest(bass_pc(chord_at(T(bar))), 33), 92)
        bass332(p['basses'], bar, 36, 104, 84)
        ost_r58(p['ost_lo'], bar, 48, 102, 80)
        ost_r58(p['ost_hi'], bar, 48, 82, 64, octave=1)
        # taiko groove (3-3-2) + high taiko answers
        for s, v in zip(ACC332, (122, 98, 108, 116, 98, 108)):
            p['taiko'].n(S(bar, s), 0.3, K_TAIKO_L, v)
        for s, v in ((4, 92), (12, 96), (13, 66), (15, 72)):
            p['taiko_hi'].n(S(bar, s), 0.3, 50, v)
        p['bassdrum'].n(S(bar, 0), 0.6, 36, 92)
        p['bassdrum'].n(S(bar, 8), 0.6, 36, 72)
        p['timpani'].n(T(bar), 0.4, timp_pitch(chord_at(T(bar))), 98)
        p['timpani'].n(S(bar, 6), 0.3, timp_pitch(chord_at(S(bar, 6))), 82)
    for bar in (12, 16):
        roll(p['snare'], S(bar, 12), S(bar, 16), K_SN, 58, 100, step=SIX)
    p['kitcym'].acc(24.0, 2.0, K_CRASH2, 92)
    sc.fx.append(dict(kind='revcym', t1=32.0, dur=1.0, level=0.55))

    # ======================================================================
    # FEAT1  bars 17-24 (32-48 s) -- Crafting: lute/harp, frame drum, forge
    # ======================================================================
    for bar in range(17, 25):
        lute8(p['lute'], bar, 45, 84, 70)
        if bar >= 21:
            harp16(p['harp'], bar, 50, 60, 48)
        for i in range(8):
            t = T(bar) + i * 0.25
            r, th, fi = triad(chord_at(t), 43)
            pitch = [r, r, fi, r, r, r, fi, r + 12][i]
            p['vc_ost'].n(t, 0.18, pitch, 80 if i in (0, 3, 6) else 62)
        for beat in (1, 3):
            t = T(bar, beat)
            p['bass_pizz'].n(t, 0.45, lowest(bass_pc(chord_at(t)), 36), 96 if beat == 1 else 80)
        # frame drum: doum / tek
        for s, v in ((0, 96), (6, 82), (8, 90)):
            p['frame'].n(S(bar, s), 0.2, K_TUMBA, v)
        for s, v in ((3, 70), (10, 72), (12, 76)):
            p['frame'].n(S(bar, s), 0.2, K_CONGA, v)
        for s, v in ((5, 50), (14, 54), (15, 48)):
            p['frame'].n(S(bar, s), 0.2, K_BONGO, v)
        p['taiko'].n(T(bar), 0.3, K_TAIKO_S, 86)
        if bar > 17:
            sc.fx.append(dict(kind='anvil', t=T(bar), vel=0.75))
        if bar % 2 == 0:
            sc.fx.append(dict(kind='anvil', t=T(bar, 3.5), vel=0.38))
    pad_bars(p['oohs_r'], range(17, 25), 50, 62, 56)
    pad_bars(p['oohs_l'], range(17, 25), 57, 67, 52)
    p['timpani'].n(T(21), 0.4, timp_pitch('Dm'), 84)
    # flute counter-line: low register, long notes; motif cell in the VO gap (bar 19)
    fl = p['flute']
    for (t, d, nm, v) in [(T(17, 3), 1.0, 'F4', 54), (T(18), 1.9, 'E4', 52),
                          (T(19), 0.5, 'G4', 80), (T(19, 2), 0.75, 'D5', 86),
                          (T(19, 3.5), 0.25, 'C5', 78), (T(19, 4), 0.5, 'B4', 70),
                          (T(20), 1.9, 'A4', 50), (T(21), 0.95, 'F4', 50), (T(21, 3), 0.95, 'A4', 50),
                          (T(22), 1.9, 'G4', 50), (T(23), 0.95, 'F4', 50), (T(23, 3), 0.95, 'D4', 48),
                          (T(24), 0.95, 'D4', 50), (T(24, 3), 0.95, 'C#4', 52)]:
        fl.n(t, d, nm, v)
    roll(p['snare'], S(24, 12), S(24, 16), K_SN, 50, 92, step=SIX)
    sc.fx.append(dict(kind='revcym', t1=48.0, dur=1.0, level=0.5))

    # ======================================================================
    # FEAT2  bars 25-32 (48-64 s) -- Black Market: dark, low brass stabs
    # ======================================================================
    for bar in range(25, 33):
        sym = chord_at(T(bar))
        stabs = [(0, 110), (3, 96), (6, 102)] + ([(12, 92), (14, 98)] if bar % 2 == 0 else [])
        if bar < 31:
            for s, v in stabs:
                for q in tones_in(sym, 50, 61)[:3]:
                    p['trombones'].n(S(bar, s), 0.22, q, v)
        for s, v in ((0, 106), (6, 94)):
            p['tuba'].n(S(bar, s), 0.25, lowest(bass_pc(sym), 33), v)
        for s in range(0, 16, 2):
            v = 92 if s in (0, 6, 8, 14) else 72
            p['basses'].n(S(bar, s), 0.16, lowest(bass_pc(sym), 36), v)
        ost_r58(p['vc_ost'], bar, 43, 88, 64, dur=0.1)
        for s in (2, 6, 10, 14):
            r, th, fi = triad(chord_at(S(bar, s)), 50)
            p['ost_lo'].n(S(bar, s), 0.12, th, 80)
            p['ost_lo'].n(S(bar, s), 0.12, fi, 76)
        for s, v in ((0, 114), (3, 88), (6, 100), (10, 94)):
            p['taiko'].n(S(bar, s), 0.3, K_TAIKO_L, v)
        for s, v in ((8, 84), (12, 90)):
            p['taiko_hi'].n(S(bar, s), 0.3, 47, v)
        p['bassdrum'].n(S(bar, 0), 0.6, 36, 94)
        for s, v in ((0, 104), (6, 88)):
            p['timpani'].n(S(bar, s), 0.35, timp_pitch(chord_at(S(bar, s))), v)
        if bar in (28, 32):
            roll(p['taiko_hi'], S(bar, 12), S(bar, 16), 50, 70, 104, step=SIX)
    pad_bars(p['oohs_r'], range(25, 33), 45, 57, 64)
    pad_bars(p['oohs_l'], range(25, 33), 53, 62, 58)
    pad_bars(p['horns'], range(25, 31), 50, 60, 56)
    # motif in horns + trombones in the VO gap (60.2-64.6)
    melody(p['horn_lead'], CELL_DARK, T(31), 96, accent_vel=104)
    melody(p['trombones'], CELL_DARK, T(31), 96, transpose=-12, accent_vel=104)
    roll(p['snare'], S(32, 12), S(32, 16), K_SN, 54, 96, step=SIX)
    sc.fx.append(dict(kind='revcym', t1=64.0, dur=1.0, level=0.5))

    # ======================================================================
    # FEAT3  bars 33-40 (64-80 s) -- Item prices: bright Dorian reel
    # ======================================================================
    for bar in range(33, 41):
        for s in range(0, 16, 2):
            v = 100 if s in (4, 12) else (74 if s in (0, 8) else 56)
            p['tamb'].n(S(bar, s), 0.1, K_TAMB, v)
        for s in (7, 15):
            p['tamb'].n(S(bar, s), 0.1, K_TAMB, 44)
        for s, v in ((0, 96), (6, 82), (8, 90)):
            p['frame'].n(S(bar, s), 0.2, K_TUMBA, v)
        for s, v in ((3, 70), (10, 72), (12, 76)):
            p['frame'].n(S(bar, s), 0.2, K_CONGA, v)
        p['taiko'].n(T(bar), 0.3, K_TAIKO_S, 92)
        if bar % 2 == 1:
            p['taiko'].n(S(bar, 8), 0.3, K_TAIKO_L, 76)
        lute8(p['lute'], bar, 45, 86, 72)
        harp16(p['harp'], bar, 50, 60, 48)
        for i in range(8):
            t = T(bar) + i * 0.25
            r, th, fi = triad(chord_at(t), 43)
            pitch = [r, fi, r, fi, r, fi, r + 12, fi][i]
            p['vc_ost'].n(t, 0.18, pitch, 78 if i % 2 == 0 else 62)
        for beat in (1, 3):
            t = T(bar, beat)
            p['bass_pizz'].n(t, 0.45, lowest(bass_pc(chord_at(t)), 36), 96 if beat == 1 else 82)
    pad_bars(p['oohs_r'], range(33, 41), 50, 62, 54)
    pad_bars(p['oohs_l'], range(33, 41), 57, 69, 50)
    p['drone'].n(T(33), 11.9, 'D3', 46)
    p['drone'].n(T(33), 11.9, 'A3', 42)
    p['drone'].expr(T(33), 70)
    p['drone'].ramp(T(38), T(39), 70, 30)
    # fiddle reel: sparse and low under VO, dense flourishes in the gaps
    fd = p['fiddle']
    fiddle = [
        # bar 33 (VO 64.6-67.7): pickup run then long notes
        (S(33, 0), SIX, 'D4', 84), (S(33, 1), SIX, 'E4', 76), (S(33, 2), SIX, 'F4', 78), (S(33, 3), SIX, 'G4', 80),
        (S(33, 4), 0.75, 'A4', 64), (T(33, 3), 0.95, 'F4', 50),
        (T(34), 1.45, 'G4', 50), (T(34, 4), 0.25, 'A4', 78), (T(34, 4.5), 0.25, 'B4', 82),
        # bar 35 (gap 67.7-69.6): reel phrase
        (S(35, 0), 0.25, 'D5', 96), (S(35, 2), 0.25, 'A4', 84), (S(35, 4), 0.25, 'F5', 94), (S(35, 6), 0.25, 'E5', 86),
        (S(35, 8), SIX, 'D5', 90), (S(35, 9), SIX, 'E5', 82), (S(35, 10), 0.25, 'D5', 84), (S(35, 12), 0.5, 'A4', 80),
        # bar 36-37 (VO): long low notes
        (T(36), 1.9, 'B4', 48), (T(37), 0.95, 'A4', 46), (T(37, 3), 0.95, 'C5', 48),
        # bar 38 (gap 74.2-75.6)
        (S(38, 0), 0.25, 'E5', 94), (S(38, 2), 0.25, 'D5', 84), (S(38, 4), SIX, 'C5', 86), (S(38, 5), SIX, 'D5', 80),
        (S(38, 6), 0.25, 'E5', 88), (S(38, 8), 0.25, 'G5', 92), (S(38, 10), 0.25, 'E5', 84),
        # bar 39 (VO until 77.1), flourish from beat 3
        (T(39), 0.95, 'D5', 46), (S(39, 8), SIX, 'G5', 94), (S(39, 9), SIX, 'F5', 82), (S(39, 10), SIX, 'E5', 86),
        (S(39, 11), SIX, 'D5', 82), (S(39, 12), SIX, 'C5', 88), (S(39, 13), SIX, 'B4', 80), (S(39, 14), SIX, 'A4', 84),
        (S(39, 15), SIX, 'B4', 82),
        # bar 40 (gap): full flourish over A
        (S(40, 0), SIX, 'C#5', 98), (S(40, 1), SIX, 'D5', 84), (S(40, 2), SIX, 'E5', 90), (S(40, 3), SIX, 'C#5', 84),
        (S(40, 4), SIX, 'A4', 92), (S(40, 5), SIX, 'B4', 84), (S(40, 6), SIX, 'C#5', 88), (S(40, 7), SIX, 'E5', 86),
        (S(40, 8), 0.25, 'A5', 100), (S(40, 10), 0.25, 'G5', 88), (S(40, 12), 0.25, 'E5', 90), (S(40, 14), 0.25, 'C#5', 92),
    ]
    for (t, d, nm, v) in fiddle:
        fd.n(t, d * 0.95, nm, v)
        if t >= T(35) and v >= 80 and not (T(36) <= t < T(38)):
            p['flute'].n(t, d * 0.95, nm, v - 10)
    roll(p['snare'], S(40, 12), S(40, 16), K_SN, 56, 100, step=SIX)
    sc.fx.append(dict(kind='revcym', t1=80.0, dur=1.0, level=0.6))

    # ======================================================================
    # MONTAGE  bars 41-44 (80-88 s): hit on every beat 1 and 3
    # ======================================================================
    melody(p['horn_lead'], THEME_A, T(41), 104, accent_vel=112)
    melody(p['trombones'], THEME_A, T(41), 100, transpose=-12, accent_vel=108)
    pad_bars(p['choir_l'], range(41, 45), 60, 72, 92)
    pad_bars(p['choir_r'], range(41, 45), 48, 60, 92)
    for bar in range(41, 45):
        ost_r58(p['ost_lo'], bar, 48, 100, 76)
        ost_r58(p['ost_hi'], bar, 48, 82, 62, octave=1)
        bass332(p['basses'], bar, 36, 108, 88)
        for s, v in zip(ACC332, (124, 94, 106, 120, 94, 106)):
            p['taiko'].n(S(bar, s), 0.3, K_TAIKO_L, v)
        for s, v in ((4, 92), (12, 96), (13, 70), (15, 76)):
            p['taiko_hi'].n(S(bar, s), 0.3, 50, v)
    roll(p['msnare'], 87.0, 88.0 - SIX, M_SNARE, 70, 120, step=T32, curve=1.2)
    roll(p['timpani'], 87.0, 88.0 - SIX, P('A2'), 60, 116, step=T32)

    # ======================================================================
    # BREAKDOWN  bars 45-48 (88-96 s): drums out, heartbeat, choir + strings
    # ======================================================================
    pad_bars(p['choir_l'], range(45, 49), 60, 72, 66)
    pad_bars(p['choir_r'], range(45, 49), 48, 60, 66)
    pad_bars(p['vln1_sus'], range(45, 49), 69, 81, 58, n=2)
    pad_bars(p['vla_sus'], range(45, 49), 55, 66, 58)
    pad_bars(p['vc_sus'], range(45, 49), 43, 55, 60, n=2)
    for nm in ('choir_l', 'choir_r', 'vln1_sus', 'vla_sus', 'vc_sus'):
        p[nm].expr(88.0, 78)
        p[nm].ramp(94.0, 96.0, 78, 127)
    sc.fx.append(dict(kind='subdrone', t0=88.0, t1=96.0, f=36.71, level=0.22, fade_in=1.0, fade_out=0.3))
    for bar in (45, 46, 47):
        for s, v in ((0, 104), (2, 80), (8, 98), (10, 76)):
            p['timpani'].acc(S(bar, s), 0.4, P('D2'), v)
            p['bassdrum'].acc(S(bar, s), 0.4, 36, v - 48)
    for k, s in enumerate((0, 2, 4, 6, 8, 10, 12, 14)):
        pitch = P('Bb2') if s < 8 else P('A2')
        p['timpani'].acc(S(48, s), 0.3, pitch, 84 + 4 * k if s % 4 == 0 else 66 + 4 * k)
    melody(p['horn_lead'], THEME_A[:7], T(46), 70, accent_vel=76)
    p['horn_lead'].n(T(48), 1.9, 'A4', 76)
    for q in voicing('Bb', 62, 74):
        p['trem_vln'].n(T(48), 0.98, q, 90)
    for q in voicing('A', 61, 76):
        p['trem_vln'].n(T(48, 3), 0.98, q, 96)
    p['trem_vla'].n(T(48), 0.98, 'F3', 88)
    p['trem_vla'].n(T(48, 3), 0.98, 'E3', 92)
    p['trem_vc'].n(T(48), 0.98, 'Bb2', 92)
    p['trem_vc'].n(T(48, 3), 0.98, 'A2', 96)
    for nm in ('trem_vln', 'trem_vla', 'trem_vc'):
        p[nm].expr(T(48) - 0.05, 50)
        p[nm].ramp(T(48), 96.0, 50, 127, curve=1.5)

    # ======================================================================
    # METRIC  bars 49-52 (96-104 s): massive hit, tremolo build, snare roll
    # ======================================================================
    trem_v = {49: ('Dm', 62, 74), 50: ('Bb', 65, 77), 51: ('G', 67, 79), 52: ('A', 69, 81)}
    for bar, (_, lo, hi) in trem_v.items():
        for (t0, t1, sym) in segments(bar):
            d = t1 - t0 - 0.04
            for q in voicing(sym, lo, hi):
                p['trem_vln'].n(t0, d, q, 92)
            for q in voicing(sym, lo - 12, hi - 12, n=2):
                p['trem_vla'].n(t0, d, q, 90)
            p['trem_vc'].n(t0, d, lowest(bass_pc(sym), 43), 94)
    for nm in ('trem_vln', 'trem_vla', 'trem_vc'):
        p[nm].expr(96.0, 64)
        p[nm].ramp(96.5, 104.0, 64, 127, curve=1.3)
    for bar in (50, 51, 52):
        pad(p['choir_l'], bar, 60, 72, 80 + 6 * (bar - 50))
        pad(p['choir_r'], bar, 48, 60, 80 + 6 * (bar - 50))
    for bar in range(49, 53):
        for i in range(8):
            t = T(bar) + i * 0.25
            v = 62 + int(36 * ((bar - 49) * 8 + i) / 31)
            p['basses'].n(t, 0.16, lowest(bass_pc(chord_at(t)), 36), v)
            p['vc_ost'].n(t, 0.16, lowest(bass_pc(chord_at(t)), 48), v - 6)
    p['taiko'].n(T(49, 3), 0.3, K_TAIKO_L, 86)
    p['taiko'].n(T(50), 0.3, K_TAIKO_L, 96)
    p['taiko'].n(T(50, 3), 0.3, K_TAIKO_L, 90)
    roll(p['taiko'], T(51), T(52), K_TAIKO_S, 76, 104, step=0.25)
    roll(p['taiko'], T(52), T(53) - SIX, K_TAIKO_S, 92, 124, step=SIX)
    roll(p['msnare'], T(51), T(52), M_SNARE, 50, 82, step=SIX)
    roll(p['msnare'], T(52), T(53) - SIX, M_SNARE, 82, 124, step=T32, curve=1.3)
    roll(p['timpani'], T(52), T(53) - SIX, P('A2'), 64, 120, step=T32, curve=1.4)
    melody(p['horn_lead'], ANSWER, T(51), 98, accent_vel=106)
    pad_bars(p['horns'], range(49, 53), 53, 64, 74)
    p['horns'].ramp(96.0, 104.0, 90, 127)
    for bar in (51, 52):
        for (t0, t1, sym) in segments(bar):
            ls = low_stack(sym, 45)
            p['trombones'].n(t0, t1 - t0 - 0.02, ls[0], 88)
            p['trombones'].n(t0, t1 - t0 - 0.02, ls[1], 84)
    p['trombones'].expr(T(51) - 0.05, 70)
    p['trombones'].ramp(T(51), 104.0, 70, 127)
    for nm in ('horns', 'trombones', 'trem_vln', 'trem_vla', 'trem_vc'):
        p[nm].expr(104.0, 127)

    # ======================================================================
    # FINALE  bars 53-58 (104-116 s): full theme, triumphant
    # ======================================================================
    melody(p['horn_lead'], THEME_A, T(53), 108, accent_vel=116)
    melody(p['horn_lead'], FIN_EXT, T(57), 110, accent_vel=118)
    melody(p['trp_lead'], THEME_A, T(53), 96, accent_vel=104)
    melody(p['trp_lead'], FIN_EXT, T(57), 100, accent_vel=108)
    melody(p['vln_lead'], THEME_A, T(53), 96, transpose=12, accent_vel=104)
    melody(p['vln_lead'], FIN_EXT, T(57), 98, transpose=12, accent_vel=106)
    melody(p['vc_theme'], THEME_A, T(53), 98, transpose=-12, accent_vel=106)
    melody(p['vc_theme'], FIN_EXT, T(57), 100, transpose=-12, accent_vel=108)
    pad_bars(p['choir_l'], range(53, 59), 62, 76, 110)
    pad_bars(p['choir_r'], range(53, 59), 50, 64, 110)
    pad_bars(p['horns'], range(53, 59), 53, 65, 92)
    pad_bars(p['brass_sect'], range(53, 59), 55, 67, 88)
    pad_bars(p['vln1_sus'], range(53, 59), 74, 86, 86, n=2)
    pad_bars(p['vla_sus'], range(53, 59), 57, 69, 84)
    for bar in range(53, 59):
        for beat in (1, 3):
            t = T(bar, beat)
            ls = low_stack(chord_at(t), 45)
            p['trombones'].n(t, 0.95, ls[0], 96 if beat == 1 else 86)
            p['trombones'].n(t, 0.95, ls[1], 90 if beat == 1 else 82)
            p['tuba'].n(t, 0.9, lowest(bass_pc(chord_at(t)), 33), 100 if beat == 1 else 88)
        bass332(p['basses'], bar, 36, 110, 90)
        ost_r58(p['ost_lo'], bar, 48, 110, 88)
        ost_r58(p['ost_hi'], bar, 48, 96, 74, octave=1)
        for s, v in zip(ACC332, (127, 102, 112, 124, 102, 112)):
            p['taiko'].n(S(bar, s), 0.3, K_TAIKO_L, v)
        for s, v in ((4, 96), (12, 100), (13, 72), (15, 80)):
            p['taiko_hi'].n(S(bar, s), 0.3, 50, v)
        p['bassdrum'].n(S(bar, 0), 0.6, 36, 100)
        p['bassdrum'].n(S(bar, 8), 0.6, 36, 82)
        p['timpani'].n(T(bar), 0.4, timp_pitch(chord_at(T(bar))), 104)
        p['timpani'].n(S(bar, 6), 0.3, timp_pitch(chord_at(S(bar, 6))), 88)
    p['kitcym'].acc(108.0, 2.0, K_CRASH2, 96)
    p['kitcym'].acc(112.0, 2.0, K_CRASH, 98)
    roll(p['msnare'], T(58, 3), T(59) - SIX, M_SNARE, 80, 124, step=T32, curve=1.2)
    roll(p['timpani'], T(58, 3), T(59) - SIX, P('C3'), 70, 120, step=T32)
    for i, nm in enumerate(['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6', 'E6']):
        p['harp'].acc(115.375 + i * T32, 0.3, nm, 70 + 4 * i)

    # ======================================================================
    # OUTRO  bars 59-60 (116-120 s): Picardy D major, ring out
    # ======================================================================
    ring = 1.9
    p['horn_lead'].acc(116.0, ring, P('F#5'), 112)
    p['trp_lead'].acc(116.0, ring, P('F#5'), 104)
    p['vln_lead'].acc(116.0, ring, P('F#6'), 98)
    p['vc_theme'].acc(116.0, ring, P('D3'), 104)
    for nm, pitches, v in (('horns', ['D4', 'F#4', 'A4'], 104), ('brass_sect', ['A3', 'D4', 'F#4', 'A4'], 100),
                           ('trombones', ['D3', 'A3'], 104), ('tuba', ['D2'], 104),
                           ('basses_sus', ['D2'], 108), ('vc_sus', ['D3', 'A3'], 100),
                           ('vla_sus', ['F#3', 'A3', 'D4'], 96), ('vln1_sus', ['A4', 'D5', 'F#5'], 96),
                           ('choir_l', ['A4', 'D5', 'F#5'], 108), ('choir_r', ['D3', 'A3', 'D4', 'F#4'], 108)):
        for q in pitches:
            p[nm].acc(116.0, ring, P(q), v)
    for nm in ('vla_sus', 'vln1_sus', 'vc_sus', 'basses_sus', 'choir_l', 'choir_r'):
        p[nm].expr(115.9, 127)
    for i, nm in enumerate(['D3', 'F#3', 'A3', 'D4', 'F#4', 'A4', 'D5', 'F#5', 'A5', 'D6']):
        p['harp'].acc(116.0 + i * T32, 1.5, nm, 96 - 2 * i)
    p['timpani'].acc(116.0, 1.5, P('D2'), 127)

    place_accents(sc, timeline)
    place_builds(sc, timeline)
    for part in p.values():
        part.finalize()
    return sc


# ----------------------------------------------------------------------------
# Analysis helpers
# ----------------------------------------------------------------------------
def vo_windows(timeline, wps=2.6, tail=0.25):
    vo = sorted(timeline['vo'], key=lambda v: v['t'])
    out = []
    for i, v in enumerate(vo):
        words = len(v['text'].split())
        end = v['t'] + words / wps + tail
        if i + 1 < len(vo):
            end = min(end, vo[i + 1]['t'] - 0.05)
        out.append((v['t'], end, v['id']))
    return out


def check_grid(sc: Score):
    bad = []
    for part in sc.parts.values():
        for (t, d, p, v) in part.notes:
            q = t / T32
            if abs(q - round(q)) > 1e-6:
                bad.append((part.name, t))
    return bad
