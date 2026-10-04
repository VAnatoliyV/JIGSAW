// Captures real Albion Journal UI states with Playwright for the film.
// Usage: node tools/capture.mjs <profile> [group...]
//   profile: mobile | square | desktop | all
//   groups:  home lang skin sections   (static hero / language / skin / section stills)
//            craft flip item montage   (real user interactions: before/after every click or keystroke)
// Writes PNGs to assets/screens/<profile>/ and merges rects/paths into film/data/manifest.json (+ manifest.js).
//
// Network: the price data (vanatoliyv.github.io data.json), the live feed (129-80-180-213.sslip.io), item icons
// (render.albiononline.com), the Albion Data API and the killboard are probed at start through the session proxy.
// Reachable hosts are passed through (fetched node-side, so the proxy CA is trusted), and the local clone's
// data.json / data-stats.json / own.json are served from the live github.io copies. Unreachable hosts stay blocked
// and every capture that should have shown data is marked {stale:true, reason} in the manifest.
// While the icon host is blocked its requests are left unanswered (ICON_HANG=0 aborts them instead), so the site
// keeps its own empty icon placeholder instead of Chromium's broken-image glyph.
// Env: NET=off|on (skip probe: block all / pass all), DATA_WAIT=ms (default 90000),
//      GRACE=ms (how long to watch the real loading state when no data host is reachable, default 5000),
//      LIVE_STUB=0 turns off BOTH ways this script produces the site's "⚡ live" state (see liveMode / LIVE_FORCE).
//
// Manifest fields of an interaction state (group craft|flip|item|montage), all coordinates in page CSS px:
//   img / page [w, h, scrollX, scrollY] / fullPage:true  the saved strip from the top of the page (PageView-compatible)
//   vp {img, scroll}                                     viewport-only image when the page was scrolled
//   rects / labels / keys {key: [...]}                   measured AFTER the screenshot (re-shot if they moved)
//   inStrip {key: ['full'|'partial'|'out', ...]}         whether each rect lies inside the saved strip image
//   items [{k, id, name, sub, text, rect, cells, inStrip}] table / suggestion rows in screen order (k = the site's row key)
//   click {type, sel, label, rect, at, space, before[], after[]}  the user action that LED to this state.
//       space:'prev' -> rect/at are in the previous state's layout (after its before[] actions), i.e. where the
//       cursor goes on the previous image; space:'this' -> measured in this state's layout.
//   next {...,space:'this'}                              the action about to happen (hover states)
//   prev                                                 previous state name
//   site {kind, src, text, partial, loaded, ui}          the site's own S.st status at capture time
//   apiFallback {...}                                    status bar shows the direct-API fallback (data.json unreachable)
//   net {data, api, live, icons, kill, liveOn, liveForced, liveStubArmed, liveStub, liveStubHits}
//   icons {total, blank, broken} / iconsMissing / iconsBlank   counted on screen inside the strip
//   i18nLeak [words]                                     Cyrillic words visible in a non-Russian UI (site i18n gaps)
//   labelDrift [keys]                                    labels/rects that kept changing while shooting (e.g. a counter)
//   stale / reason                                       not what a real user sees with data: re-capture when online
//   notRecaptured {failedAfter, error}                   an older capture kept because this run's group failed
import { open, SITE } from './site.mjs';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const ROOT = '/home/user/JIGSAW';
const PROFILES = {
  mobile:  { width: 430,  height: 932, dpr: 3 },
  square:  { width: 1100, height: 1000, dpr: 2 },
  desktop: { width: 1440, height: 900, dpr: 2 },
};
// tallest page strip (CSS px from the top of the page) saved for a state's full image
const CAP = { mobile: 3000, square: 2400, desktop: 2400 };

const profileArg = process.argv[2] || 'desktop';
const groups = process.argv.slice(3);
if (profileArg === 'all') {
  // one browser at a time: the machine is shared
  for (const p of Object.keys(PROFILES)) {
    const r = spawnSync(process.execPath, [process.argv[1], p, ...groups], { stdio: 'inherit' });
    if (r.status) process.exitCode = r.status;
  }
  process.exit();
}
if (!PROFILES[profileArg]) { console.error('unknown profile', profileArg); process.exit(1); }
const profile = profileArg;
const P = PROFILES[profile];
// Self-test of the interaction scripts only: TEST_DATA=<synthetic data.json> serves that file as the price
// snapshot so the sort / row-open paths can be exercised offline. Its prices are NOT real, so a test run must
// write to CAPTURE_DIR (outside the project assets) and never into assets/screens or film/data.
const TEST_DATA = process.env.TEST_DATA || '';
const TEST_DIR = process.env.CAPTURE_DIR || '';
if (TEST_DATA && (!TEST_DIR || path.resolve(TEST_DIR).startsWith(ROOT))) { console.error('TEST_DATA needs CAPTURE_DIR outside', ROOT); process.exit(1); }
const OUT = TEST_DIR ? path.join(TEST_DIR, profile) : path.join(ROOT, 'assets/screens', profile);
fs.mkdirSync(OUT, { recursive: true });
const MAN = TEST_DIR ? path.join(TEST_DIR, 'manifest.json') : path.join(ROOT, 'film/data/manifest.json');
const MANJS = TEST_DIR ? path.join(TEST_DIR, 'manifest.js') : path.join(ROOT, 'film/data/manifest.js');
// A missing manifest starts empty; one that exists but will not parse is never silently replaced.
function readManifest() {
  if (!fs.existsSync(MAN)) return {};
  let err;
  for (let i = 0; i < 5; i++) {
    try { return JSON.parse(fs.readFileSync(MAN, 'utf8')); } catch (e) { err = e; spawnSync('sleep', ['0.2']); }
  }
  throw new Error(`${MAN} exists but does not parse (${err && err.message}); refusing to overwrite it`);
}
const manifest = readManifest();
manifest[profile] = manifest[profile] || { viewport: P, states: {} };
manifest[profile].viewport = P;
manifest[profile].sequences = manifest[profile].sequences || {};
manifest[profile].pending = manifest[profile].pending || {};
manifest[profile].notes = manifest[profile].notes || {};
const touched = new Set();
const want = g => !groups.length || groups.includes(g);
const rel = f => path.relative(path.join(ROOT, 'film'), f);

// ---------- network probe ----------
const LIVE_SITE = 'https://vanatoliyv.github.io/albion-craft-profit/';
const LIVE_HOST = '129-80-180-213.sslip.io';
const ICON_HOST = 'render.albiononline.com';
const nowS = Math.floor(Date.now() / 1000);
const PROBE = {
  data:  { host: 'vanatoliyv.github.io',          url: LIVE_SITE + 'data-stats.json?v=' + Date.now() },
  live:  { host: LIVE_HOST,                        url: `https://${LIVE_HOST}/live.json?since=${nowS - 60}` },
  icons: { host: ICON_HOST,                        url: `https://${ICON_HOST}/v1/item/T4_BAG.png?size=64` },
  api:   { host: 'europe.albion-online-data.com',  url: 'https://europe.albion-online-data.com/api/v2/stats/prices/T4_BAG.json?locations=Caerleon&qualities=1' },
  kill:  { host: 'gameinfo-ams.albiononline.com',  url: 'https://gameinfo-ams.albiononline.com/api/gameinfo/events?limit=1&offset=0' },
};
const NET = {};
const PASS = new Set((process.env.PASS_HOSTS || '').split(',').filter(Boolean));
// The owner confirms the live feed is running and the site shows "⚡ seconds" / "⚡ Live prices" (not the
// "12 min" snapshot fallback). Two mechanisms, both switched off by LIVE_STUB=0:
//  1. liveStub: when the feed host is unreachable, answer the site's poll with the feed's "nothing new since"
//     reply ({}). The site only polls once its price snapshot (data.json) has loaded (resetLive() runs at the end
//     of loadAll()), so this stub only ever answers when data.json is reachable; hits are counted (liveStubHits).
//  2. liveMode(): set the site's own liveOkAt and repaint, exactly what the site does on a feed reply. While
//     data.json is blocked this is the ONLY source of the ⚡ state; such states carry net.liveForced:true.
const LIVE_FORCE = process.env.LIVE_STUB !== '0';
const ICON_HANG = process.env.ICON_HANG !== '0';
let stubHits = 0;

let browser, ctx, page;
const wait = ms => page.waitForTimeout(ms);
const siteHost = new URL(SITE).host;
const MIRROR = new Set(['/data.json', '/data-stats.json', '/own.json']);
async function launch() {
  ({ browser, ctx, page } = await open(P));
  page.setDefaultTimeout(20000);
  // Registered after site.mjs's handler, so it runs first; anything not handled here falls back to site.mjs
  // (localhost served, fonts mapped to local files, everything else aborted).
  await ctx.route('**/*', async (route) => {
    let u; try { u = new URL(route.request().url()); } catch (e) { return route.fallback(); }
    if (u.host === siteHost && MIRROR.has(u.pathname)) {
      if (TEST_DATA) {
        if (u.pathname === '/data.json') return route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(TEST_DATA) });
        if (u.pathname === '/data-stats.json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ builtAt: 1 }) });
        return route.fallback();
      }
      if (!NET.data) return route.fallback();
      try { return await route.fulfill({ response: await route.fetch({ url: LIVE_SITE + u.pathname.slice(1) + u.search, timeout: 60000 }) }); }
      catch (e) { return route.abort('failed'); }
    }
    if (u.hostname === LIVE_HOST && NET.liveStub) {
      stubHits++;
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: '{}' });
    }
    // icon host blocked: leave the request pending (the site shows its own empty placeholder, not a broken glyph)
    if (u.hostname === ICON_HOST && NET.icons === false && ICON_HANG) return;
    if (PASS.has(u.hostname)) {
      try { return await route.fulfill({ response: await route.fetch({ timeout: 60000 }) }); }
      catch (e) { return route.abort('failed'); }
    }
    return route.fallback();
  });
}
await launch();

async function probe() {
  const mode = (process.env.NET || '').toLowerCase();
  for (const [k, p] of Object.entries(PROBE)) {
    if (mode === 'off') { NET[k] = false; continue; }
    if (mode === 'on') { NET[k] = true; continue; }
    try {
      const r = await ctx.request.get(p.url, { timeout: 12000, failOnStatusCode: false, maxRedirects: 3 });
      const body = r.status() === 403 ? (await r.text()).slice(0, 200) : '';
      NET[k] = !(r.status() === 403 && /allowlist|egress|not allowed/i.test(body)) && r.status() < 500;
    } catch (e) { NET[k] = false; }
  }
  if (TEST_DATA) NET.data = 'test';
  for (const [k, p] of Object.entries(PROBE)) if (NET[k] === true) PASS.add(p.host);
  NET.liveStub = !NET.live && LIVE_FORCE;
  console.log(profile, 'network:', JSON.stringify(NET));
}
await probe();
const DATA_ON = NET.data || NET.api;

// ---------- shared helpers ----------
async function boot() {
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await wait(1500);
  await page.evaluate(() => { try { setAnim('off'); } catch (e) {} });   // no idle animation in stills; the film animates the logo itself
}
async function iconsOk() {
  return page.evaluate(() => { const i = document.querySelector('#drift img'); return !!(i && i.complete && i.naturalWidth > 0); });
}
const liveOn = () => page.evaluate(() => { try { return liveIsOn(); } catch (e) { return false; } });
async function liveMode() {
  // The live site shows "⚡ seconds" once its live price feed answers (owner-confirmed: updates are instant now,
  // not the 12-minute snapshot step). If the real feed is reachable, give it a moment to answer on its own; else
  // mark the feed as answered and repaint, exactly as the site does on a reply (recorded as net.liveForced).
  if (NET.live && await liveOn()) return;
  if (NET.live && DATA_ON) {
    await page.waitForFunction(() => { try { return liveIsOn(); } catch (e) { return false; } }, null, { timeout: 8000 }).catch(() => {});
    if (await liveOn()) return;
  }
  if (!LIVE_FORCE) return;
  await page.evaluate(() => { try { window.__capLiveAt = liveOkAt = Date.now(); paintHeroStats(); if (S.st && S.st.kind === 'ok') renderStatus(); } catch (e) {} });
}
async function netInfo() {
  const lv = await page.evaluate(() => { try { return { on: liveIsOn(), forced: !!window.__capLiveAt && liveOkAt === window.__capLiveAt }; } catch (e) { return { on: false, forced: false }; } });
  return {
    data: !!NET.data, api: !!NET.api, live: !!NET.live, icons: !!NET.icons, kill: !!NET.kill,
    liveOn: lv.on, liveForced: lv.on && lv.forced,
    liveStubArmed: !!NET.liveStub, liveStub: !!NET.liveStub && stubHits > 0, liveStubHits: stubHits,
  };
}
async function rects(map) {
  return page.evaluate((map) => {
    const r = {};
    for (const [k, sel] of Object.entries(map)) {
      const els = [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null || e.tagName === 'CANVAS');
      r[k] = els.map(e => { const b = e.getBoundingClientRect(); return [b.left + scrollX, b.top + scrollY, b.width, b.height]; });
    }
    return r;
  }, map);
}
function markTouched(name) { touched.add(name); }
async function full(name, extra = {}) {
  const f = path.join(OUT, name + '.png');
  await page.screenshot({ path: f, fullPage: !!extra.fullPage });
  const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight, scrollX, scrollY]);
  manifest[profile].states[name] = Object.assign(manifest[profile].states[name] || {}, { img: rel(f), page: size, fullPage: !!extra.fullPage, rects: extra.rects || {}, net: await netInfo() });
  markTouched(name);
  console.log('captured', profile, name);
}
async function pieces(stateName, map, opt = {}) {
  // element crops with transparent page background
  await page.addStyleTag({ content: `html,body,#home,#heroTop,#appShell,#appMain{background:transparent!important} #heroVeil{display:none!important} ${opt.hideDrift ? '#drift{display:none!important}' : ''}` });
  const out = {};
  for (const [k, sel] of Object.entries(map)) {
    const loc = page.locator(sel);
    const n = await loc.count();
    out[k] = [];
    for (let i = 0; i < n; i++) {
      const e = loc.nth(i);
      if (!(await e.isVisible())) continue;
      const f = path.join(OUT, `${stateName}__${k}${n > 1 ? '_' + i : ''}.png`);
      await e.screenshot({ path: f, omitBackground: true });
      const b = await e.evaluate(el => { const r = el.getBoundingClientRect(); return [r.left + scrollX, r.top + scrollY, r.width, r.height]; });
      out[k].push({ img: rel(f), rect: b });
    }
  }
  manifest[profile].states[stateName] = Object.assign(manifest[profile].states[stateName] || {}, { pieces: out, net: await netInfo() });
  markTouched(stateName);
}

// ---------- group bookkeeping ----------
const ranGroups = new Set();        // interaction groups started in this run
const completedGroups = new Set();  // ... and finished without an error
const groupFail = {};               // g -> {failedAfter, error, at}
const lastState = {};               // g -> last state captured in this run
function startGroup(g) { ranGroups.add(g); lastState[g] = null; manifest[profile].sequences[g] = []; manifest[profile].pending[g] = []; }

function saveManifest() {
  // Other agents read (and other capture runs write) this file: merge into the current file on disk and
  // replace it atomically (write temp file, then rename).
  let disk;
  try { disk = readManifest(); }
  catch (e) {
    const side = `${MAN}.unmerged-${profile}-${process.pid}.json`;
    fs.writeFileSync(side, JSON.stringify({ [profile]: manifest[profile] }, null, 1));
    throw new Error(e.message + `; this run's ${profile} data was saved to ${side}`);
  }
  const mine = manifest[profile];
  const d = disk[profile] = disk[profile] || { states: {} };
  d.viewport = P;
  d.states = d.states || {};
  d.sequences = d.sequences || {};
  d.pending = d.pending || {};
  for (const n of touched) d.states[n] = mine.states[n];
  for (const [n, st] of Object.entries(d.states)) {
    if (!st || !st.group || touched.has(n)) continue;
    const g = st.group;
    if (completedGroups.has(g)) {
      // the group ran to the end and no longer produces this state (e.g. another chip got picked): drop it and its images
      delete d.states[n];
      for (const im of [st.img, st.vp && st.vp.img]) {
        if (!im) continue;
        const f = path.resolve(path.join(ROOT, 'film'), im);
        if (path.dirname(f) === OUT) { try { fs.unlinkSync(f); } catch (e) {} }
      }
    } else if (groupFail[g]) {
      // the group failed before reaching this state: keep the older capture, flagged
      const f = groupFail[g];
      if (!st.notRecaptured) st.staleBefore = { stale: !!st.stale, reason: st.reason || '' };
      st.stale = true;
      st.reason = `not re-captured: group ${g} failed after ${f.failedAfter || 'its start'} (${f.error})`;
      st.notRecaptured = f;
    }
  }
  if (mine.net) d.net = mine.net;
  for (const g of new Set([...completedGroups, ...Object.keys(groupFail)])) {
    if (!ranGroups.has(g)) {   // a static group (home/lang/skin/sections) that failed
      if (groupFail[g]) d.pending[g] = [{ state: '(rest of group)', reason: 'error: ' + groupFail[g].error, failedAfter: groupFail[g].failedAfter }];
      continue;
    }
    const seq = (mine.sequences[g] || []).slice();
    const pend = (mine.pending[g] || []).slice();
    if (groupFail[g]) {
      const old = (d.sequences[g] || []).filter(n => !touched.has(n) && d.states[n] && d.states[n].group === g);
      for (const n of Object.keys(d.states)) if (d.states[n] && d.states[n].group === g && !touched.has(n) && !old.includes(n)) old.push(n);
      seq.push(...old);
      for (const n of old) pend.push({ state: n, reason: d.states[n].reason });
      pend.push({ state: '(rest of group)', reason: 'error: ' + groupFail[g].error, failedAfter: groupFail[g].failedAfter, notRecaptured: old });
    }
    d.sequences[g] = seq;
    d.pending[g] = pend;
  }
  for (const k of Object.keys(d.pending)) if (!d.pending[k] || !d.pending[k].length) delete d.pending[k];
  d.notes = Object.assign(d.notes || {}, mine.notes);
  for (const k of Object.keys(d.notes)) if (!d.notes[k]) delete d.notes[k];
  const tmp = `${MAN}.tmp-${process.pid}`, tmpjs = `${MANJS}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(disk, null, 1));
  fs.writeFileSync(tmpjs, 'window.MANIFEST=' + JSON.stringify(disk) + ';');
  fs.renameSync(tmp, MAN);
  fs.renameSync(tmpjs, MANJS);
}

// ---------- interaction capture ----------
// measure({key: selector | [selector, max]}) -> {rects, labels, keys}; rects in page CSS px.
// labels = visible text of each element, keys = its data-k / data-g / data-rail / data-open / data-ico / id.
async function measure(map) {
  return page.evaluate((map) => {
    const out = { rects: {}, labels: {}, keys: {} };
    for (const [k, spec] of Object.entries(map)) {
      const [sel, max] = Array.isArray(spec) ? spec : [spec, 400];
      const els = [...document.querySelectorAll(sel)]
        .filter(e => { const b = e.getBoundingClientRect(); return (e.offsetParent !== null || e.tagName === 'CANVAS' || e.tagName === 'svg' || getComputedStyle(e).position === 'fixed') && b.width > 0 && b.height > 0; })
        .slice(0, max);
      out.rects[k] = els.map(e => { const b = e.getBoundingClientRect(); return [b.left + scrollX, b.top + scrollY, b.width, b.height].map(v => Math.round(v * 100) / 100); });
      out.labels[k] = els.map(e => ((e.tagName === 'INPUT' ? (e.value || e.placeholder) : e.innerText) || '').trim().replace(/\s+/g, ' ').slice(0, 120));
      out.keys[k] = els.map(e => e.dataset.k || e.dataset.g || e.dataset.rail || e.dataset.open || e.dataset.pick || e.dataset.isl || e.dataset.ico || e.id || '');
    }
    return out;
  }, map);
}
// Rows of a result table, in screen order: [{k, id, name, sub, rect}] (k = the site's own row key, stable
// across re-sorts and filters, so the film can animate rows moving between states).
async function rowItems(sel, max = 8) {
  return page.evaluate(([sel, max]) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null).slice(0, max).map(tr => {
    const b = tr.getBoundingClientRect(), img = tr.querySelector('img[data-ico]');
    const nm = tr.querySelector('.iname b') || tr.querySelector('b');
    const sub = tr.querySelector('.iname span') || tr.querySelector('.fresh');
    const cells = [...tr.children].map(td => { const c = td.getBoundingClientRect(); return [c.left + scrollX, c.top + scrollY, c.width, c.height].map(v => Math.round(v * 100) / 100); });
    return {
      k: tr.dataset.k || tr.dataset.open || tr.dataset.pick || '', id: img ? img.dataset.ico : (tr.dataset.open || tr.dataset.pick || ''),
      name: nm ? nm.innerText.trim().replace(/\s+/g, ' ') : '', sub: sub ? sub.innerText.trim().replace(/\s+/g, ' ') : '',
      text: tr.innerText.trim().replace(/\s+/g, ' ').slice(0, 200),
      rect: [b.left + scrollX, b.top + scrollY, b.width, b.height].map(v => Math.round(v * 100) / 100), cells,
    };
  }), [sel, max]);
}
async function settle(ms = 350) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await wait(ms);
}
// wait for item icons inside `scope` (first n) when the icon host is reachable (icoFail = the site gave up on it:
// waiting longer will not help; snap() still counts it as a blank icon)
async function waitIcons(scope, n = 8, ms = 15000) {
  if (!NET.icons) return false;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await page.evaluate(([scope, n]) => {
      const imgs = [...document.querySelectorAll(scope + ' img[data-ico]')].filter(i => i.offsetParent !== null).slice(0, n);
      return imgs.length > 0 && imgs.every(i => i.classList.contains('icoFail') || (i.getAttribute('src') && i.complete && i.naturalWidth > 0));
    }, [scope, n]);
    if (ok) return true;
    await wait(400);
  }
  return false;
}
// The site translates freshly rendered text one animation frame later (MutationObserver -> trDOM): wait until the
// status bar has been translated so labels are not recorded in Russian while the image shows English.
async function waitI18n(ms = 1500) {
  await page.waitForFunction(() => {
    try { if (typeof UI === 'undefined' || UI === 'ru') return true; } catch (e) { return true; }
    const s = document.getElementById('status');
    return !s || !/[Ѐ-ӿ]/.test(s.innerText);
  }, null, { timeout: ms, polling: 50 }).catch(() => {});
}
const ROWS = '#tableWrap > table > tbody > tr.row';
const tableState = () => page.evaluate((ROWS) => ({
  rows: document.querySelectorAll(ROWS).length,
  loaded: typeof S !== 'undefined' && !!S.loaded, kind: typeof S !== 'undefined' && S.st ? S.st.kind : '',
  status: (document.getElementById('status') || {}).innerText || '',
}), ROWS);
// Wait for real table rows. With no reachable data host the price load can never finish, so only watch the real
// loading state for GRACE ms and report why the table is empty.
async function waitTable(label) {
  const limit = DATA_ON ? +(process.env.DATA_WAIT || 90000) : +(process.env.GRACE || 5000);
  const t0 = Date.now();
  let st = await tableState();
  while (Date.now() - t0 < limit) {
    if (st.rows) break;
    if (st.loaded && st.kind === 'error') break;
    if (st.loaded && st.kind === 'ok' && Date.now() - t0 > 4000) break;      // loaded, but nothing passes the filters
    await wait(500);
    st = await tableState();
  }
  if (st.rows) { await waitIcons('#tableWrap', 8); await settle(300); return { ok: true, rows: st.rows, loaded: st.loaded }; }
  const reason = !DATA_ON ? 'no price data: data.json host and Albion Data API unreachable from the capture machine (real loading state shown)'
    : st.loaded ? `prices loaded but the table is empty (${st.kind}: ${st.status.replace(/\s+/g, ' ').slice(0, 120)})` : `prices did not arrive within ${Math.round(limit / 1000)} s`;
  console.log('  ', label, 'table not populated:', reason);
  return { ok: false, rows: 0, reason, loaded: st.loaded && st.kind !== 'error' };
}
function pend(group, name, why) {
  const p = manifest[profile].pending;
  (p[group] = p[group] || []).push({ state: name, reason: why });
  console.log('   skipped', profile, name, '-', why);
}
async function pageRect(loc) {
  return loc.evaluate(el => { const b = el.getBoundingClientRect(); return [b.left + scrollX, b.top + scrollY, b.width, b.height].map(v => Math.round(v * 100) / 100); });
}
// A real user action on `loc`: scroll it into view like the browser does, hover, then click at its centre.
// Returns {type, sel, label, rect, at, space:'prev'} in page CSS px for the film's cursor.
async function act(loc, sel, opts = {}) {
  await loc.scrollIntoViewIfNeeded();
  await settle(150);
  const rect = await pageRect(loc);
  const label = ((await loc.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  // aim at the centre of the element's on-screen part (a wide table row can run past the screen edge)
  const box = await loc.boundingBox();
  const vw = P.width, vh = P.height;
  const x0 = Math.max(0, box.x), x1 = Math.min(vw, box.x + box.width), y0 = Math.max(0, box.y), y1 = Math.min(vh, box.y + box.height);
  const pos = { x: (x1 > x0 ? (x0 + x1) / 2 : box.x + box.width / 2) - box.x, y: (y1 > y0 ? (y0 + y1) / 2 : box.y + box.height / 2) - box.y };
  await loc.hover({ position: pos });
  await settle(250);
  if (opts.beforeClick) await opts.beforeClick({ rect, label });
  await loc.click({ position: pos });
  const at = [Math.round((rect[0] + pos.x) * 100) / 100, Math.round((rect[1] + pos.y) * 100) / 100];
  return { type: 'click', sel, label, rect, at, space: 'prev' };
}
// The site's status texts while it loads: only the snapshot one is what real users see (for about a second);
// every other loading text belongs to the direct-API fallback that runs when data.json cannot be fetched.
const SNAPSHOT_LOADING = 'Загружаю готовый снимок цен…';
// What the page shows right after the screenshot: the site's S.st status, item icons and untranslated words
// inside the saved strip [0, h].
async function postShot(h) {
  return page.evaluate(([h, SNAPSHOT_LOADING]) => {
    const vw = innerWidth;
    const inStrip = b => b.width > 0 && b.height > 0 && b.bottom + scrollY > 0 && b.top + scrollY < h && b.right + scrollX > 0 && b.left + scrollX < vw;
    let site = null;
    try {
      const st = S.st || {};
      site = { kind: st.kind || '', src: st.src || '', text: st.text || '', partial: st.partial || null, loaded: !!S.loaded, ui: typeof UI !== 'undefined' ? UI : '' };
    } catch (e) {}
    const imgs = [...document.querySelectorAll('img[data-ico]')].filter(i => i.offsetParent !== null && inStrip(i.getBoundingClientRect()));
    const blank = imgs.filter(i => !i.getAttribute('src') || !i.complete || !i.naturalWidth || i.classList.contains('icoFail'));
    const broken = blank.filter(i => i.getAttribute('src') && i.complete && !i.naturalWidth);
    const words = {};
    if (site && site.ui && site.ui !== 'ru') {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const t = n.nodeValue;
        if (!/[Ѐ-ӿ]/.test(t)) continue;
        const el = n.parentElement;
        if (!el || el.closest('script,style,noscript,template,option,[hidden]')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        if (!inStrip(r.getBoundingClientRect())) continue;
        for (const m of t.match(/[Ѐ-ӿ][Ѐ-ӿ-]*/g) || []) if (m !== 'Русский') words[m] = (words[m] || 0) + 1;
      }
    }
    // only counts when the fallback is visible in the saved strip: the app status bar, the table skeleton note, or the
    // home page's status line (which says "loading in the background" instead of "prices ready")
    const vis = sel => [...document.querySelectorAll(sel)].some(e => e.offsetParent !== null && inStrip(e.getBoundingClientRect()));
    const shownIn = [['status', '#status'], ['skeleton', '#tableWrap .skel-note'], ['homeStatus', '#homeStatus']].filter(([, sel]) => vis(sel)).map(([k]) => k);
    const fallback = !!site && ((site.kind === 'loading' && !!site.text && site.text !== SNAPSHOT_LOADING) || site.src === 'api' || site.kind === 'error') && shownIn.length > 0;
    const homeStatus = shownIn.includes('homeStatus') ? (document.getElementById('homeStatus').innerText || '').trim() : '';
    return { site, fallback, shownIn, homeStatus, icons: { total: imgs.length, blank: blank.length, broken: broken.length }, words };
  }, [h, SNAPSHOT_LOADING]);
}
function where(r, vw, h) {
  if (!r) return 'out';
  const [x, y, w, hh] = r;
  if (x >= -0.5 && y >= -0.5 && x + w <= vw + 0.5 && y + hh <= h + 0.5) return 'full';
  if (x + w <= 0 || y + hh <= 0 || x >= vw || y >= h) return 'out';
  return 'partial';
}
// Save one state: a page strip from the top of the page (PageView-compatible: fullPage, page = [w, h] of the
// strip) that covers the user's current viewport and everything in `include`, plus a viewport-only image when
// the page is scrolled (exactly what the user sees at that moment). Rects/labels are measured before and after
// the shots; if they moved in between, the shots are retaken (up to 3 times) and the keys that kept moving are
// listed in labelDrift.
async function snap(group, name, o = {}) {
  if (!NET.live || !(await liveOn())) await liveMode();
  await settle(o.settle ?? 250);
  await waitI18n();
  const getItems = async () => (typeof o.items === 'function' ? await o.items() : o.items);
  const f = path.join(OUT, name + '.png');
  let m, items, info, vp, pre, drift = [];
  for (let shot = 1; ; shot++) {
    const m1 = await measure(o.map || {});
    const items1 = await getItems();
    info = await page.evaluate((inc) => {
      let bottom = 0;
      for (const sel of inc) for (const e of document.querySelectorAll(sel)) { if (e.offsetParent === null) continue; const b = e.getBoundingClientRect(); bottom = Math.max(bottom, b.bottom + scrollY + 24); }
      return { pw: document.documentElement.scrollWidth, ph: document.documentElement.scrollHeight, sx: scrollX, sy: scrollY, vw: innerWidth, vh: innerHeight, bottom };
    }, o.include || []);
    const vpBottom = info.sy + info.vh;
    info.h = Math.ceil(Math.min(info.ph, Math.max(vpBottom, Math.min(info.bottom, CAP[profile]))));
    pre = await postShot(info.h);
    await page.screenshot({ path: f, fullPage: true, clip: { x: 0, y: 0, width: info.vw, height: info.h } });
    vp = { img: null, scroll: [info.sx, info.sy], note: 'not scrolled: the viewport is the top of img' };
    if (info.sy > 0 || info.sx > 0) {
      const fv = path.join(OUT, name + '__vp.png');
      await page.screenshot({ path: fv });
      vp = { img: rel(fv), scroll: [info.sx, info.sy] };
    } else { try { fs.unlinkSync(path.join(OUT, name + '__vp.png')); } catch (e) {} }
    m = await measure(o.map || {});
    items = await getItems();
    drift = Object.keys(m.rects).filter(k => JSON.stringify([m.rects[k], m.labels[k]]) !== JSON.stringify([m1.rects[k], m1.labels[k]]));
    if (JSON.stringify(items) !== JSON.stringify(items1)) drift.push('items');
    if (!drift.length || shot >= 3) break;
    await settle(150);
  }
  const post = await postShot(info.h);
  const st = {
    img: rel(f), page: [info.vw, info.h, info.sx, info.sy], fullPage: true, pageSize: [info.pw, info.ph], vp,
    group, step: o.step || '', rects: m.rects, labels: m.labels, keys: m.keys,
  };
  st.inStrip = Object.fromEntries(Object.entries(m.rects).map(([k, rs]) => [k, rs.map(r => where(r, info.vw, info.h))]));
  if (items) st.items = items.map(it => Object.assign({}, it, { inStrip: where(it.rect, info.vw, info.h) }));
  if (o.click) st.click = Object.assign({}, o.click, o.click.rect ? { space: o.click.space || 'prev' } : {});
  if (o.typed != null) st.typed = o.typed;
  if (o.prev) st.prev = o.prev;
  if (o.next) st.next = Object.assign({ space: 'this' }, o.next);
  if (o.extra) Object.assign(st, o.extra);
  st.site = post.site;
  st.net = await netInfo();
  st.icons = post.icons;
  st.iconsBlank = post.icons.blank;
  st.iconsMissing = post.icons.blank > 0;
  // a real i18n gap is there before and after the shot; a status line caught mid-repaint (Russian for one frame) is not
  const leak = Object.keys(post.words).filter(w => pre.words[w]);
  if (leak.length) st.i18nLeak = leak;
  if (drift.length) st.labelDrift = drift;
  const why = [];
  if (o.stale) why.push(o.stale);
  if (post.fallback) {
    const txt = (post.shownIn.includes('status') && (m.labels.status || [])[0]) || post.homeStatus || post.site.text;
    st.apiFallback = { kind: post.site.kind, src: post.site.src, text: txt, siteText: post.site.text, shownIn: post.shownIn, statusRect: (m.rects.status || [])[0] || null };
    why.push(`${post.shownIn.join(' + ')} shows the site's direct-API fallback ("${txt.slice(0, 70)}") because data.json was unreachable; real users see the snapshot / ⚡ live state there`);
  }
  if (why.length) { st.stale = true; st.reason = why.join('; '); }
  manifest[profile].states[name] = st;
  markTouched(name);
  lastState[group] = name;
  (manifest[profile].sequences[group] = manifest[profile].sequences[group] || []).push(name);
  console.log('captured', profile, name, st.stale ? '[stale' + (post.fallback ? ': api fallback' : '') + ']' : '', st.iconsMissing ? `[${st.iconsBlank}/${st.icons.total} icons blank]` : '', st.i18nLeak ? `[i18n: ${st.i18nLeak.join(' ')}]` : '', drift.length ? `[drift: ${drift.join(',')}]` : '');
  return st;
}

// rect maps shared by the app-section states
const APP = {
  status: '#status', task: '#secTask', grp: '#grpRow button.grp', gold: '#goldBtn', search: '#searchInp', filters: '#filters',
  rail: '#rail button[data-rail]', side: '#sideCol', header: '#appHeader', view: '#appHeader .viewbox',
  th: '#tableWrap > table > thead th', row: [ROWS, 8], skel: '#tableWrap .skel', more: '#moreBtn', settings: '#colOpen',
};
const HOMEMAP = { go: '.heroGo', all: '.heroAll', stat: '#heroStats .heroStat', title: '#heroTop h1', lead: '#heroLead', card: '#home .cards .card' };
async function homeReady() {
  await boot(); await liveMode();
  if (!(await iconsOk())) await page.addStyleTag({ content: '#drift{display:none!important}' });  // floating item icons, blank without the icon host
  await settle(300);
}
// home -> section through a home button/card, with the hover state before the click
async function enterFromHome(group, prefix, sel) {
  await homeReady();
  const loc = page.locator(sel).first();
  const click = await act(loc, sel, {
    beforeClick: async ({ rect, label }) => {
      await snap(group, prefix + '_home_hover', { map: HOMEMAP, step: 'hover before click', next: { type: 'click', sel, label, rect, at: [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2] } });
    },
  });
  await settle(200);
  await snap(group, prefix + '_loading', { map: APP, click, prev: prefix + '_home_hover', step: 'right after the click (the real loading state)' });
  return click;
}
const sectionMap = (extra = {}) => Object.assign({}, APP, extra);
// The site keeps the home page's scroll offset when a section opens from a card far down the home page.
// Scroll back up with the mouse wheel, as a user would; returns the wheel action for the manifest.
async function wheelTop() {
  const y = await page.evaluate(() => scrollY);
  if (!y) return null;
  await page.mouse.wheel(0, -y - 200);
  await page.waitForFunction(() => scrollY === 0, null, { timeout: 5000 }).catch(() => {});
  await settle(300);
  return { type: 'wheel', dy: -y };
}
// attach follow-up actions (wheel / swipe) that happened after a click and before the state was saved
function withAfter(click, ...acts) {
  const a = acts.filter(Boolean);
  if (!a.length) return click;
  if (!click) return a.length === 1 ? a[0] : Object.assign({}, a[0], { after: a.slice(1) });
  click.after = (click.after || []).concat(a);
  return click;
}
// the item price card (item page after picking a suggestion, or after clicking an item name in a table)
const ITEMCARD = {
  card: '#tableWrap > .panel', back: '#itemBack', backSec: '#tableWrap .panel button[onclick^="backFromItem"]',
  icon: '#tableWrap > .panel img[data-ico]', chips: '#tableWrap > .panel .mchip',
  cityRow: '#tableWrap > .panel > table:first-of-type tbody tr', cityName: '#tableWrap > .panel > table:first-of-type tbody td.item b',
  qualHead: '#tableWrap > .panel > table:first-of-type thead th',
  bmTable: '#tableWrap > .panel > table:nth-of-type(2)', bmRow: '#tableWrap > .panel > table:nth-of-type(2) tbody tr',
  priceTables: '#tableWrap > .panel > table',
};

// Horizontal wheel over a sideways-scrolled table until it is back at its left edge.
async function wheelLeft(sel) {
  const x0 = await page.evaluate(sel => { const e = document.querySelector(sel); return e ? e.scrollLeft : 0; }, sel);
  if (!x0) return null;
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 200));
  await page.mouse.wheel(-x0 - 100, 0);
  await page.waitForFunction(sel => document.querySelector(sel).scrollLeft === 0, sel, { timeout: 4000 }).catch(() => {});
  await settle(300);
  return { type: 'wheel', dx: -x0, sel };
}
// Prices loaded but nothing passes the default "Sweet spot" filter: switch it off with the real button, as a user would.
async function goldOffIfEmpty(G, prefix, t, prev) {
  const st = await tableState();
  if (t.ok || !st.loaded || st.kind === 'error' || !(await page.locator('#goldBtn.active').count())) return { t, prev };
  const click = await act(page.locator('#goldBtn'), '#goldBtn');
  await settle(400);
  t = await waitTable(prefix + '_gold_off');
  await snap(G, prefix + '_gold_off', { map: sectionMap(), items: () => rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, click, prev, step: 'Sweet spot switched off (its filter left the table empty)', stale: t.ok ? '' : t.reason });
  return { t, prev: prefix + '_gold_off' };
}

// Every group runs guarded: a failure keeps what it captured, flags the older captures it did not reach (they stay
// in the manifest, stale), relaunches the browser if it died, and the remaining groups still run.
async function guarded(g, fn) {
  try {
    await fn();
    completedGroups.add(g);
  } catch (e) {
    const msg = String(e && e.message || e).split('\n')[0].slice(0, 200);
    console.log('  group', g, 'failed:', msg);
    groupFail[g] = { failedAfter: lastState[g] || null, error: msg, at: new Date().toISOString() };
    if (!browser.isConnected() || page.isClosed()) {
      try { await browser.close(); } catch (e2) {}
      await launch();
      console.log('  browser relaunched');
    }
  }
  saveManifest();
}
// ---------- groups ----------
await boot();
const icons = await iconsOk();
console.log('item icons reachable:', icons);
manifest[profile].net = Object.assign({ probedAt: new Date().toISOString() }, NET);

if (want('home')) await guarded('home', async () => {
  await boot(); await liveMode();
  if (!icons) await page.addStyleTag({ content: '#drift{display:none!important}' });
  await wait(400);
  const HOME = {
    logo: '#logoHome', title: '#heroTop h1', sub: '#heroTop .sub', lead: '#heroLead', go: '.heroGo', all: '.heroAll',
    stat: '#heroStats .heroStat', daily: '#homeDaily', chip: '.heroChips .hchip', view: '#homeView', card: '#home .cards .card', dl: '#dl', status: '#homeStatus', foot: '#home .foot',
  };
  await full('home_full', { fullPage: true, rects: await rects(HOME) });
  await page.evaluate(() => scrollTo(0, 0));
  await full('home_top', { rects: await rects(HOME) });
  // hover state of the main button, for the cursor
  await page.hover('.heroGo'); await wait(300);
  await full('home_top_hover', { rects: await rects(HOME) });
  await page.mouse.move(2, 2); await wait(300);
  await pieces('home', HOME, { hideDrift: true });
});

if (want('lang')) await guarded('lang', async () => {
  // the hero in every interface language the site ships
  for (const lg of ['en', 'ru', 'es', 'de', 'fr', 'pl', 'pt', 'it', 'tr']) {
    await boot(); await liveMode();
    await page.evaluate(l => { try { setUI(l); } catch (e) {} }, lg);
    await wait(1200); await liveMode(); await wait(200);
    if (!icons) await page.addStyleTag({ content: '#drift{display:none!important}' });
    await full('lang_' + lg, { rects: await rects({ title: '#heroTop h1', sub: '#heroTop .sub', lead: '#heroLead', go: '.heroGo' }) });
  }
  await boot();
  await page.evaluate(() => { try { setUI('en'); } catch (e) {} });
});

if (want('skin')) await guarded('skin', async () => {
  await boot(); await liveMode();
  await page.evaluate(() => { try { setSkin('pixel'); } catch (e) {} });
  await wait(800); await liveMode();
  if (!icons) await page.addStyleTag({ content: '#drift{display:none!important}' });
  await full('skin_pixel');
  await page.evaluate(() => { try { enterApp('craft'); } catch (e) {} });
  await wait(2500);
  await full('skin_pixel_craft');
  await page.evaluate(() => { try { setSkin('plain'); } catch (e) {} });
});

if (want('sections')) await guarded('sections', async () => {
  for (const s of ['craft', 'ref', 'flip', 'cityflip', 'ench', 'cons', 'isl', 'calc', 'item', 'roads']) {
    await boot();
    await page.evaluate(s => enterApp(s), s);
    await wait(+(process.env.SECTION_WAIT || 4000));
    await full('sec_' + s, { rects: await rects({ grp: '#grpRow .grp', th: '#tableWrap th', row: '#tableWrap tbody tr', search: '#searchInp', itemQ: '#itemQ' }) });
  }
});

// Crafting: home "Open Crafting →" (hover, click) -> populated table -> category chip -> sort by profit -> open the top row.
if (want('craft')) await guarded('craft', async () => {
  const G = 'craft'; startGroup(G);
  await enterFromHome(G, 'craft', '.heroGo');
  let t = await waitTable('craft_table');
  const wheel = await wheelTop();
  await snap(G, 'craft_table', { click: wheel, map: sectionMap(), items: () => rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, prev: 'craft_loading', step: 'table populated', stale: t.ok ? '' : t.reason });
  let prev = 'craft_table';
  ({ t, prev } = await goldOffIfEmpty(G, 'craft', t, prev));
  // category chip: bags, or gear when bags give a thin (or empty) table once prices are in
  let skipped = null;
  for (const g of ['bag', 'gear']) {
    const sel = `#grpRow button.grp[data-g="${g}"]`;
    if (!(await page.locator(sel).count())) { pend(G, 'craft_grp_' + g, 'chip not on the page'); continue; }
    const click = await act(page.locator(sel).first(), sel);
    await settle(400);
    t = await waitTable('craft_grp_' + g);
    if (g === 'bag' && t.loaded && (!t.ok || t.rows < 5)) {
      console.log('   bags give only', t.rows, 'rows, trying gear');
      skipped = { chip: 'bag', rows: t.rows, click };
      continue;
    }
    await waitIcons('#tableWrap', 8);
    const name = 'craft_grp_' + g;
    await snap(G, name, { map: sectionMap(), items: () => rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, click, prev, step: `chip ${g}`, stale: t.ok ? '' : t.reason, extra: skipped ? { skippedChip: skipped } : undefined });
    prev = name;
    // the chip left the table empty because of the Sweet spot filter: switch it off
    ({ t, prev } = await goldOffIfEmpty(G, name, t, prev));
    break;
  }
  // sort by profit per item (the "Profit/item" column, data-k=net)
  const sortSel = '#tableWrap > table > thead th[data-k="net"]';
  if (await page.locator(sortSel).count()) {
    const before = await rowItems(ROWS);
    const click = await act(page.locator(sortSel).first(), sortSel);
    await settle(400); await waitIcons('#tableWrap', 8);
    await snap(G, 'craft_sort_net', { map: sectionMap(), items: () => rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, click, prev, step: 'sorted by profit per item', extra: { itemsBefore: before } });
    prev = 'craft_sort_net';
    // open the top row (click its city cell: the item name is a link to the item page)
    const rowSel = `${ROWS} >> nth=0`;
    const cell = page.locator(ROWS).first().locator('td').nth(1);
    const click2 = await act(cell, rowSel);
    await page.waitForSelector('#tableWrap tr.det .detIn', { timeout: 10000 }).catch(() => {});
    await settle(600);
    const DET = {
      det: '#tableWrap tr.det:not([style*="none"]) .detIn', detB: '#tableWrap tr.det:not([style*="none"]) .detIn b',
      batch: '#tableWrap tr.det:not([style*="none"]) input[id^="calcN"]', batchMode: '#tableWrap tr.det:not([style*="none"]) select[id^="calcMode"]',
      batchOut: '#tableWrap tr.det:not([style*="none"]) [id^="calcOut"]', batchOutB: '#tableWrap tr.det:not([style*="none"]) [id^="calcOut"] b',
      chart: '#tableWrap tr.det:not([style*="none"]) .detIn svg', sellInput: '#tableWrap tr.det:not([style*="none"]) .detIn input[type="number"]:not([id])',
      openRow: `${ROWS}:first-child`,
    };
    await snap(G, 'craft_open', { map: sectionMap(DET), items: () => rowItems(ROWS, 3), include: ['#tableWrap tr.det:not([style*="none"])'], icons: true, click: click2, prev, step: 'top row expanded: unit cost, sale, profit/day, batch calculator' });
  } else {
    pend(G, 'craft_sort_net', 'no table header: the price table never populated (no data)');
    pend(G, 'craft_open', 'no rows to open (no data)');
  }
});

// Flipping -> Black Market: home card (hover, click) -> populated table -> Gear chip -> sort by profit -> top item's price card.
if (want('flip')) await guarded('flip', async () => {
  const G = 'flip'; startGroup(G);
  await enterFromHome(G, 'flip', `#home .cards .card[onclick*="'flip'"]`);
  let t = await waitTable('flip_table');
  const wheel = await wheelTop();
  await snap(G, 'flip_table', { click: wheel, map: sectionMap(), items: () => rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, prev: 'flip_loading', step: 'table populated', stale: t.ok ? '' : t.reason });
  let prev = 'flip_table';
  ({ t, prev } = await goldOffIfEmpty(G, 'flip', t, prev));
  const chipSel = '#grpRow button.grp[data-g="gear"]';
  if (await page.locator(chipSel).count()) {
    const click = await act(page.locator(chipSel).first(), chipSel);
    await settle(400);
    t = await waitTable('flip_grp_gear');
    await snap(G, 'flip_grp_gear', { map: sectionMap(), items: () => rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, click, prev, step: 'chip gear', stale: t.ok ? '' : t.reason });
    prev = 'flip_grp_gear';
    ({ t, prev } = await goldOffIfEmpty(G, 'flip_grp_gear', t, prev));
  } else pend(G, 'flip_grp_gear', 'chip not on the page');
  const sortSel = '#tableWrap > table > thead th[data-k="net"]';
  if (await page.locator(sortSel).count()) {
    const before = await rowItems(ROWS);
    const click = await act(page.locator(sortSel).first(), sortSel);
    await settle(400); await waitIcons('#tableWrap', 8);
    await snap(G, 'flip_sort_net', { map: sectionMap(), items: () => rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, click, prev, step: 'sorted by profit per item', extra: { itemsBefore: before } });
    prev = 'flip_sort_net';
    // flip rows have no inline card: the item name opens the item's price card (all cities + Black Market)
    // the sort click scrolled the table sideways to the profit column; the item card opens inside the same
    // scroller and would keep that offset, so swipe the table back to the start first, as a user would
    const swipe = await wheelLeft('#tableWrap');
    const lnkSel = `${ROWS} >> nth=0 >> b.lnk`;
    const click2 = await act(page.locator(ROWS).first().locator('b.lnk').first(), lnkSel);
    if (swipe) click2.before = [swipe];
    await page.waitForSelector('#itemBack', { timeout: 10000 }).catch(() => {});
    await waitIcons('#tableWrap', 1); await settle(500);
    const priced = await page.evaluate(() => { const id = S.itemSel; return !!id && (Object.keys(S.cityPrices[id] || {}).length > 0 || Object.keys(S.matPrices[id] || {}).length > 0 || !!S.bm[id]); });
    await snap(G, 'flip_item', { map: Object.assign(sectionMap(), ITEMCARD), include: ['#tableWrap .panel'], icons: true, click: click2, prev, step: 'top row -> item price card', stale: priced ? '' : 'item card without prices (no data)' });
  } else {
    pend(G, 'flip_sort_net', 'no table header: the price table never populated (no data)');
    pend(G, 'flip_item', 'no rows to open (no data)');
  }
});

// Item prices: home card -> click the search box -> type "mas cap" one key at a time -> pick "Master's Cape" -> price card.
if (want('item')) await guarded('item', async () => {
  const G = 'item'; startGroup(G);
  await enterFromHome(G, 'item', `#home .cards .card[onclick*="'item'"]`);
  await page.waitForSelector('#itemQ');
  const IMAP = sectionMap({ q: '#itemQ', tier: '#itemTierSel', ench: '#itemEnchSel', hint: '#tableWrap .panel > .fresh', sugg: ['#tableWrap tr.row[data-open]', 14] });
  const wheel = await wheelTop();
  await snap(G, 'item_empty', { map: IMAP, prev: 'item_loading', step: 'search page', click: wheel });
  const click = await act(page.locator('#itemQ'), '#itemQ');
  await settle(200);
  await snap(G, 'item_focus', { map: IMAP, click, prev: 'item_empty', step: 'search box focused' });
  const word = 'mas cap';
  let prev = 'item_focus';
  const leaks = {};
  for (let i = 0; i < word.length; i++) {
    await page.keyboard.type(word[i]);
    await settle(300);
    await waitIcons('#tableWrap', 8, 8000);
    const typed = word.slice(0, i + 1), name = 'item_q' + (i + 1);
    const qr = await pageRect(page.locator('#itemQ'));
    const st = await snap(G, name, { map: IMAP, items: () => rowItems('#tableWrap tr.row[data-open]', 14), include: ['#tableWrap tr.row[data-open]:nth-child(-n+10)'], icons: typed.trim().length >= 2, typed, prev, step: `typed "${typed}"`, click: { type: 'key', key: word[i] === ' ' ? 'Space' : word[i], sel: '#itemQ', rect: qr, at: [qr[0] + qr[2] / 2, qr[1] + qr[3] / 2], space: 'this' } });
    if (st.i18nLeak) leaks[name] = st.i18nLeak;
    prev = name;
  }
  const clean = Array.from({ length: word.length }, (_, i) => 'item_q' + (i + 1)).filter(n => !leaks[n]);
  manifest[profile].notes.item_typing = Object.keys(leaks).length
    ? `Site i18n bug, not fixable in the film without redrawing UI: ${Object.entries(leaks).map(([n, w]) => `${n} shows "${w.join('", "')}"`).join('; ')} in the English UI (untranslated suggestion subtitles). Only flash those frames; hold ${clean.length ? clean.join(' / ') : 'none'} long enough to read.`
    : '';
  // pick the plain "Master's Cape" suggestion (not a faction cape)
  const pick = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#tableWrap tr.row[data-open]')];
    const r = rows.find(tr => /^T\d_CAPE$/.test(tr.dataset.open)) || rows.find(tr => (tr.querySelector('.iname b') || {}).innerText === "Master's Cape") || rows[0];
    return r ? r.dataset.open : null;
  });
  if (pick) {
    const sel = `#tableWrap tr.row[data-open="${pick}"] .iname`;
    const click2 = await act(page.locator(sel).first(), sel);
    await page.waitForSelector('#itemBack', { timeout: 10000 }).catch(() => {});
    withAfter(click2, await wheelLeft('#tableWrap'));
    await waitIcons('#tableWrap', 1); await settle(500);
    const priced = await page.evaluate(() => { const id = S.itemSel; return !!id && (Object.keys(S.cityPrices[id] || {}).length > 0 || Object.keys(S.matPrices[id] || {}).length > 0 || !!S.bm[id]); });
    await snap(G, 'item_card', { map: Object.assign(sectionMap(), ITEMCARD), include: ['#tableWrap .panel'], icons: true, click: click2, prev, step: `picked ${pick}`, extra: { itemId: pick }, stale: priced ? '' : 'no prices in the card: data.json / Albion Data API unreachable (names and layout are real)' });
  } else pend(G, 'item_card', 'no "Master\'s Cape" suggestion found');
});

// One strong screen per remaining section, reached through the real section rail: Refining, Enchanting,
// Potions & food, Islands, Roads to Caerleon, Calculator (with an item picked). The page is brought back to the
// top with the mouse wheel (recorded in click.after), as a user would.
if (want('montage')) await guarded('montage', async () => {
  const G = 'montage'; startGroup(G);
  await enterFromHome(G, 'mont', `#home .cards .card[onclick*="'ref'"]`);
  let prev = 'mont_loading';
  let first = true;
  for (const s of ['ref', 'ench', 'cons', 'isl', 'roads', 'calc']) {
    let click = null;
    if (!first) {
      const sel = `#rail button[data-rail="${s}"]`;
      click = await act(page.locator(sel).first(), sel);
      await settle(400);
    }
    first = false;
    const name = 'mont_' + s;
    if (['ref', 'ench', 'cons'].includes(s)) {
      const t = await waitTable(name);
      click = withAfter(click, await wheelTop());
      await snap(G, name, { map: sectionMap(), items: () => rowItems(ROWS), include: [`${ROWS}:nth-child(-n+12)`], icons: true, click, prev, step: 'section table', stale: t.ok ? '' : t.reason });
    } else if (s === 'isl') {
      await page.waitForSelector('.islCard', { timeout: 15000 }).catch(() => {});
      await page.waitForFunction(() => { const im = [...document.querySelectorAll('.islCard img.islArt')]; return im.length && im.every(i => i.complete && i.naturalWidth > 0); }, null, { timeout: 15000 }).catch(() => {});
      if (DATA_ON) await page.waitForFunction(() => document.querySelectorAll('.islPill:not(.na)').length > 0, null, { timeout: +(process.env.DATA_WAIT || 90000) }).catch(() => {});
      await waitIcons('.islWrap', 6);
      click = withAfter(click, await wheelTop());
      const priced = await page.evaluate(() => document.querySelectorAll('.islPill:not(.na)').length);
      await snap(G, name, { map: sectionMap({ islCard: '.islCard', islArt: '.islCard img.islArt', islPill: '.islPill', islBest: '.islBest', islName: '.islNm' }), include: ['.islWrap'], icons: true, click, prev, step: 'islands: city cards with art', stale: priced ? '' : 'no seed/animal prices (no data): city cards show "no prices"' });
    } else if (s === 'roads') {
      await page.waitForFunction(() => S.roads && (S.roads.loaded || S.roads.err) && !S.roads.loading, null, { timeout: NET.kill ? 60000 : 8000 }).catch(() => {});
      await waitIcons('#tableWrap', 6, 8000);
      click = withAfter(click, await wheelTop());
      const ok = await page.evaluate(() => !!(S.roads && S.roads.loaded && !S.roads.err));
      await snap(G, name, { map: sectionMap({ roads: '#tableWrap .panel', roadsRow: ['#tableWrap tbody tr', 10] }), include: ['#tableWrap .panel'], icons: true, click, prev, step: 'roads to Caerleon', stale: ok ? '' : 'killboard (gameinfo-ams.albiononline.com) unreachable' });
    } else if (s === 'calc') {
      await page.waitForSelector('#calcQ', { timeout: 10000 }).catch(() => {});
      click = withAfter(click, await wheelTop());
      await snap(G, 'mont_calc_search', { map: sectionMap({ q: '#calcQ' }), click, prev, step: 'calculator search' });
      prev = 'mont_calc_search';
      const c1 = await act(page.locator('#calcQ'), '#calcQ');
      await page.keyboard.type('mas bag', { delay: 90 });
      await settle(400);
      const pick = await page.evaluate(() => { const r = [...document.querySelectorAll('tr[data-pick]')]; const x = r.find(tr => /^T\d_BAG$/.test(tr.dataset.pick)) || r[0]; return x ? x.dataset.pick : null; });
      if (!pick) { pend(G, 'mont_calc', 'no calculator suggestion'); continue; }
      const sel = `tr[data-pick="${pick}"] td:first-child`;   // left cell: the list is wider than a phone
      const c2 = await act(page.locator(sel).first(), sel);
      c2.space = 'prev, after typing "mas bag" (searchClick + typed)';
      await settle(500);
      withAfter(c2, await wheelLeft('#tableWrap'));
      await waitIcons('#tableWrap', 6);
      withAfter(c2, await wheelTop());
      const priced = await page.evaluate(() => { try { const T = calcTotals(); return !!(T && T.px != null && T.profit != null); } catch (e) { return false; } });
      await snap(G, name, { map: sectionMap({ calc: '#tableWrap > .panel', calcOut: '#calcOut', calcInputs: '#tableWrap .panel input', calcSelects: '#tableWrap .panel select' }), include: ['#tableWrap > .panel'], icons: true, click: c2, prev, step: `calculator with ${pick}`, extra: { itemId: pick, typed: 'mas bag', searchClick: c1 }, stale: priced ? '' : 'calculator without market prices (no data)' });
    }
    prev = name;
  }
});

saveManifest();
await browser.close();
