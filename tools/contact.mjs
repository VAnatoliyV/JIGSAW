// Labeled contact sheet of film frames, rendered with the production capture path (one page).
//
//   node tools/contact.mjs --fmt v --times 0.5,1.5,2.5 --out sheet.png [--cols 6] [--cell 300]
//        [--range 0:32:2]  (adds every 2 s from 0 to 32; can be combined with --times)
//        [--frames dir]    (also keep the full-size PNG frames there)
//        [--capture bf|cdp]
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { openFilm, FMTS } from './film_browser.mjs';

const argv = process.argv.slice(2);
const A = {};
for (let i = 0; i < argv.length; i++) A[argv[i].replace(/^--/, '')] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
const fmt = A.fmt || 'v';
if (!FMTS[fmt]) throw new Error('--fmt must be v|s|h');
const [W, H] = FMTS[fmt];
let times = [];
if (A.times) times.push(...String(A.times).split(',').filter(Boolean).map(Number));
if (A.range) { const [a, b, st] = String(A.range).split(':').map(Number); for (let t = a; t <= b + 1e-9; t += st) times.push(+t.toFixed(4)); }
if (!times.length || times.some(t => !isFinite(t))) throw new Error('give --times t1,t2,... and/or --range a:b:step');
times = [...new Set(times)].sort((a, b) => a - b);
const out = path.resolve(A.out || `out/contact_${fmt}.png`);
const cols = +(A.cols || (fmt === 'h' ? 4 : fmt === 's' ? 5 : 6));
const cell = +(A.cell || (fmt === 'h' ? 420 : 300));
const keep = typeof A.frames === 'string' ? path.resolve(A.frames) : null;
const dir = keep || fs.mkdtempSync(path.join(os.tmpdir(), 'contact-'));
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(path.dirname(out), { recursive: true });

const g = await openFilm({ w: W, h: H, capture: A.capture || 'bf', format: 'png', log: m => console.log(m) });
const files = [];
const T0 = Date.now();
try {
  for (const t of times) {
    const buf = await g.frame(t);
    // label = file name (sheet.py prints it above the cell)
    const f = path.join(dir, `${fmt} t=${t.toFixed(2)}s.png`);
    fs.writeFileSync(f, buf);
    files.push(f);
  }
} finally { await g.close(); }
console.log(`${times.length} frames in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
const sheet = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sheet.py');
execFileSync('python3', [sheet, out, String(cols), String(cell), ...files], { stdio: 'inherit' });
if (!keep) fs.rmSync(dir, { recursive: true, force: true });
