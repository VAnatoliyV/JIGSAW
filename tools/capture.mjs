// Captures real Albion Journal UI states with Playwright for the film.
// Usage: node tools/capture.mjs <profile> [group...]   profile: mobile | square | desktop
// Writes PNGs to assets/screens/<profile>/ and merges rects/paths into film/data/manifest.json.
import { open, SITE } from './site.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = '/home/user/JIGSAW';
const PROFILES = {
  mobile:  { width: 430,  height: 932, dpr: 3 },
  square:  { width: 1100, height: 1000, dpr: 2 },
  desktop: { width: 1440, height: 900, dpr: 2 },
};
const profile = process.argv[2] || 'desktop';
const groups = process.argv.slice(3);
const P = PROFILES[profile];
const OUT = path.join(ROOT, 'assets/screens', profile);
fs.mkdirSync(OUT, { recursive: true });
const MAN = path.join(ROOT, 'film/data/manifest.json');
const manifest = fs.existsSync(MAN) ? JSON.parse(fs.readFileSync(MAN, 'utf8')) : {};
manifest[profile] = manifest[profile] || { viewport: P, states: {} };
manifest[profile].viewport = P;
const want = g => !groups.length || groups.includes(g);
const rel = f => path.relative(path.join(ROOT, 'film'), f);

const { browser, page } = await open(P);
const wait = ms => page.waitForTimeout(ms);

async function boot() {
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await wait(1500);
  await page.evaluate(() => { try { setAnim('off'); } catch (e) {} });   // no idle animation in stills; the film animates the logo itself
}
async function iconsOk() {
  return page.evaluate(() => { const i = document.querySelector('#drift img'); return !!(i && i.complete && i.naturalWidth > 0); });
}
async function liveMode() {
  // The live site shows "⚡ seconds" once its live price feed answers (user-confirmed). The feed host is
  // unreachable from this sandbox, so mark the feed as answered and repaint, exactly as the site does.
  await page.evaluate(() => { try { liveOkAt = Date.now(); paintHeroStats(); } catch (e) {} });
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
async function full(name, extra = {}) {
  const f = path.join(OUT, name + '.png');
  await page.screenshot({ path: f, fullPage: !!extra.fullPage });
  const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight, scrollX, scrollY]);
  manifest[profile].states[name] = Object.assign(manifest[profile].states[name] || {}, { img: rel(f), page: size, fullPage: !!extra.fullPage, rects: extra.rects || {} });
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
}

await boot();
const icons = await iconsOk();
console.log('item icons reachable:', icons);

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
}

if (want('sections')) {
  for (const s of ['craft', 'ref', 'flip', 'cityflip', 'ench', 'cons', 'isl', 'calc', 'item', 'roads']) {
    await boot();
    await page.evaluate(s => enterApp(s), s);
    await wait(+(process.env.SECTION_WAIT || 4000));
    await full('sec_' + s, { rects: await rects({ grp: '#grpRow .grp', th: '#tableWrap th', row: '#tableWrap tbody tr', search: '#searchInp', itemQ: '#itemQ' }) });
  }
}

fs.writeFileSync(MAN, JSON.stringify(manifest, null, 1));
fs.writeFileSync(path.join(ROOT, 'film/data/manifest.js'), 'window.MANIFEST=' + JSON.stringify(manifest) + ';');
await browser.close();
