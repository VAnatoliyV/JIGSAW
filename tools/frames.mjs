// Render selected film frames to PNG: node tools/frames.mjs <fmt> <out_dir> t1 t2 ...
import { chromium } from 'playwright';
import fs from 'fs';
const FMTS = { v: [1080, 1920], s: [1080, 1080], h: [1920, 1080] };
const [fmt, out, ...ts] = process.argv.slice(2);
const [w, h] = FMTS[fmt];
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--disable-web-security', '--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
p.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log('console:', m.text().slice(0, 300)); });
p.on('pageerror', e => console.log('pageerror:', e.message));
await p.goto(`http://localhost:8800/film/index.html?w=${w}&h=${h}${process.env.FILM_QS ? '&' + process.env.FILM_QS : ''}`);
await p.waitForFunction(() => window.READY === true, null, { timeout: 120000 });
for (const t of ts) {
  const tt = +t;
  const ms = await p.evaluate(tt => { const a = performance.now(); FX.renderFrame(tt); return performance.now() - a; }, tt);
  const a = Date.now();
  await p.screenshot({ path: `${out}/${fmt}_${tt.toFixed(2).padStart(6, '0')}.png` });
  console.log(`t=${tt} render ${ms.toFixed(1)}ms shot ${Date.now() - a}ms`);
}
await b.close();
