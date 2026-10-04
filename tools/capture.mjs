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
// Env: NET=off|on (skip probe: block all / pass all), LIVE_STUB=0 (see liveStub below), DATA_WAIT=ms (default 90000),
//      GRACE=ms (how long to watch the real loading state when no data host is reachable, default 5000).
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
const readManifest = () => { for (let i = 0; i < 5; i++) { try { return fs.existsSync(MAN) ? JSON.parse(fs.readFileSync(MAN, 'utf8')) : {}; } catch (e) { spawnSync('sleep', ['0.2']); } } return {}; };
const manifest = readManifest();
manifest[profile] = manifest[profile] || { viewport: P, states: {} };
manifest[profile].viewport = P;
manifest[profile].sequences = manifest[profile].sequences || {};
manifest[profile].pending = manifest[profile].pending || {};
const touched = new Set();
const want = g => !groups.length || groups.includes(g);
const rel = f => path.relative(path.join(ROOT, 'film'), f);

// ---------- network probe ----------
const LIVE_SITE = 'https://vanatoliyv.github.io/albion-craft-profit/';
const LIVE_HOST = '129-80-180-213.sslip.io';
const nowS = Math.floor(Date.now() / 1000);
const PROBE = {
  data:  { host: 'vanatoliyv.github.io',          url: LIVE_SITE + 'data-stats.json?v=' + Date.now() },
  live:  { host: LIVE_HOST,                        url: `https://${LIVE_HOST}/live.json?since=${nowS - 60}` },
  icons: { host: 'render.albiononline.com',        url: 'https://render.albiononline.com/v1/item/T4_BAG.png?size=64' },
  api:   { host: 'europe.albion-online-data.com',  url: 'https://europe.albion-online-data.com/api/v2/stats/prices/T4_BAG.json?locations=Caerleon&qualities=1' },
  kill:  { host: 'gameinfo-ams.albiononline.com',  url: 'https://gameinfo-ams.albiononline.com/api/gameinfo/events?limit=1&offset=0' },
};
const NET = {};
const PASS = new Set((process.env.PASS_HOSTS || '').split(',').filter(Boolean));
// The owner confirms the live feed is running and the site shows "⚡ seconds" / "⚡ Live prices" (not the
// "12 min" snapshot fallback). When the feed host is unreachable from here, answer the site's poll with the
// feed's "nothing new since" reply ({} - no prices), so the site's own code keeps its live state on.
const LIVE_STUB = process.env.LIVE_STUB !== '0';

const { browser, ctx, page } = await open(P);
page.setDefaultTimeout(20000);
const wait = ms => page.waitForTimeout(ms);

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
  NET.liveStub = !NET.live && LIVE_STUB;
  console.log(profile, 'network:', JSON.stringify(NET));
}
await probe();
const DATA_ON = NET.data || NET.api;
const siteHost = new URL(SITE).host;
const MIRROR = new Set(['/data.json', '/data-stats.json', '/own.json']);
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
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: '{}' });
  }
  if (PASS.has(u.hostname)) {
    try { return await route.fulfill({ response: await route.fetch({ timeout: 60000 }) }); }
    catch (e) { return route.abort('failed'); }
  }
  return route.fallback();
});

// ---------- shared helpers ----------
async function boot() {
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await wait(1500);
  await page.evaluate(() => { try { setAnim('off'); } catch (e) {} });   // no idle animation in stills; the film animates the logo itself
}
async function iconsOk() {
  return page.evaluate(() => { const i = document.querySelector('#drift img'); return !!(i && i.complete && i.naturalWidth > 0); });
}
async function liveMode() {
  // The live site shows "⚡ seconds" once its live price feed answers (owner-confirmed: updates are instant now,
  // not the 12-minute snapshot step). Mark the feed as answered and repaint, exactly as the site does on a reply.
  await page.evaluate(() => { try { liveOkAt = Date.now(); paintHeroStats(); if (S.st && S.st.kind === 'ok') renderStatus(); } catch (e) {} });
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
  manifest[profile].states[name] = Object.assign(manifest[profile].states[name] || {}, { img: rel(f), page: size, fullPage: !!extra.fullPage, rects: extra.rects || {} });
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
  manifest[profile].states[stateName] = Object.assign(manifest[profile].states[stateName] || {}, { pieces: out });
  markTouched(stateName);
}
function saveManifest() {
  // Other agents read (and other capture runs write) this file: merge into the current file on disk and
  // replace it atomically (write temp file, then rename).
  const disk = readManifest();
  const mine = manifest[profile];
  const d = disk[profile] = disk[profile] || { states: {} };
  d.viewport = P;
  d.states = d.states || {};
  for (const n of touched) d.states[n] = mine.states[n];
  // drop states an earlier run of the same interaction group left behind (e.g. a chip that is no longer picked)
  for (const [n, st] of Object.entries(d.states)) if (st && st.group && ranGroups.has(st.group) && !touched.has(n)) delete d.states[n];
  if (mine.net) d.net = mine.net;
  d.sequences = Object.assign(d.sequences || {}, mine.sequences);
  d.pending = Object.assign(d.pending || {}, mine.pending);
  for (const k of Object.keys(d.pending)) if (!d.pending[k] || !d.pending[k].length) delete d.pending[k];
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
// wait for item icons inside `scope` (first n) when the icon host is reachable
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
  if (st.rows) { await waitIcons('#tableWrap', 8); await settle(300); return { ok: true, rows: st.rows }; }
  const reason = !DATA_ON ? 'no price data: data.json host and Albion Data API unreachable from the capture machine (real loading state shown)'
    : st.loaded ? `prices loaded but the table is empty (${st.kind}: ${st.status.replace(/\s+/g, ' ').slice(0, 120)})` : `prices did not arrive within ${Math.round(limit / 1000)} s`;
  console.log('  ', label, 'table not populated:', reason);
  return { ok: false, rows: 0, reason };
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
// Returns {type, sel, label, rect, at} in page CSS px for the film's cursor.
async function act(loc, sel, opts = {}) {
  await loc.scrollIntoViewIfNeeded();
  await settle(150);
  const rect = await pageRect(loc);
  const label = ((await loc.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const box = await loc.boundingBox();
  const pos = { x: box.width / 2, y: box.height / 2 };
  await loc.hover({ position: pos });
  await settle(250);
  if (opts.beforeClick) await opts.beforeClick({ rect, label });
  await loc.click({ position: pos });
  const at = [Math.round((rect[0] + pos.x) * 100) / 100, Math.round((rect[1] + pos.y) * 100) / 100];
  return { type: 'click', sel, label, rect, at };
}
// Save one state: a page strip from the top of the page (PageView-compatible: fullPage, page = [w, h] of the
// strip) that covers the user's current viewport and everything in `include`, plus a viewport-only image when
// the page is scrolled (exactly what the user sees at that moment).
async function snap(group, name, o = {}) {
  if (!NET.live) await liveMode();
  await settle(o.settle ?? 250);
  const m = await measure(o.map || {});
  const info = await page.evaluate((inc) => {
    let bottom = 0;
    for (const sel of inc) for (const e of document.querySelectorAll(sel)) { if (e.offsetParent === null) continue; const b = e.getBoundingClientRect(); bottom = Math.max(bottom, b.bottom + scrollY + 24); }
    return { pw: document.documentElement.scrollWidth, ph: document.documentElement.scrollHeight, sx: scrollX, sy: scrollY, vw: innerWidth, vh: innerHeight, bottom };
  }, o.include || []);
  const vpBottom = info.sy + info.vh;
  const h = Math.ceil(Math.min(info.ph, Math.max(vpBottom, Math.min(info.bottom, CAP[profile]))));
  const f = path.join(OUT, name + '.png');
  await page.screenshot({ path: f, fullPage: true, clip: { x: 0, y: 0, width: info.vw, height: h } });
  let vp = { img: null, scroll: [info.sx, info.sy], note: 'not scrolled: the viewport is the top of img' };
  if (info.sy > 0 || info.sx > 0) {
    const fv = path.join(OUT, name + '__vp.png');
    await page.screenshot({ path: fv });
    vp = { img: rel(fv), scroll: [info.sx, info.sy] };
  } else { try { fs.unlinkSync(path.join(OUT, name + '__vp.png')); } catch (e) {} }
  const st = {
    img: rel(f), page: [info.vw, h, info.sx, info.sy], fullPage: true, pageSize: [info.pw, info.ph], vp,
    group, step: o.step || '', rects: m.rects, labels: m.labels, keys: m.keys,
  };
  if (o.items) st.items = o.items;
  if (o.click) st.click = o.click;
  if (o.typed != null) st.typed = o.typed;
  if (o.prev) st.prev = o.prev;
  if (o.next) st.next = o.next;
  if (o.extra) Object.assign(st, o.extra);
  st.net = { data: !!NET.data, api: !!NET.api, live: !!NET.live, liveStub: !!NET.liveStub, icons: !!NET.icons, kill: !!NET.kill };
  st.iconsMissing = !!o.icons && !NET.icons;
  if (o.stale) { st.stale = true; st.reason = o.stale; }
  manifest[profile].states[name] = st;
  markTouched(name);
  (manifest[profile].sequences[group] = manifest[profile].sequences[group] || []).push(name);
  console.log('captured', profile, name, o.stale ? '[stale]' : '', st.iconsMissing ? '[no icons]' : '');
  return st;
}
const ranGroups = new Set();
function startGroup(g) { ranGroups.add(g); manifest[profile].sequences[g] = []; manifest[profile].pending[g] = []; }

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
  let hoverSt;
  const click = await act(loc, sel, {
    beforeClick: async ({ rect, label }) => {
      hoverSt = await snap(group, prefix + '_home_hover', { map: HOMEMAP, step: 'hover before click', next: { type: 'click', sel, label, rect, at: [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2] } });
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
  await snap(G, prefix + '_gold_off', { map: sectionMap(), items: await rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, click, prev, step: 'Sweet spot switched off (its filter left the table empty)', stale: t.ok ? '' : t.reason });
  return { t, prev: prefix + '_gold_off' };
}

// ---------- groups ----------
await boot();
const icons = await iconsOk();
console.log('item icons reachable:', icons);
manifest[profile].net = Object.assign({ probedAt: new Date().toISOString() }, NET);

if (want('home')) {
  await liveMode();
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
  saveManifest();
}

if (want('lang')) {
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
  saveManifest();
}

if (want('skin')) {
  await boot(); await liveMode();
  await page.evaluate(() => { try { setSkin('pixel'); } catch (e) {} });
  await wait(800); await liveMode();
  if (!icons) await page.addStyleTag({ content: '#drift{display:none!important}' });
  await full('skin_pixel');
  await page.evaluate(() => { try { enterApp('craft'); } catch (e) {} });
  await wait(2500);
  await full('skin_pixel_craft');
  await page.evaluate(() => { try { setSkin('plain'); } catch (e) {} });
  saveManifest();
}

if (want('sections')) {
  for (const s of ['craft', 'ref', 'flip', 'cityflip', 'ench', 'cons', 'isl', 'calc', 'item', 'roads']) {
    await boot();
    await page.evaluate(s => enterApp(s), s);
    await wait(+(process.env.SECTION_WAIT || 4000));
    await full('sec_' + s, { rects: await rects({ grp: '#grpRow .grp', th: '#tableWrap th', row: '#tableWrap tbody tr', search: '#searchInp', itemQ: '#itemQ' }) });
  }
  saveManifest();
}

// Crafting: home "Open Crafting →" (hover, click) -> populated table -> category chip -> sort by profit -> open the top row.
if (want('craft')) {
  const G = 'craft'; startGroup(G);
  await enterFromHome(G, 'craft', '.heroGo');
  let t = await waitTable('craft_table');
  const wheel = await wheelTop();
  await snap(G, 'craft_table', { click: wheel, map: sectionMap(), items: await rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, prev: 'craft_loading', step: 'table populated', stale: t.ok ? '' : t.reason });
  let prev = 'craft_table';
  ({ t, prev } = await goldOffIfEmpty(G, 'craft', t, prev));
  // category chip: bags, or gear when bags give a thin table
  for (const g of ['bag', 'gear']) {
    const sel = `#grpRow button.grp[data-g="${g}"]`;
    if (!(await page.locator(sel).count())) { pend(G, 'craft_grp_' + g, 'chip not on the page'); continue; }
    const click = await act(page.locator(sel).first(), sel);
    await settle(400);
    t = await waitTable('craft_grp_' + g);
    if (t.ok && t.rows < 5 && g === 'bag') { console.log('   bags give only', t.rows, 'rows, trying gear'); continue; }
    await waitIcons('#tableWrap', 8);
    await snap(G, 'craft_grp_' + g, { map: sectionMap(), items: await rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, click, prev, step: `chip ${g}`, stale: t.ok ? '' : t.reason });
    prev = 'craft_grp_' + g;
    break;
  }
  // sort by profit per item (the "Profit/item" column, data-k=net)
  const sortSel = '#tableWrap > table > thead th[data-k="net"]';
  if (await page.locator(sortSel).count()) {
    const before = await rowItems(ROWS);
    const click = await act(page.locator(sortSel).first(), sortSel);
    await settle(400); await waitIcons('#tableWrap', 8);
    await snap(G, 'craft_sort_net', { map: sectionMap(), items: await rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, click, prev, step: 'sorted by profit per item', extra: { itemsBefore: before } });
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
    await snap(G, 'craft_open', { map: sectionMap(DET), items: await rowItems(ROWS, 3), include: ['#tableWrap tr.det:not([style*="none"])'], icons: true, click: click2, prev, step: 'top row expanded: unit cost, sale, profit/day, batch calculator' });
  } else {
    pend(G, 'craft_sort_net', 'no table header: the price table never populated (no data)');
    pend(G, 'craft_open', 'no rows to open (no data)');
  }
  saveManifest();
}

// Flipping -> Black Market: home card (hover, click) -> populated table -> Gear chip -> sort by profit -> top item's price card.
if (want('flip')) {
  const G = 'flip'; startGroup(G);
  await enterFromHome(G, 'flip', `#home .cards .card[onclick*="'flip'"]`);
  let t = await waitTable('flip_table');
  const wheel = await wheelTop();
  await snap(G, 'flip_table', { click: wheel, map: sectionMap(), items: await rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, prev: 'flip_loading', step: 'table populated', stale: t.ok ? '' : t.reason });
  let prev = 'flip_table';
  ({ t, prev } = await goldOffIfEmpty(G, 'flip', t, prev));
  const chipSel = '#grpRow button.grp[data-g="gear"]';
  if (await page.locator(chipSel).count()) {
    const click = await act(page.locator(chipSel).first(), chipSel);
    await settle(400);
    t = await waitTable('flip_grp_gear');
    await snap(G, 'flip_grp_gear', { map: sectionMap(), items: await rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, click, prev, step: 'chip gear', stale: t.ok ? '' : t.reason });
    prev = 'flip_grp_gear';
  } else pend(G, 'flip_grp_gear', 'chip not on the page');
  const sortSel = '#tableWrap > table > thead th[data-k="net"]';
  if (await page.locator(sortSel).count()) {
    const before = await rowItems(ROWS);
    const click = await act(page.locator(sortSel).first(), sortSel);
    await settle(400); await waitIcons('#tableWrap', 8);
    await snap(G, 'flip_sort_net', { map: sectionMap(), items: await rowItems(ROWS), include: [`${ROWS}:nth-child(-n+16)`], icons: true, click, prev, step: 'sorted by profit per item', extra: { itemsBefore: before } });
    prev = 'flip_sort_net';
    // flip rows have no inline card: the item name opens the item's price card (all cities + Black Market)
    // the sort click scrolled the table sideways to the profit column; the item card opens inside the same
    // scroller and would keep that offset, so swipe the table back to the start first, as a user would
    const swipe = await wheelLeft('#tableWrap');
    const lnkSel = `${ROWS} >> nth=0 >> b.lnk`;
    const click2 = await act(page.locator(ROWS).first().locator('b.lnk').first(), lnkSel);
    if (swipe) click2.before = swipe;
    await page.waitForSelector('#itemBack', { timeout: 10000 }).catch(() => {});
    await waitIcons('#tableWrap', 1); await settle(500);
    const priced = await page.evaluate(() => { const id = S.itemSel; return !!id && (Object.keys(S.cityPrices[id] || {}).length > 0 || Object.keys(S.matPrices[id] || {}).length > 0 || !!S.bm[id]); });
    await snap(G, 'flip_item', { map: Object.assign(sectionMap(), ITEMCARD), include: ['#tableWrap .panel'], icons: true, click: click2, prev, step: 'top row -> item price card', stale: priced ? '' : 'item card without prices (no data)' });
  } else {
    pend(G, 'flip_sort_net', 'no table header: the price table never populated (no data)');
    pend(G, 'flip_item', 'no rows to open (no data)');
  }
  saveManifest();
}

// Item prices: home card -> click the search box -> type "mas cap" one key at a time -> pick "Master's Cape" -> price card.
if (want('item')) {
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
  for (let i = 0; i < word.length; i++) {
    await page.keyboard.type(word[i]);
    await settle(300);
    await waitIcons('#tableWrap', 8, 8000);
    const typed = word.slice(0, i + 1), name = 'item_q' + (i + 1);
    const qr = await pageRect(page.locator('#itemQ'));
    await snap(G, name, { map: IMAP, items: await rowItems('#tableWrap tr.row[data-open]', 14), include: ['#tableWrap tr.row[data-open]:nth-child(-n+10)'], icons: typed.trim().length >= 2, typed, prev, step: `typed "${typed}"`, click: { type: 'key', key: word[i] === ' ' ? 'Space' : word[i], sel: '#itemQ', rect: qr, at: [qr[0] + qr[2] / 2, qr[1] + qr[3] / 2] } });
    prev = name;
  }
  // pick the plain "Master's Cape" suggestion (not a faction cape)
  const pick = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#tableWrap tr.row[data-open]')];
    const r = rows.find(tr => /^T\d_CAPE$/.test(tr.dataset.open)) || rows.find(tr => (tr.querySelector('.iname b') || {}).innerText === "Master's Cape") || rows[0];
    return r ? r.dataset.open : null;
  });
  if (pick) {
    const sel = `#tableWrap tr.row[data-open="${pick}"]`;
    const click2 = await act(page.locator(sel).first(), sel);
    await page.waitForSelector('#itemBack', { timeout: 10000 }).catch(() => {});
    await waitIcons('#tableWrap', 1); await settle(500);
    const priced = await page.evaluate(() => { const id = S.itemSel; return !!id && (Object.keys(S.cityPrices[id] || {}).length > 0 || Object.keys(S.matPrices[id] || {}).length > 0 || !!S.bm[id]); });
    await snap(G, 'item_card', { map: Object.assign(sectionMap(), ITEMCARD), include: ['#tableWrap .panel'], icons: true, click: click2, prev, step: `picked ${pick}`, extra: { itemId: pick }, stale: priced ? '' : 'no prices in the card: data.json / Albion Data API unreachable (names and layout are real)' });
  } else pend(G, 'item_card', 'no "Master\'s Cape" suggestion found');
  saveManifest();
}

// One strong screen per remaining section, reached through the real section rail: Refining, Enchanting,
// Potions & food, Islands, Roads to Caerleon, Calculator (with an item picked).
if (want('montage')) {
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
      await page.evaluate(() => scrollTo(0, 0)); await settle(200);
      await snap(G, name, { map: sectionMap(), items: await rowItems(ROWS), include: [`${ROWS}:nth-child(-n+12)`], icons: true, click, prev, step: 'section table', stale: t.ok ? '' : t.reason });
    } else if (s === 'isl') {
      await page.waitForSelector('.islCard', { timeout: 15000 }).catch(() => {});
      await page.waitForFunction(() => { const im = [...document.querySelectorAll('.islCard img.islArt')]; return im.length && im.every(i => i.complete && i.naturalWidth > 0); }, null, { timeout: 15000 }).catch(() => {});
      if (DATA_ON) await page.waitForFunction(() => document.querySelectorAll('.islPill:not(.na)').length > 0, null, { timeout: +(process.env.DATA_WAIT || 90000) }).catch(() => {});
      await waitIcons('.islWrap', 6);
      await page.evaluate(() => scrollTo(0, 0)); await settle(300);
      const priced = await page.evaluate(() => document.querySelectorAll('.islPill:not(.na)').length);
      await snap(G, name, { map: sectionMap({ islCard: '.islCard', islArt: '.islCard img.islArt', islPill: '.islPill', islBest: '.islBest', islName: '.islNm' }), include: ['.islWrap'], icons: true, click, prev, step: 'islands: city cards with art', stale: priced ? '' : 'no seed/animal prices (no data): city cards show "no prices"' });
    } else if (s === 'roads') {
      await page.waitForFunction(() => S.roads && (S.roads.loaded || S.roads.err) && !S.roads.loading, null, { timeout: NET.kill ? 60000 : 8000 }).catch(() => {});
      await waitIcons('#tableWrap', 6, 8000);
      await page.evaluate(() => scrollTo(0, 0)); await settle(300);
      const ok = await page.evaluate(() => !!(S.roads && S.roads.loaded && !S.roads.err));
      await snap(G, name, { map: sectionMap({ roads: '#tableWrap .panel', roadsRow: ['#tableWrap tbody tr', 10] }), include: ['#tableWrap .panel'], icons: true, click, prev, step: 'roads to Caerleon', stale: ok ? '' : 'killboard (gameinfo-ams.albiononline.com) unreachable' });
    } else if (s === 'calc') {
      await page.waitForSelector('#calcQ', { timeout: 10000 }).catch(() => {});
      await page.evaluate(() => scrollTo(0, 0)); await settle(200);
      await snap(G, 'mont_calc_search', { map: sectionMap({ q: '#calcQ' }), click, prev, step: 'calculator search' });
      prev = 'mont_calc_search';
      const c1 = await act(page.locator('#calcQ'), '#calcQ');
      await page.keyboard.type('mas bag', { delay: 90 });
      await settle(400);
      const pick = await page.evaluate(() => { const r = [...document.querySelectorAll('tr[data-pick]')]; const x = r.find(tr => /^T\d_BAG$/.test(tr.dataset.pick)) || r[0]; return x ? x.dataset.pick : null; });
      if (!pick) { pend(G, 'mont_calc', 'no calculator suggestion'); continue; }
      const sel = `tr[data-pick="${pick}"]`;
      const c2 = await act(page.locator(sel).first(), sel);
      await settle(500); await waitIcons('#tableWrap', 6);
      await page.evaluate(() => scrollTo(0, 0)); await settle(200);
      const priced = await page.evaluate(() => { try { const T = calcTotals(); return !!(T && T.px != null && T.profit != null); } catch (e) { return false; } });
      await snap(G, name, { map: sectionMap({ calc: '#tableWrap > .panel', calcOut: '#calcOut', calcInputs: '#tableWrap .panel input', calcSelects: '#tableWrap .panel select' }), include: ['#tableWrap > .panel'], icons: true, click: c2, prev, step: `calculator with ${pick}`, extra: { itemId: pick, typed: 'mas bag', searchClick: c1 }, stale: priced ? '' : 'calculator without market prices (no data)' });
    }
    prev = name;
  }
  saveManifest();
}

saveManifest();
await browser.close();
