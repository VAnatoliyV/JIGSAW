"""Master timeline for the Albion Journal film. 120 BPM, 4/4 -> beat 0.5 s, bar 2 s, 60 bars.
Everything (music arrangement, SFX, VO placement, visual shots) reads timeline.json."""
import json
BPM = 120; BEAT = 60 / BPM; BAR = 4 * BEAT
def bar(n, beat=1.0):  # 1-indexed bar & beat -> seconds
    return round((n - 1) * BAR + (beat - 1) * BEAT, 4)

sections = [
  # name, first bar, last bar, music intent
  ("hook",      1,  8, "Ominous intro. Bars 1-3: low D drone + choir, orchestral hits ONLY on the 5 kinetic words. Bars 4-6: pizzicato 8th ostinato + low strings, ticking tension. Bars 7-8: build, snare roll, rising strings, riser into drop."),
  ("reveal",    9, 16, "DROP A. Full heroic theme on horns+strings, taiko groove, 16th string ostinato, choir. The product appears."),
  ("feat1",    17, 24, "Feature groove A (Crafting): lighter, leaves room for voice. Lute/harp arpeggios, string ostinato, frame drum groove, flute counter-line. Forge feel (anvil-like accents)."),
  ("feat2",    25, 32, "Feature groove B (Black Market): darker colour, low brass stabs, staccato strings, same tempo/energy."),
  ("feat3",    33, 40, "Feature groove C (Item prices): brighter, adventurous jig-like fiddle/flute melody over the groove, tambourine."),
  ("montage",  41, 44, "Montage: full intensity, an accent hit every bar (cuts land every beat 1 and 3)."),
  ("breakdown",45, 48, "Breakdown: drums out, choir + strings pad, heartbeat timpani, tension rising."),
  ("metric",   49, 52, "Metric: massive hit on bar 49 beat 1 (the number lands), then strings tremolo build, snare roll bars 51-52 into final chorus."),
  ("finale",   53, 58, "Final chorus: full theme, triumphant, brass + choir, biggest energy. Logo lockup + CTA."),
  ("outro",    59, 60, "Final D-major chord hit on bar 59 beat 1, ring out to silence at 120 s."),
]

E = []  # (t, type, strength/opts, note)
def ev(t, typ, **kw): E.append(dict(t=round(t, 4), type=typ, **kw))

# ---------- HOOK ----------
ev(0.0,  "swell", dur=0.5, note="sub swell into first word")
for t, w in [(0.5, "CRAFTING"), (1.5, "BLIND"), (2.5, "BURNS"), (3.5, "YOUR")]:
    ev(t, "impact", strength=2, note=w)
ev(2.5, "fire", dur=1.0, note="BURNS ember whoosh")
ev(4.0, "impact", strength=3, note="SILVER.")
ev(4.0, "coin", note="SILVER shimmer")
ev(5.75, "whoosh", dur=0.5)
ev(6.0, "stamp", note="7 CITIES")
for i in range(7): ev(6.0 + 0.125 * i, "tick", note="city names flick")
ev(7.25, "stamp", note="1 BLACK MARKET")
ev(8.5, "whoosh", dur=0.4, note="item-name flood begins")
for i in range(16): ev(8.5 + 0.125 * i, "tick", vel=0.5, note="ticker")
ev(10.75, "whoosh", dur=0.25)
ev(11.0, "stamp", note="TAX")
ev(11.75, "stamp", note="STATION FEE")
ev(12.75, "stamp", note="RESOURCE RETURN")
ev(14.0, "riser", dur=2.0)
ev(15.0, "reverse", dur=1.0, note="reverse cymbal ending on the drop")

# ---------- REVEAL ----------
ev(16.0, "impact", strength=3, note="DROP")
ev(16.0, "anvil", note="hammer strike, logo forms")
ev(16.0, "sparkle", note="sparks")
for i in range(6): ev(16.5 + 0.25 * i, "pop", vel=0.4, note="pixel build")
ev(18.0, "hit", note="wordmark Albion Journal")
ev(18.0, "sparkle")
ev(19.75, "whoosh", dur=0.25, note="UI assembly begins")
for t in [20.0, 20.5, 21.0, 21.5, 22.0]: ev(t, "pop", note="header/title/subtitle/lead/buttons")
for t in [22.5, 22.75, 23.0, 23.25]: ev(t, "pop", note="stat tiles")
for t in [24.0, 24.25, 24.5, 24.75]: ev(t, "pop", vel=0.7, note="chips")
for i in range(10): ev(25.0 + 0.25 * i, "pop", vel=0.6, note="section cards")
ev(27.75, "whoosh", dur=0.5, note="pull back")
ev(30.0, "sparkle", note="light sweep")
ev(31.5, "whoosh", dur=0.5, note="transition")

# ---------- FEATURE 1 : CRAFTING ----------
def feature(start, title):
    ev(start, "impact", strength=2, note=title)
    ev(start + 1.5, "whoosh", dur=0.5, note="into UI")
feature(32.0, "01 CRAFTING")
ev(34.5, "click", note="Open Crafting")
ev(35.0, "whoosh", dur=0.3, note="table appears")
ev(37.0, "click", note="category")
ev(39.0, "click", note="sort by profit")
for i in range(8): ev(39.5 + 0.25 * i, "tick", vel=0.4, note="rows resort")
ev(43.0, "click", note="open row")
ev(43.25, "whoosh", dur=0.3, note="item card")
ev(45.0, "glint"); ev(46.0, "glint")
ev(47.5, "whoosh", dur=0.5)

# ---------- FEATURE 2 : BLACK MARKET ----------
feature(48.0, "02 BLACK MARKET")
ev(50.5, "click", note="Black Market section")
ev(51.0, "whoosh", dur=0.3)
ev(53.0, "click", note="filter")
ev(55.0, "click", note="sort")
for i in range(8): ev(55.5 + 0.25 * i, "tick", vel=0.4)
ev(58.0, "click", note="hover/open row")
ev(60.0, "glint"); ev(61.0, "glint")
ev(63.5, "whoosh", dur=0.5)

# ---------- FEATURE 3 : ITEM PRICES ----------
feature(64.0, "03 ANY PRICE")
ev(66.5, "click", note="search box")
for i, ch in enumerate("mas cap"): ev(67.0 + 0.25 * i, "key", note=ch)
ev(69.0, "pop", note="suggestions")
ev(70.0, "click", note="Master's Cape")
ev(70.25, "whoosh", dur=0.25)
for i in range(8): ev(70.5 + 0.25 * i, "pop", vel=0.6, note="7 cities + BM")
ev(74.0, "glint", note="best price")
ev(79.5, "whoosh", dur=0.5)

# ---------- MONTAGE ----------
for i in range(8):
    ev(80.0 + i, "whoosh", dur=0.25)
    ev(80.0 + i, "hit", note=f"montage cut {i+1}")
ev(87.0, "riser", dur=1.0)

# ---------- METRIC ----------
ev(88.0, "impact", strength=2, note="breakdown")
for i in range(16):
    # counter ticks accelerate from 92 to 96
    ev(92.0 + 4 * (1 - (1 - i / 16) ** 1.6), "tick", vel=0.5, note="counter")
ev(94.0, "riser", dur=2.0)
ev(95.5, "reverse", dur=0.5)
ev(96.0, "impact", strength=3, note="6,985 lands")
ev(96.0, "coin")
ev(98.0, "zap", note="UPDATED IN SECONDS")
ev(100.0, "riser", dur=4.0)
ev(103.0, "reverse", dur=1.0)

# ---------- FINALE ----------
ev(104.0, "impact", strength=3, note="final chorus / logo lockup")
ev(104.0, "anvil")
ev(104.0, "sparkle")
ev(106.0, "stamp", note="STOP GUESSING."); ev(107.0, "stamp", note="START CRAFTING.")
ev(108.0, "whoosh", dur=0.5, vel=0.55, note="CTA panel (soft: tail of 'crafting')")
for i in range(12): ev(110.0 + 0.125 * i, "key", vel=0.5, note="URL types on")
ev(112.0, "click", note="Open Crafting button")
ev(112.0, "sparkle")
ev(115.0, "reverse", dur=1.0)
ev(116.0, "impact", strength=3, note="FINAL HIT")
ev(116.0, "anvil")

# ---------- VOICE-OVER ----------
VO = [
  ("v01",  6.1,   "Seven cities. One Black Market."),
  ("v02",  9.0,   "Thousands of prices, and all of them moving."),
  ("v03", 12.6,   "Guess wrong, and the forge eats your profit."),
  ("v04", 16.75,  "This is Albion Journal."),
  ("v05", 19.9,   "Live Europe prices from the Albion Online Data Project, with tax, resource return and the station fee already inside."),
  ("v06", 28.6,   "Free. No sign-up. No ads."),
  ("v07", 32.6,   "Open Crafting, and every recipe is costed, city by city."),
  ("v08", 37.4,   "Pick a category, sort by profit, and the best thing to make today rises to the top."),
  ("v09", 43.2,   "Open any row. Unit cost, the sweet spot, a full batch. Already worked out."),
  ("v10", 48.6,   "Rather flip than craft? Buy in any city, and sell to the Black Market."),
  ("v11", 54.4,   "Every row tells you where to buy, which quality, and what you keep after tax."),
  ("v12", 64.6,   "Need one price, fast? Type a few letters."),
  ("v13", 69.6,   "Master's Cape. All seven cities and the Black Market, at a glance."),
  ("v14", 75.6,   "No spreadsheets. No guesswork."),
  # v15 is one take sliced at its natural pauses (audio-src/vo/take_george/v15a..e.wav) so each phrase
  # lands just after its montage cut
  ("v15a", 80.12, "Refining."),
  ("v15b", 81.12, "Enchanting."),
  ("v15c", 82.08, "Potions and food."),
  ("v15d", 83.42, "Your island."),
  ("v15e", 84.24, "Even the roads to Caerleon."),
  ("v16", 88.6,   "And the market never sleeps."),
  ("v17", 96.6,   "Six thousand, nine hundred and eighty-five items. Updated in seconds."),
  ("v18", 105.98, "Stop guessing. Start crafting."),
  ("v19", 108.6,  "Albion Journal. Free, in your browser."),
]

out = dict(
  bpm=BPM, beat=BEAT, bar=BAR, duration=120.0, bars=60, key="D minor (Dorian colour), ends D major",
  sections=[dict(name=n, start=bar(a), end=bar(b + 1), bars=[a, b], intent=i) for n, a, b, i in sections],
  events=sorted(E, key=lambda e: e["t"]),
  vo=[dict(id=i, t=t, text=s) for i, t, s in VO],
)
json.dump(out, open("/home/user/JIGSAW/timeline/timeline.json", "w"), indent=1)
print(len(E), "events;", len(VO), "VO lines")
open("/home/user/JIGSAW/film/data/timeline.js", "w").write("window.TIMELINE=" + json.dumps(out) + ";")
