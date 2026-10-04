// Shared frame grabber for the film: a raw-CDP driven chrome-headless-shell page.
//
// capture 'bf'  (default): HeadlessExperimental.beginFrame in --deterministic-mode. The browser
//                produces NO frame on its own; each beginFrame runs main-frame commit -> raster ->
//                draw synchronously (--run-all-compositor-stages-before-draw) and returns the
//                screenshot of exactly that frame, so a capture can never be stale.
// capture 'cdp': Page.captureScreenshot on a normal page (fallback / cross-check).
//
//   const g = await openFilm({ w, h, capture: 'bf', quality: 95 });
//   const jpegBuf = await g.frame(t);      // FX.renderFrame(t) + capture
//   await g.close();
//
// Failure policy (strict unless lenient: true):
//   - navigation error / server down                -> throws at once (message has the URL)
//   - page script exception, console.error/warn     -> FilmError (fatal: deterministic, retrying is useless)
//     (the film itself warns 'img failed', 'missing piece', 'missing state')
//   - <img> not decoded, @font-face in error state  -> FilmError
//   - any CDP call slower than cdpTimeout, frame() slower than frameTimeout, chrome exit
//                                                   -> plain Error (transient: caller may reopen + retry)
// Every spawned browser (its whole process group) and its /tmp profile dir is registered at spawn time
// and removed by killAllBrowsers(), which also runs on process 'exit'.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const FMTS = { v: [1080, 1920], s: [1080, 1080], h: [1920, 1080] };

export class FilmError extends Error {
  constructor(msg) { super(msg); this.fatal = true; }
}

// ---------- browser registry (no orphans, no leaked profile dirs) ----------
const live = new Map();   // proc -> user-data-dir
function killProc(proc) {
  try { process.kill(-proc.pid, 'SIGKILL'); } catch {}   // whole group (renderer, gpu, zygote...)
  try { proc.kill('SIGKILL'); } catch {}
}
function rmDir(d) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch {} }
export function killAllBrowsers() {
  for (const [proc, ud] of live) { killProc(proc); rmDir(ud); }
  live.clear();
}
process.on('exit', killAllBrowsers);

function findShell() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (process.env.FILM_CHROME) return process.env.FILM_CHROME;
  const dirs = fs.readdirSync(root).filter(d => d.startsWith('chromium_headless_shell-')).sort();
  for (const d of dirs.reverse()) {
    for (const sub of ['chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
      const p = path.join(root, d, sub);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('chrome-headless-shell not found under ' + root);
}

const withTimeout = (p, ms, what) => {
  let to;
  return Promise.race([p, new Promise((_, rej) => { to = setTimeout(() => rej(new Error(`timeout after ${ms / 1000} s: ${what}`)), ms); })])
    .finally(() => clearTimeout(to));
};

export async function openFilm({ w, h, capture = 'bf', quality = 95, format = 'jpeg', url, log = () => {}, lenient = false,
  readyTimeout = 60000, cdpTimeout = 60000, frameTimeout = 60000 }) {
  const shell = findShell();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'film-chrome-'));
  const common = ['--remote-debugging-port=0', `--user-data-dir=${ud}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--mute-audio', '--no-sandbox', '--disable-web-security', '--allow-file-access-from-files',
    '--force-color-profile=srgb', '--disable-field-trial-config', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-extensions', '--disable-component-update', '--disable-breakpad', '--disable-features=PaintHolding,Translate,MediaRouter',
    '--run-all-compositor-stages-before-draw', '--disable-checker-imaging', '--disable-image-animation-resync',
    '--disable-threaded-animation', '--disable-threaded-scrolling', '--disable-new-content-rendering-timeout',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--window-size=${w},${h}`, ...(process.env.FILM_CHROME_ARGS || '').split(' ').filter(Boolean)];
  const bfArgs = capture === 'bf' ? ['--deterministic-mode', '--enable-begin-frame-control'] : [];
  // detached = own process group, so killProc() takes the renderer/gpu children down too
  const proc = spawn(shell, [...common, ...bfArgs, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  live.set(proc, ud);
  proc.on('exit', () => { if (live.has(proc)) { live.delete(proc); rmDir(ud); } });
  const close = async () => {
    killProc(proc);
    live.delete(proc);
    await new Promise(r => setTimeout(r, 100));
    rmDir(ud);
  };
  try {
    return await connect(proc, close, { w, h, capture, quality, format, url, log, lenient, readyTimeout, cdpTimeout, frameTimeout });
  } catch (e) {
    await close();
    throw e;
  }
}

async function connect(proc, close, { w, h, capture, quality, format, url, log, lenient, readyTimeout, cdpTimeout, frameTimeout }) {
  let errTail = '', exited = null;
  proc.on('exit', c => { exited = 'chrome exited ' + c; });
  const wsUrl = await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('chrome did not start in 30 s: ' + errTail)), 30000);
    proc.stderr.on('data', d => { errTail = (errTail + d).slice(-4000); const m = errTail.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(to); res(m[1]); } });
    proc.on('exit', c => { clearTimeout(to); rej(new Error('chrome exited ' + c + ': ' + errTail)); });
  });
  const ws = new WebSocket(wsUrl);
  await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP websocket error')); }), 15000, 'CDP connect');
  let id = 0; const pend = new Map(); const handlers = [];
  const failAll = why => { for (const p of pend.values()) { clearTimeout(p.to); p.rej(new Error(why)); } pend.clear(); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); clearTimeout(p.to); m.error ? p.rej(new Error(p.method + ': ' + JSON.stringify(m.error))) : p.res(m.result); }
    else for (const f of handlers) f(m);
  };
  ws.onclose = () => failAll('CDP socket closed');
  proc.on('exit', c => failAll('chrome exited ' + c));
  // every CDP call has a deadline: a stuck renderer / beginFrame becomes an error instead of a hang
  const send = (method, params = {}, sessionId, ms = cdpTimeout) => new Promise((res, rej) => {
    if (exited) return rej(new Error(exited));
    if (ws.readyState !== 1) return rej(new Error('CDP socket not open'));
    const i = ++id;
    const to = setTimeout(() => { if (pend.delete(i)) rej(new Error(`CDP ${method} timed out after ${ms / 1000} s`)); }, ms);
    pend.set(i, { res, rej, method, to });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', width: w, height: h, browserContextId, enableBeginFrameControl: capture === 'bf' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p, ms) => send(m, p, sessionId, ms);
  let crashed = false;
  const errors = [];     // uncaught exceptions
  const warnings = [];   // console.error / console.warn from the film
  handlers.push(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      const s = String((d.exception && d.exception.description) || d.text) + (d.url ? ` (${d.url.replace(/^.*\//, '')}:${d.lineNumber + 1})` : '');
      errors.push(s); log('pageerror: ' + s.slice(0, 300));
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type)) {
      const s = m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' ');
      warnings.push(s); log('console ' + s.slice(0, 300));
    }
    if (m.method === 'Inspector.targetCrashed') { crashed = true; log('renderer crashed'); }   // transient (OOM...), not a film bug
  });
  await S('Runtime.enable');
  await S('Page.enable');
  await S('Inspector.enable').catch(() => {});
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await S('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 1 } });

  const evaluate = async (expression, ms) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, ms);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new FilmError('evaluate failed: ' + String((d.exception && d.exception.description) || d.text).slice(0, 500));
    }
    return r.result.value;
  };
  let ticks = 0;
  const shot = { format, quality: format === 'png' ? undefined : quality, optimizeForSpeed: true };
  const beginFrame = (withShot) => { ticks += 1000 / 60; return S('HeadlessExperimental.beginFrame', { frameTimeTicks: ticks, interval: 1000 / 60, noDisplayUpdates: false, ...(withShot ? { screenshot: shot } : {}) }); };
  const problems = () => [...errors.map(e => 'exception: ' + e), ...warnings];

  const filmUrl = url || `http://localhost:8800/film/index.html?w=${w}&h=${h}`;
  const nav = await S('Page.navigate', { url: filmUrl });
  if (nav.errorText) throw new Error(`cannot load ${filmUrl}: ${nav.errorText} (is the film server running?)`);
  const t0 = Date.now();
  // with begin-frame control nothing draws unless we ask, so pump frames while the page loads
  while (!(await evaluate('window.READY === true', 10000).catch(e => { if (exited) throw new Error(exited); return false; }))) {
    if (!lenient && errors.length) throw new FilmError(`film script error while loading ${filmUrl}:\n  ` + errors.join('\n  '));
    if (capture === 'bf') await beginFrame(false).catch(() => {});
    await new Promise(r => setTimeout(r, 40));
    if (Date.now() - t0 > readyTimeout) throw new Error(`film not READY after ${readyTimeout / 1000} s at ${filmUrl}` + (errors.length ? ': ' + errors.join(' | ') : ''));
  }
  const info = await evaluate(`({W: FX.W, H: FX.H, fmt: FX.FMT, profile: FX.PROFILE,
    nImgs: document.images.length,
    badImgs: [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.src.replace(location.origin, '')).slice(0, 20),
    badFonts: [...document.fonts].filter(f => f.status === 'error').map(f => f.family + ' ' + f.weight),
    loadMs: Math.round(performance.now())})`);
  info.readyMs = Date.now() - t0;
  if (info.W !== w || info.H !== h) throw new FilmError('film stage size mismatch ' + JSON.stringify(info));
  const loadProblems = [...problems(),
    ...info.badImgs.map(s => 'image not loaded: ' + s),
    ...info.badFonts.map(s => 'font failed: ' + s)];
  if (loadProblems.length) {
    const msg = `${loadProblems.length} problem(s) loading ${filmUrl}:\n  ` + loadProblems.slice(0, 30).join('\n  ');
    if (!lenient) throw new FilmError(msg);
    log('WARNING (lenient) ' + msg);
  }
  if (capture === 'bf') { await beginFrame(false); await beginFrame(false); }

  let last = null;
  let seen = errors.length + warnings.length;
  async function frame1(t) {
    // String(t) round-trips doubles exactly, so the page sees the very same t
    if (crashed) throw new Error('renderer crashed');
    await evaluate(`FX.renderFrame(${String(t)}),0`);
    if (errors.length + warnings.length > seen) {
      const msg = `film error while rendering t=${t}:\n  ` + problems().slice(seen).join('\n  ');
      seen = errors.length + warnings.length;
      if (!lenient) throw new FilmError(msg);
      log('WARNING (lenient) ' + msg);
    }
    let buf;
    if (capture === 'bf') {
      const r = await beginFrame(true);
      if (r.screenshotData) buf = Buffer.from(r.screenshotData, 'base64');
      else if (last && !r.hasDamage) buf = last;               // nothing changed on screen: identical frame
      else { const r2 = await beginFrame(true); if (!r2.screenshotData) throw new Error('beginFrame returned no screenshot at t=' + t); buf = Buffer.from(r2.screenshotData, 'base64'); }
    } else {
      const r = await S('Page.captureScreenshot', { ...shot, captureBeyondViewport: false, fromSurface: true });
      buf = Buffer.from(r.data, 'base64');
    }
    last = buf;
    return buf;
  }
  // watchdog over the whole frame (renderFrame + capture)
  const frame = t => withTimeout(frame1(t), frameTimeout, `frame t=${t}`);
  const closeAll = async () => { try { ws.close(); } catch {} await close(); };
  return { frame, close: closeAll, evaluate, errors, warnings, info, proc };
}

// width/height from a JPEG (SOFn) or PNG header
export function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) return null;
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}
