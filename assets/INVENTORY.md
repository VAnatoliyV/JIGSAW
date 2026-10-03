# Albion Journal — asset inventory

Everything here was taken from the real product: the live site's source (`VAnatoliyV/albion-craft-profit` @ `5231a21`, served locally because this sandbox cannot reach `vanatoliyv.github.io`) and screenshots of it rendered with Playwright. Nothing in the product UI is redrawn; the film crops and animates these files.

## Brand

| What | Value | Source |
|---|---|---|
| Name | **Albion Journal** ("Albion" white, "Journal" gold) | site `<h1>`, `og:site_name` |
| Product mark | Pixel **anvil**, 44×36 px bitmap with a hammer-strike + sparks animation | `ANVIL_BODY` + `anvilDraw()` in `index.html` → `film/vendor/albion_logo.js` (verbatim) |
| Header mark | Pixel **hooded hare** (ears twitch, winks) | `LOGO_BIG` / `logoDraw()` → same vendor file |
| Static exports | `brand/logo_anvil_pixel.png`, `brand/logo_hare_pixel.png` (nearest-neighbour upscales of the real bitmaps) | `tools/export_logo.mjs` |
| App icons / social card | `brand/icon-32.png`, `icon-180.png`, `icon-192.png`, `og-image.png` | repo `img/`, `og-image.png` |
| Tagline (og) | "Crafting · Flipping · Black Market — Live Europe-server prices. Find what actually turns a profit." | `og-image.png` |

### Colours (site `:root`)

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0b0d12` | page background |
| `--bg2` | `#0f1219` | inputs |
| `--panel` / `--panel2` / `--panel3` | `#151924` / `#1c2130` / `#232a3d` | cards, header |
| `--border` / `--border2` | `#262d3f` / `#333c55` | outlines |
| `--text` / `--muted` | `#dde2ec` / `#8b93a8` | text |
| `--accent` / `--accent2` | `#eebc4e` / `#f5d47e` | gold: "Journal", primary button, numbers |
| `--green` / `--red` / `--blue` | `#62c96f` / `#e46f61` / `#6aa5e0` | profit / loss / info |

### Fonts

- **Pixelify Sans** (SIL OFL), the brand's pixel display face (og-image, "Pixel" skin): `fonts/*.woff2` + `fonts/pixelify.css`
- **Inter**, from the site's UI stack (`-apple-system, …, 'Inter', sans-serif`); installed system-wide for the captures, plus `fonts/inter_latin.css`

## Real product facts used in the film

- 6 985 items in the base (counted from `items.json`), 7 cities + the Black Market (in Caerleon), Europe server, live prices from the Albion Online Data Project, "⚡ seconds" update step when the live feed is on (owner-confirmed; the sandbox fallback shows "12 min").
- Sections: Crafting, Refining (36.7 % return in a bonus city vs 15.2 %), Flipping → Black Market, City-to-city flipping, Enchanting, Potions and food, Islands, Calculator, Item prices, Roads to Caerleon (beta), Mac app.
- No sign-up, no ads, prices cleaned of troll orders. 9 interface languages (EN, RU, ES, DE, FR, PL, PT, IT, TR).
- Footer: "A fan project, not affiliated with Sandbox Interactive. Albion Online is a trademark of SBI."

## City art (`cities/`)

Seven real island/city artworks shipped with the site (`img/`): `fortsterling`, `lymhurst`, `bridgewatch`, `martlock`, `thetford`, `caerleon`, `brecilien`. Each has a `-hero.webp` (2200×620 panorama) and a `.webp` card (560×~478).

## UI screenshots (`screens/<profile>/`)

Captured by `tools/capture.mjs` with Playwright from the real site code. There are three profiles, one per output format:

| Profile | Viewport | Used for |
|---|---|---|
| `mobile` | 430×932 @3× | 9:16 |
| `square` | 1100×1000 @2× | 1:1 |
| `desktop` | 1440×900 @2× | 16:9 |

States per profile, with page-CSS-px rects in `film/data/manifest.json`:

- `home_full` (full page), `home_top`, `home_top_hover` (cursor on "Open Crafting →")
- `home__*` element crops with transparent page background: logo, title, sub, lead, go, all, stat ×3, chip ×4, view, card ×10, dl, status, foot
- `lang_en|ru|es|de|fr|pl|pt|it|tr`: the hero in all 9 interface languages
- `skin_pixel`, `skin_pixel_craft`: the site's Pixel skin
- Feature/interaction states (Crafting, Black Market, Item prices typing, montage sections). These are produced by the extended capture groups and need the live data hosts.

`screens/explore/` holds early exploration shots (not committed).

## Audio (`audio/`)

- `music/music_mix.wav`: original score, synthesised in code (FluidSynth + MuseScore General SoundFont, programmatic MIDI, numpy DSP). D minor/Dorian, ends in D major, exactly 120 BPM / 120 s, −16 LUFS. Stems are in `music/stems/` (not committed). `music/music_verification.txt` holds the accent-timing proof.
- `sfx/sfx_track.wav` + `sfx/oneshots/`: synthesised sound design (impacts, anvil, whooshes, UI clicks, keys, pops…), driven by `timeline/timeline.json`.
- Voice-over: 19 lines, Kokoro neural TTS (`bm_george`, British male). Takes are in `audio-src/vo/take_george/`, regenerated with `audio-src/vo/vo_take.py`.
