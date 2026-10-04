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
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const FMTS = { v: [1080, 1920], s: [1080, 1080], h: [1920, 1080] };

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

export async function openFilm({ w, h, capture = 'bf', quality = 95, format = 'jpeg', url, log = () => {} }) {
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
  const proc = spawn(shell, [...common, ...bfArgs, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    return await connect(proc, ud, { w, h, capture, quality, format, url, log });
  } catch (e) {
    try { proc.kill('SIGKILL'); } catch {}
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
    throw e;
  }
}

async function connect(proc, ud, { w, h, capture, quality, format, url, log }) {
  let errTail = '';
  const wsUrl = await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('chrome did not start: ' + errTail)), 30000);
    proc.stderr.on('data', d => { errTail = (errTail + d).slice(-4000); const m = errTail.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(to); res(m[1]); } });
    proc.on('exit', c => rej(new Error('chrome exited ' + c + ': ' + errTail)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const handlers = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(p.method + ': ' + JSON.stringify(m.error))) : p.res(m.result); }
    else for (const f of handlers) f(m);
  };
  ws.onclose = () => { for (const p of pend.values()) p.rej(new Error('CDP socket closed')); pend.clear(); };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    if (ws.readyState !== 1) return rej(new Error('CDP socket not open'));
    const i = ++id; pend.set(i, { res, rej, method }); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', width: w, height: h, browserContextId, enableBeginFrameControl: capture === 'bf' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const errors = [];
  handlers.push(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; const s = (d.exception && d.exception.description) || d.text; errors.push(s); log('pageerror: ' + String(s).slice(0, 300)); }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) log('console: ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  });
  await S('Runtime.enable');
  await S('Page.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await S('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 1 } });

  const evaluate = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  let ticks = 0;
  const shot = { format, quality: format === 'png' ? undefined : quality, optimizeForSpeed: true };
  const beginFrame = (withShot) => { ticks += 1000 / 60; return S('HeadlessExperimental.beginFrame', { frameTimeTicks: ticks, interval: 1000 / 60, noDisplayUpdates: false, ...(withShot ? { screenshot: shot } : {}) }); };

  const filmUrl = url || `http://localhost:8800/film/index.html?w=${w}&h=${h}`;
  await S('Page.navigate', { url: filmUrl });
  const t0 = Date.now();
  // with begin-frame control nothing draws unless we ask, so pump frames while the page loads
  while (!(await evaluate('window.READY === true').catch(() => false))) {
    if (capture === 'bf') await beginFrame(false).catch(() => {});
    await new Promise(r => setTimeout(r, 40));
    if (Date.now() - t0 > 120000) throw new Error('film not READY after 120 s: ' + errors.join(' | '));
  }
  const info = await evaluate('({W: FX.W, H: FX.H, fmt: FX.FMT, profile: FX.PROFILE, imgs: [...document.images].filter(i => !i.complete || !i.naturalWidth).length})');
  if (info.W !== w || info.H !== h) throw new Error('film stage size mismatch ' + JSON.stringify(info));
  if (info.imgs) log(`warning: ${info.imgs} images not loaded`);
  if (capture === 'bf') { await beginFrame(false); await beginFrame(false); }

  let last = null;
  async function frame(t) {
    // String(t) round-trips doubles exactly, so the page sees the very same t
    await evaluate(`FX.renderFrame(${String(t)}),0`);
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
  async function close() {
    try { ws.close(); } catch {}
    try { proc.kill('SIGKILL'); } catch {}
    await new Promise(r => setTimeout(r, 100));
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
  }
  proc.on('exit', () => { for (const p of pend.values()) p.rej(new Error('chrome exited')); pend.clear(); });
  return { frame, close, evaluate, errors, info, proc };
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
