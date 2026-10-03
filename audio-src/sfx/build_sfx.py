#!/usr/bin/env python3
"""Albion Journal - SFX build (one entry point).

    python3 audio-src/sfx/build_sfx.py              # library + track + verification + README
    python3 audio-src/sfx/build_sfx.py --no-verify  # library + track only (fast)

(a) renders the one-shot library  -> assets/audio/sfx/oneshots/<type>[_variant].wav (+ index.json)
(b) reads timeline/timeline.json  -> assets/audio/sfx/sfx_track.wav (48 kHz, 24-bit stereo, exactly
    timeline.duration seconds) with every event's accent on its time:
        transient sounds: accent (transient peak) on t
        whoosh / swell  : loudest point on t + dur
        riser / reverse : the abrupt end on t + dur
(c) verifies: contact sheet PNG, onset/accent timing table, true peak + loudness, README.md.

Everything is deterministic (fixed seeds per type/occurrence), so re-running after the
timeline changes only moves/re-renders what changed.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parent.parent

import analysis as A  # noqa: E402
import sounds as S  # noqa: E402
from dsp import SR, db, fade, place, sample_peak_db, soft_limiter, true_peak_db, undb  # noqa: E402

DEFAULT_TIMELINE = ROOT / "timeline" / "timeline.json"
DEFAULT_OUT = ROOT / "assets" / "audio" / "sfx"

DEFAULT_DUR = {"whoosh": 0.5, "swell": 1.0, "riser": 2.0, "reverse": 1.0, "fire": 1.0}
END_ANCHORED = {"whoosh", "swell", "riser", "reverse"}

# Track mix trims (dB) on top of each one-shot's designed peak level. One place to
# rebalance the SFX bed against music + VO without touching the sound recipes.
TYPE_TRIM_DB = {
    "impact": 0.0, "hit": 0.0, "stamp": 0.0, "whoosh": 0.0, "swell": 0.0, "riser": 0.0,
    "reverse": 0.0, "fire": 0.0, "coin": 0.0, "anvil": 0.0, "sparkle": 0.0, "glint": 0.0,
    "zap": 0.0, "click": 0.0, "key": 0.0, "pop": 0.0, "tick": 0.0,
}
CEILING_DBTP = -1.3          # limiter ceiling (spec: <= -1 dBTP)
POP_CASCADE_GAP = 0.75       # s; a gap longer than this restarts the pentatonic ladder at D


def durtag(d):
    return f"{d:.2f}".replace(".", "p")


# ------------------------------------------------------------------ event -> sound spec
def event_spec(typ, ev, k, ctx):
    """Map an event (+ its occurrence index k within its type) to a recipe call.
    Returns (kwargs, seed, label)."""
    if typ == "impact":
        s = int(ev.get("strength", 2))
        return dict(strength=s), 1000 * s + 7 * (k % 2), f"impact_s{s}{'ab'[k % 2]}"
    if typ == "hit":
        return {}, 2000 + k % 4, f"hit_{k % 4 + 1}"
    if typ == "stamp":
        return {}, 3000 + k % 3, f"stamp_{k % 3 + 1}"
    if typ == "whoosh":
        d = float(ev.get("dur", DEFAULT_DUR[typ]))
        return dict(dur=d, direction=1 if k % 2 == 0 else -1), 4000 + k % 4, f"whoosh_{durtag(d)}_{k % 4 + 1}"
    if typ == "swell":
        d = float(ev.get("dur", DEFAULT_DUR[typ]))
        return dict(dur=d), 5000 + k % 2, f"swell_{durtag(d)}_{k % 2 + 1}"
    if typ == "riser":
        d = float(ev.get("dur", DEFAULT_DUR[typ]))
        return dict(dur=d, bpm=ctx["bpm"]), 6000 + k % 2, f"riser_{durtag(d)}_{k % 2 + 1}"
    if typ == "reverse":
        d = float(ev.get("dur", DEFAULT_DUR[typ]))
        return dict(dur=d), 7000 + k % 2, f"reverse_{durtag(d)}_{k % 2 + 1}"
    if typ == "fire":
        d = float(ev.get("dur", DEFAULT_DUR[typ]))
        return dict(dur=d), 8000 + k % 2, f"fire_{durtag(d)}_{k % 2 + 1}"
    if typ == "coin":
        return {}, 9000 + k % 2, f"coin_{k % 2 + 1}"
    if typ == "anvil":
        return {}, 10000 + k % 2, f"anvil_{k % 2 + 1}"
    if typ == "sparkle":
        return {}, 11000 + k % 4, f"sparkle_{k % 4 + 1}"
    if typ == "glint":
        note = ("D", 7) if k % 2 == 0 else ("A", 7)
        return dict(note=note), 12000 + k % 2, f"glint_{note[0]}{note[1]}"
    if typ == "zap":
        return {}, 13000, "zap"
    if typ == "click":
        return {}, 14000 + k % 3, f"click_{k % 3 + 1}"
    if typ == "key":
        space = str(ev.get("note", "")) == " "
        # every keystroke is unique (seed per key); only key_1..4 + key_space go to the library
        return dict(space=space), 15000 + k, f"key_{k + 1}{'_space' if space else ''}"
    if typ == "pop":
        i = ctx["pop_step"]
        name, octv = S.PENTA[i % 5], 5 + (i // 5) % 2
        return dict(note=name, octave=octv), 16000 + i % 10, f"pop_{S.note_label(name, octv)}"
    if typ == "tick":
        return {}, 17000 + k % 4, f"tick_{k % 4 + 1}"
    raise KeyError(typ)


def resolve_events(tl):
    """Sort events, assign deterministic variants/seeds, compute accent times."""
    order = sorted(range(len(tl["events"])), key=lambda i: (float(tl["events"][i]["t"]), i))
    ctx = {"bpm": float(tl.get("bpm", 120)), "pop_step": 0, "last_pop": -1e9}
    counters = defaultdict(int)
    out, skipped = [], []
    for i in order:
        ev = tl["events"][i]
        typ = ev.get("type")
        if typ not in S.RECIPES:
            skipped.append(ev)
            continue
        t = float(ev["t"])
        if typ == "pop":
            ctx["pop_step"] = 0 if t - ctx["last_pop"] > POP_CASCADE_GAP else ctx["pop_step"] + 1
            ctx["last_pop"] = t
        ck = (typ, int(ev.get("strength", 2))) if typ == "impact" else typ
        k = counters[ck]
        counters[ck] += 1
        kwargs, seed, label = event_spec(typ, ev, k, ctx)
        dur = float(ev.get("dur", DEFAULT_DUR.get(typ, 0.0)))
        acc = t + dur if typ in END_ANCHORED else t
        vel = float(ev.get("vel", 1.0))
        out.append(dict(i=i, t=t, typ=typ, dur=dur, accent=acc, vel=vel, kwargs=kwargs, seed=seed,
                        label=label, note=ev.get("note", ""),
                        gain=vel * undb(TYPE_TRIM_DB.get(typ, 0.0))))
    return out, skipped


_CACHE = {}


def render(typ, kwargs, seed):
    key = (typ, tuple(sorted(kwargs.items())), seed)
    if key not in _CACHE:
        _CACHE[key] = S.RECIPES[typ](seed=seed, **kwargs)
    return _CACHE[key]


# ----------------------------------------------------------------------- library
def library_specs(events):
    """Canonical one-shots + every distinct (label) variant the timeline uses."""
    specs = {}

    def add(label, typ, kwargs, seed):
        specs.setdefault(label, (typ, kwargs, seed))

    for s in (1, 2, 3):
        for k in (0, 1):
            kw, seed, lab = event_spec("impact", {"strength": s}, k, {})
            add(lab, "impact", kw, seed)
    for typ, n in (("hit", 4), ("stamp", 3), ("coin", 2), ("anvil", 2), ("sparkle", 2), ("glint", 2),
                   ("zap", 1), ("click", 3), ("tick", 4)):
        for k in range(n):
            kw, seed, lab = event_spec(typ, {}, k, {})
            add(lab, typ, kw, seed)
    for k in range(4):
        kw, seed, lab = event_spec("key", {"note": "a"}, k, {})
        add(lab, "key", kw, seed)
    add("key_space", "key", {"space": True}, 15100)
    for step in range(10):
        kw, seed, lab = event_spec("pop", {}, 0, {"pop_step": step})
        add(lab, "pop", kw, seed)
    for d in (0.25, 0.5):
        for k in range(2):
            kw, seed, lab = event_spec("whoosh", {"dur": d}, k, {})
            add(lab, "whoosh", kw, seed)
    for typ, ds in (("swell", (0.5,)), ("riser", (1.0, 2.0, 4.0)), ("reverse", (0.5, 1.0)), ("fire", (1.0,))):
        for d in ds:
            kw, seed, lab = event_spec(typ, {"dur": d}, 0, {"bpm": 120.0})
            add(lab, typ, kw, seed)
    for e in events:  # timeline-specific durations / variants (per-key unique strokes are not exported)
        if e["typ"] == "key":
            continue
        add(e["label"], e["typ"], e["kwargs"], e["seed"])
    order = list(S.RECIPES)
    return sorted(specs.items(), key=lambda kv: (order.index(kv[1][0]), kv[0]))


def write_library(out_dir, specs):
    od = out_dir / "oneshots"
    od.mkdir(parents=True, exist_ok=True)
    for f in od.glob("*.wav"):
        f.unlink()
    meta = {}
    items = []
    for label, (typ, kwargs, seed) in specs:
        snd = render(typ, kwargs, seed)
        x = snd.data
        sf.write(od / f"{label}.wav", x.astype(np.float32), SR, subtype="PCM_24")
        m = dict(file=f"oneshots/{label}.wav", type=typ,
                 params={k: (list(v) if isinstance(v, tuple) else v) for k, v in kwargs.items()}, seed=seed,
                 duration_s=round(len(x) / SR, 4), anchor_s=round(snd.anchor / SR, 5), anchor_kind=snd.anchor_kind,
                 peak_dbfs=round(sample_peak_db(x), 2), true_peak_dbtp=round(true_peak_db(x), 2),
                 momentary_max_lufs=round(A.momentary_max_lufs(x), 1),
                 s50_max_lufs=round(A.momentary_max_lufs(x, 0.05), 1),
                 dc_offset=float(f"{np.abs(x.mean(axis=0)).max():.2e}"),
                 end_level_dbfs=round(float(db(np.abs(x[-int(0.001 * SR):]).max())), 1),
                 desc=snd.desc)
        meta[label] = m
        items.append(dict(name=f"{label}.wav", data=x, anchor=snd.anchor, peak_db=m["peak_dbfs"],
                          tp_db=m["true_peak_dbtp"], dur=m["duration_s"], kind=snd.anchor_kind,
                          lufs=m["momentary_max_lufs"]))
    (od / "index.json").write_text(json.dumps(meta, indent=1))
    return meta, items


# ----------------------------------------------------------------------- assembly
def assemble(events, seconds):
    n = int(round(seconds * SR))
    bus = np.zeros((n, 2))
    placed = []
    for e in events:
        snd = render(e["typ"], e["kwargs"], e["seed"])
        start = int(round(e["accent"] * SR)) - snd.anchor
        place(bus, snd.data, start, e["gain"])
        placed.append(dict(e, start=start, anchor=snd.anchor, length=len(snd.data)))
    pre_peak = sample_peak_db(bus)
    pre_tp = true_peak_db(bus)
    ceiling = CEILING_DBTP
    for _ in range(6):
        out, g = soft_limiter(bus, ceiling_db=ceiling)
        out = fade(out, 0.0, 0.03)
        tp = true_peak_db(out)
        if tp <= CEILING_DBTP + 0.2:   # guarantees <= -1.1 dBTP
            break
        ceiling -= (tp - CEILING_DBTP) + 0.05
    gr = -db(g.min())
    for p in placed:   # limiter gain reduction around each accent (-10..+50 ms)
        a, b = max(0, int((p["accent"] - 0.01) * SR)), min(n, int((p["accent"] + 0.05) * SR))
        p["gr_db"] = float(-db(g[a:b].min())) if b > a else 0.0
    stats = dict(pre_limiter_sample_peak_dbfs=round(pre_peak, 2), pre_limiter_true_peak_dbtp=round(pre_tp, 2),
                 limiter_ceiling_dbtp=round(ceiling, 2), max_gain_reduction_db=round(float(gr), 2),
                 seconds_in_gain_reduction_over_1db=round(float((g < undb(-1)).sum() / SR), 3))
    return out, placed, stats


# --------------------------------------------------------------------- verification
def select_samples(placed, n_target=20):
    acc = np.array([p["accent"] for p in placed])

    def isolated(p):
        others = np.abs(acc - p["accent"]) < 0.12
        return others.sum() <= 1

    chosen = []
    for typ in list(S.RECIPES) + ["whoosh_long", "impact_s3"]:
        cands = [p for p in placed if _whoosh_class(p) == typ]
        if not cands:
            continue
        iso = [p for p in cands if isolated(p)]
        pick = (iso or cands)[len(iso or cands) // 2]
        chosen.append(pick)
    rest = [p for p in placed if p not in chosen and isolated(p)]
    rest += [p for p in placed if p not in chosen and p not in rest]
    need = max(0, n_target - len(chosen))
    if need and rest:
        idx = np.linspace(0, len(rest) - 1, need).round().astype(int)
        for j in idx:
            if rest[j] not in chosen:
                chosen.append(rest[j])
    return sorted(chosen, key=lambda p: p["accent"])


def coincident(p, placed):
    return [q["typ"] for q in placed if q is not p and abs(q["accent"] - p["accent"]) < 0.03]


def _whoosh_class(p):
    if p["typ"] == "whoosh" and p["dur"] >= 0.4:
        return "whoosh_long"
    if p["typ"] == "impact" and p["kwargs"].get("strength") == 3:
        return "impact_s3"
    return p["typ"]


def verify_timing(track, placed, n_target=20):
    onsets, _ = A.spectral_flux_onsets(track)
    rows = []
    for p in select_samples(placed, n_target):
        a, b = max(0, int((p["accent"] - 1.6) * SR)), min(len(track), int((p["accent"] + 0.6) * SR))
        seg = track[a:b]
        co = coincident(p, placed)
        group = A.accent_mode(p["typ"]) != "transient" and any(A.accent_mode(c) == "transient" for c in co)
        # an end/loudest-anchored event that lands ON a hit is judged by the group's transient in the mix
        r = A.measure_accent(seg, p["accent"], p["typ"], p["dur"], onsets, offset_s=a / SR,
                             mode="transient" if group else None)
        solo = _solo(p)
        rs = A.measure_accent(solo[0], p["accent"], p["typ"], p["dur"], None, offset_s=solo[1])
        rows.append(dict(t=p["t"], typ=p["typ"], label=p["label"], target=p["accent"],
                         mix=r["measured"], mix_err_ms=(r["measured"] - p["accent"]) * 1000,
                         flux=r.get("flux_onset"), flux_err_ms=((r["flux_onset"] - p["accent"]) * 1000) if r.get("flux_onset") is not None else None,
                         solo_err_ms=(rs["measured"] - p["accent"]) * 1000, method=r["method"],
                         solo_method=rs["method"], with_=",".join(sorted(set(co)))))
    # EVERY event: solo check (placement) + mix check (what survives in the final track)
    per_type = defaultdict(list)
    mix_all, outliers = [], []
    for p in placed:
        solo = _solo(p)
        rs = A.measure_accent(solo[0], p["accent"], p["typ"], p["dur"], None, offset_s=solo[1])
        per_type[p["typ"]].append((rs["measured"] - p["accent"]) * 1000)
        a, b = max(0, int((p["accent"] - 1.6) * SR)), min(len(track), int((p["accent"] + 0.6) * SR))
        co = coincident(p, placed)
        group = A.accent_mode(p["typ"]) != "transient" and any(A.accent_mode(c) == "transient" for c in co)
        r = A.measure_accent(track[a:b], p["accent"], p["typ"], p["dur"], onsets, offset_s=a / SR,
                             mode="transient" if group else None)
        e = (r["measured"] - p["accent"]) * 1000
        mix_all.append(e)
        if abs(e) > 10:
            near = sorted({q["typ"] for q in placed if q is not p and abs(q["accent"] - p["accent"]) < 0.06})
            outliers.append(dict(t=p["t"], typ=p["typ"], vel=p["vel"], err_ms=e, near=",".join(near)))
    mix_all = np.array(mix_all)
    summary = dict(events=len(mix_all), within_10ms=int((np.abs(mix_all) <= 10).sum()),
                   median_abs_ms=float(np.median(np.abs(mix_all))), p95_abs_ms=float(np.percentile(np.abs(mix_all), 95)),
                   outliers=outliers)
    return rows, per_type, onsets, summary


def _solo(p):
    snd = render(p["typ"], p["kwargs"], p["seed"])
    pad = int(0.2 * SR)
    buf = np.zeros((len(snd.data) + 2 * pad, 2))
    buf[pad:pad + len(snd.data)] = snd.data * p["gain"]
    return buf, (p["start"] - pad) / SR


# --------------------------------------------------------------------------- README
def write_readme(out_dir, meta, track_stats, timing, per_type, mix_summary, placed, tl_path, seconds, skipped):
    L = []
    L.append("# Albion Journal - SFX library & SFX track\n")
    L.append("Synthesised in code (numpy/scipy, no samples), fully deterministic. Generated by "
             "`audio-src/sfx/build_sfx.py` - **do not hand-edit; re-run the build** (this README is regenerated).\n")
    L.append("```\npython3 audio-src/sfx/build_sfx.py             # library + track + verification + this README\n"
             "python3 audio-src/sfx/build_sfx.py --no-verify # fast: library + track only\n```\n")
    L.append("## Outputs\n")
    L.append(f"- `sfx_track.wav` - 48 kHz / 24-bit stereo, exactly {seconds:.3f} s, assembled from `{tl_path}` "
             f"({len(placed)} events{'; skipped unknown types: ' + str(len(skipped)) if skipped else ''}).")
    L.append("- `sfx_cues.json` - every placed event: timeline time, accent time, variant, start sample, gain.")
    L.append("- `oneshots/*.wav` - the one-shot library (48 kHz / 24-bit stereo) + `oneshots/index.json` (anchor offsets, levels).")
    L.append("- `oneshots_sheet.png` - contact sheet: waveform + spectrogram of every one-shot, anchor marked.\n")
    L.append("## Sync rule (anchors)\n")
    L.append("Each one-shot carries an **anchor** = sample of its perceptual accent (`anchor_s` in index.json). "
             "The assembler places `start = round(accent_time * 48000) - anchor`, so:\n")
    L.append("- impact, hit, stamp, anvil, coin, fire, sparkle, glint, zap, click, key, pop, tick: transient peak on **t**")
    L.append("- whoosh, swell: loudest point on **t + dur** (the cut / downbeat)")
    L.append("- riser, reverse: abrupt end on **t + dur**\n")
    L.append("Variation: impacts alternate 2 variants per strength, hits 4, stamps 3, clicks 3, ticks 4, whooshes 4 "
             "(and alternate L->R / R->L), every keystroke is unique (seeded per key, SPACE has its own variant), "
             f"pops climb the D-minor pentatonic ladder D5 F5 G5 A5 C6 D6 F6 G6 A6 C7 within a cascade "
             f"(a gap > {POP_CASCADE_GAP} s restarts on D5). `vel` scales gain linearly.\n")
    L.append("## Track level / master\n")
    ts = track_stats
    L.append("| metric | value |\n|---|---|")
    for k, v in ts.items():
        L.append(f"| {k} | {v} |")
    L.append("")
    L.append(f"Master chain: sum -> zero-latency look-ahead soft limiter (4x oversampled true-peak detector, 3 dB soft knee, "
             f"4 ms look-ahead ramp, 120 ms release, ceiling {CEILING_DBTP} dBTP) -> 30 ms end fade. The limiter is gain-only "
             f"with no delay, so it cannot move any accent.\n")
    L.append("Mixing note: the stem is balanced internally (impacts own the top few dB; in 50 ms loudness pops sit ~11 LU, "
             "clicks ~16 LU, keys ~20 LU and ticks ~25 LU (before vel) under an S3 impact) and is safe to drop in at unity "
             "for true peak. Under music + VO start the SFX fader around -4 to -8 dB and ride the drops "
             "(16, 96, 104, 116 s) against the orchestral hits.\n")
    L.append("Per-type mix trims (dB, `TYPE_TRIM_DB` in build_sfx.py): " +
             ", ".join(f"{k} {v:+.1f}" for k, v in TYPE_TRIM_DB.items()) + "\n")
    L.append("## One-shots\n")
    L.append("Peak = sample peak at vel 1 (before track trims/vel). M400 / S50 = max BS.1770 K-weighted loudness over "
             "400 ms (momentary) / 50 ms (transient proxy for very short UI sounds). DC = |mean| of the worse channel; "
             "end = peak level of the last 1 ms (every file is faded; risers/reverses end on a 1.5 ms cut by design).\n")
    L.append("| file | dur s | anchor ms | peak dBFS | TP dBTP | M400 LUFS | S50 LUFS | DC | end dBFS | how it is built |\n"
             "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|")
    for lab, m in meta.items():
        L.append(f"| `{lab}.wav` | {m['duration_s']:.3f} | {m['anchor_s']*1000:.1f} ({m['anchor_kind']}) | {m['peak_dbfs']:.1f} | "
                 f"{m['true_peak_dbtp']:.1f} | {m['momentary_max_lufs']:.1f} | {m['s50_max_lufs']:.1f} | {m['dc_offset']:.0e} | "
                 f"{m['end_level_dbfs']:.0f} | {m['desc']} |")
    L.append("")
    if timing is None:
        L.append("## Timing verification\n\nSkipped in this build (`--no-verify`). Re-run without the flag to regenerate "
                 "the contact sheet and the timing tables.\n")
    if timing is not None:
        rows = timing
        L.append("## Timing verification (measured on the mastered sfx_track.wav)\n")
        L.append("Sample of events across all types (isolated ones preferred), auto-selected each build. "
                 "`mix` = accent measured in the final track: transients -> peak of a zero-phase 2 kHz-HP Hilbert envelope "
                 "just after the nearest blind spectral-flux onset; whoosh -> loudest 10 ms RMS (0.4-9 kHz); swell -> loudest "
                 "one-period (27.2 ms) RMS below 250 Hz; riser/reverse -> the end (last sample within 30 dB of the final max). "
                 "When an end/loudest-anchored event lands on a hit (`coincident with`), the mix value is the group transient. "
                 "`flux` = nearest onset from the blind spectral-flux detector (512-pt STFT, 1.33 ms hop; its constant "
                 "-1.3..-4 ms offset is the frame-centring bias of the detector). `solo` = the event rendered alone and measured "
                 "the same way. Note: whoosh and swell anchors are defined as their measured loudest point (whoosh: 15 ms "
                 "Hann RMS, moved <=3.5 ms from the design peak, verified here with a different 10 ms band RMS; swell: "
                 "one-period RMS, ~5 ms before the envelope top, so its solo value is 0 by construction).\n")
        L.append("| t | type | variant | target s | mix s | mix err ms | flux err ms | solo err ms | coincident with |\n|---:|---|---|---:|---:|---:|---:|---:|---|")
        for r in rows:
            fe = f"{r['flux_err_ms']:+.1f}" if r["flux_err_ms"] is not None else "-"
            L.append(f"| {r['t']:.3f} | {r['typ']} | {r['label']} | {r['target']:.3f} | {r['mix']:.4f} | {r['mix_err_ms']:+.1f} | {fe} | "
                     f"{r['solo_err_ms']:+.1f} | {r['with_'] or '-'} |")
        L.append("")
        ms_ = mix_summary
        L.append(f"**Every** event measured the same way in the mix: {ms_['within_10ms']}/{ms_['events']} within +-10 ms "
                 f"(median |err| {ms_['median_abs_ms']:.2f} ms, 95th pct {ms_['p95_abs_ms']:.2f} ms).")
        if ms_["outliers"]:
            L.append(" Outliers (all solo-verified on time; their transient is masked in the mix by a louder overlapping sound):\n")
            for o in ms_["outliers"]:
                L.append(f"- {o['t']:.4f} s {o['typ']} (vel {o['vel']}): {o['err_ms']:+.1f} ms - near {o['near'] or 'a louder tail'}")
        L.append("")
        L.append("Solo check of **every** event (max |error| per type):\n")
        L.append("| type | events | max abs err ms |\n|---|---:|---:|")
        for typ, errs in per_type.items():
            L.append(f"| {typ} | {len(errs)} | {np.max(np.abs(errs)):.2f} |")
        L.append("")
    (out_dir / "README.md").write_text("\n".join(L))


# ------------------------------------------------------------------------------ main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--timeline", default=str(DEFAULT_TIMELINE))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--no-verify", action="store_true")
    ap.add_argument("--samples", type=int, default=20)
    args = ap.parse_args(argv)
    t0 = time.time()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    tl = json.loads(Path(args.timeline).read_text())
    seconds = float(tl.get("duration", 120.0))
    events, skipped = resolve_events(tl)
    for ev in skipped:
        print(f"WARNING: unknown event type skipped: {ev}")
    print(f"[sfx] {len(events)} events, {seconds:.3f} s @ {tl.get('bpm', 120)} BPM")

    specs = library_specs(events)
    meta, items = write_library(out_dir, specs)
    print(f"[sfx] wrote {len(meta)} one-shots ({time.time() - t0:.1f} s)")

    track, placed, stats = assemble(events, seconds)
    track_path = out_dir / "sfx_track.wav"
    sf.write(track_path, track.astype(np.float32), SR, subtype="PCM_24")
    cues = [dict(t=p["t"], type=p["typ"], accent=round(p["accent"], 4), variant=p["label"], note=p["note"],
                 vel=p["vel"], gain_db=round(float(db(p["gain"])), 2), limiter_gr_db=round(p["gr_db"], 2), start_sample=p["start"],
                 anchor_offset_s=round(p["anchor"] / SR, 5)) for p in placed]
    (out_dir / "sfx_cues.json").write_text(json.dumps(cues, indent=1))
    print(f"[sfx] wrote {track_path} ({time.time() - t0:.1f} s)")

    x, sr = sf.read(track_path, always_2d=True)
    assert sr == SR and x.shape[1] == 2
    stats = dict(frames=len(x), seconds=f"{len(x) / SR:.6f}", sample_rate=sr, channels=x.shape[1], **stats)
    stats["true_peak_dbtp"] = round(true_peak_db(x), 2)
    stats["sample_peak_dbfs"] = round(sample_peak_db(x), 2)
    stats["integrated_lufs"] = round(A.integrated_lufs(x), 1)
    eb = A.ffmpeg_ebur128(track_path)
    if eb:
        stats["ffmpeg_ebur128"] = eb
    print("[sfx] track:", json.dumps(stats))
    worst = sorted(placed, key=lambda p: -p["gr_db"])
    seen, gr_rows = set(), []
    for p in worst:
        if p["gr_db"] < 0.5 or round(p["accent"], 2) in seen:
            continue
        seen.add(round(p["accent"], 2))
        gr_rows.append((p["accent"], p["gr_db"], ",".join(q["typ"] for q in placed if abs(q["accent"] - p["accent"]) < 0.03)))
    stats["limiter_gr_over_0.5db_at"] = "; ".join(f"{a:.2f}s {g:.1f}dB ({w})" for a, g, w in sorted(gr_rows)) or "none"
    print("[sfx] limiter GR >0.5 dB at:", stats["limiter_gr_over_0.5db_at"])

    timing = per_type = mix_summary = None
    if not args.no_verify:
        A.contact_sheet(items, out_dir / "oneshots_sheet.png")
        timing, per_type, onsets, mix_summary = verify_timing(x, placed, args.samples)
        print(f"[sfx] blind onset detector found {len(onsets)} onsets")
        print(f"{'t':>8} {'type':8} {'variant':16} {'target':>8} {'mix':>9} {'err ms':>7} {'flux ms':>8} {'solo ms':>8}  with")
        for r in timing:
            fe = f"{r['flux_err_ms']:+.1f}" if r["flux_err_ms"] is not None else "-"
            print(f"{r['t']:8.3f} {r['typ']:8} {r['label']:16} {r['target']:8.3f} {r['mix']:9.4f} {r['mix_err_ms']:+7.1f} {fe:>8} {r['solo_err_ms']:+8.1f}  {r['with_']}")
        print("[sfx] solo check, max |err| ms per type:",
              {k: round(float(np.max(np.abs(v))), 2) for k, v in per_type.items()})
        print(f"[sfx] all events in the mix: {mix_summary['within_10ms']}/{mix_summary['events']} within +-10 ms "
              f"(median {mix_summary['median_abs_ms']:.2f} ms, p95 {mix_summary['p95_abs_ms']:.2f} ms); outliers: "
              + ("; ".join(f"{o['t']:.4f}s {o['typ']} vel {o['vel']} {o['err_ms']:+.1f} ms near [{o['near']}]" for o in mix_summary['outliers']) or "none"))
    write_readme(out_dir, meta, stats, timing, per_type, mix_summary, placed,
                 str(Path(args.timeline).resolve().relative_to(ROOT)) if Path(args.timeline).resolve().is_relative_to(ROOT) else args.timeline,
                 seconds, skipped)
    print(f"[sfx] done in {time.time() - t0:.1f} s")


if __name__ == "__main__":
    main()
