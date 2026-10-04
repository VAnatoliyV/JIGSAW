// Production renderer for the film.
//
//   node tools/render.mjs --fmt v|s|h --fps 30|60 --start 0 --end 120 --workers 2 \
//        --audio assets/audio/final_mix.wav|none --out out/film_v.mp4
//
// The film is rendered from a FROZEN SNAPSHOT of film/ + assets/ (minus audio), served by a private
// static server inside this process, so edits other agents make while a render runs cannot leak in.
//           --snapshot <dir>  share one snapshot between renders (render_all.sh: all 3 formats from the
//                             same film version). Created if missing, reused as-is if complete.
//                             Default: <work>/snapshot, re-taken whenever the live tree differs.
//           --root <dir>      project tree to snapshot (default: the repo containing tools/)
//           --url <film url>  render a live URL instead (no snapshot; for tests)
// Optional: --chunk-sec 3 (frames are split into contiguous chunks of this length, handed out to the
//             workers from a queue; one ffmpeg per chunk; chunks are concatenated losslessly)
//           --chunks M (exact number of contiguous chunks instead)
//           --capture bf|cdp (default bf = HeadlessExperimental.beginFrame, deterministic)
//           --image jpeg|png (capture format, default jpeg)  --quality 95 (JPEG quality)
//           --crf 14   --preset medium   --x264-threads 2 (per chunk encoder)   --work <dir> (chunk dir)
//           --keep (keep chunk files)   --fresh (ignore finished chunks from an earlier run)
//           --lenient (page errors / missing images / short audio only warn instead of failing)
//           --frame-timeout 60  --ready-timeout 60 (seconds; a stuck frame/page load becomes a retry)
//           --no-blank-check (skip the final scan for >= 3 s stretches of empty background)
//
// Finished chunks are reused on a rerun only if their signature matches: render parameters AND the
// sha1 of every film/asset file served (so a scene edit always invalidates them).
//
// Frame k (0-based) shows t = (round(start*fps) + k) / fps.  The video has exactly
// round((end-start)*fps) frames; the audio input is cut with -ss start -t (end-start).
// Exit codes: 0 ok, 1 render failed (film error, repeated worker failure), 2 output check failed.
import { spawn, spawnSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openFilm, FMTS, imageSize, killAllBrowsers } from './film_browser.mjs';
import { ensureSnapshot, serveDir, treeHash, gitDescribe } from './snapshot.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- args ----------
const argv = process.argv.slice(2);
const A = {};
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (!k.startsWith('--')) throw new Error('bad arg ' + k);
  const key = k.slice(2);
  if (['keep', 'fresh', 'lenient', 'no-blank-check'].includes(key)) A[key] = true;
  else A[key] = argv[++i];
}
const fmt = A.fmt || 'v';
if (!FMTS[fmt]) throw new Error('--fmt must be v|s|h');
const [W, H] = FMTS[fmt];
const fps = +(A.fps || 30);
const start = +(A.start || 0), end = +(A.end ?? 120);
const workers = Math.max(1, +(A.workers || 2));
const audio = A.audio && A.audio !== 'none' ? path.resolve(A.audio) : null;
const out = path.resolve(A.out || `out/film_${fmt}_${fps}.mp4`);
const capture = A.capture || 'bf';
const quality = +(A.quality || 95);
const image = A.image || 'jpeg';   // capture image format: jpeg (fast) | png (lossless, ~2x slower)
const crf = +(A.crf ?? 14);
const preset = A.preset || 'medium';
const x264threads = A['x264-threads'] === 'auto' ? null : (A['x264-threads'] || '2');
const lenient = !!A.lenient;
const root = path.resolve(A.root || REPO);
const frameTimeout = 1000 * +(A['frame-timeout'] || 60), readyTimeout = 1000 * +(A['ready-timeout'] || 60);
const f0 = Math.round(start * fps);
const N = Math.round((end - start) * fps);
const dur = N / fps;
if (N <= 0) throw new Error('empty range');
const nChunks = Math.min(N, A.chunks ? Math.max(1, +A.chunks) : Math.max(workers, Math.ceil(N / (fps * +(A['chunk-sec'] || 3)))));
const work = path.resolve(A.work || path.join(path.dirname(out), '.render_' + path.basename(out, '.mp4')));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const AAC_FRAME = 1024 / 48000;

// ---------- cleanup: no orphaned chrome / ffmpeg, no leaked profile dirs ----------
const children = new Set();
let server = null;
const killAll = () => { for (const c of children) { try { c.kill('SIGKILL'); } catch {} } children.clear(); killAllBrowsers(); };
process.on('exit', killAll);
for (const sgn of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sgn, () => { log(`${sgn}: stopping`); killAll(); process.exit(130); });

function die(msg, code = 1) { log('FAILED: ' + msg); killAll(); process.exit(code); }

function ffprobeFrames(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries',
    'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_packets,duration,pix_fmt,color_space,color_range,chroma_location:format=duration,bit_rate', '-of', 'json', file]).toString());
  return { ...j.streams[0], format: j.format };
}
function ffprobeAudio(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,duration,bit_rate,sample_rate,channels', '-of', 'json', file]).toString());
  return j.streams[0] || null;
}

// ---------- preflight (fail before spending 15 minutes) ----------
if (audio) {
  if (!fs.existsSync(audio)) die('audio not found: ' + audio);
  const a = ffprobeAudio(audio);
  if (!a) die('no audio stream in ' + audio);
  if (+a.duration < end - 1e-3) {
    const msg = `audio ${audio} is ${(+a.duration).toFixed(3)} s long, the render needs ${end} s (would end with a truncated soundtrack)`;
    if (lenient) log('WARNING (lenient) ' + msg); else die(msg);
  }
}

let filmUrl, filmHash, filmGit;
if (A.url) {
  filmUrl = A.url;
  try {
    const r = await fetch(filmUrl, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) die(`film URL ${filmUrl} answered HTTP ${r.status}`);
  } catch (e) { die(`film URL ${filmUrl} is not reachable (${e.cause?.code || e.cause?.message || e.message}); is the server running?`); }
  const th = treeHash(root);
  filmHash = 'url:' + th.hash; filmGit = gitDescribe(root);
  log(`rendering live URL ${filmUrl} (no snapshot; resume keyed on the local tree ${th.hash.slice(0, 12)})`);
} else {
  const snap = ensureSnapshot({ root, dir: path.resolve(A.snapshot || path.join(work, 'snapshot')), reuse: !!A.snapshot, log });
  server = await serveDir(snap.dir);
  filmUrl = `${server.url}/film/index.html?w=${W}&h=${H}`;
  filmHash = snap.hash; filmGit = snap.git;
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.mkdirSync(work, { recursive: true });
const sig = JSON.stringify({ fmt, fps, start, end, f0, N, nChunks, capture, image, quality, crf, preset, x264threads, film: filmHash, v: 2 });

// contiguous chunks
const chunks = [];
for (let c = 0; c < nChunks; c++) {
  const a = Math.floor(N * c / nChunks), b = Math.floor(N * (c + 1) / nChunks);
  chunks.push({ c, a, b, file: path.join(work, `chunk_${String(c).padStart(3, '0')}.mp4`), meta: path.join(work, `chunk_${String(c).padStart(3, '0')}.json`) });
}
const tOf = k => (f0 + k) / fps;

// ---------- encoder for one chunk ----------
function startEncoder(file) {
  // Chrome's JPEG is full-range BT.601 YCbCr; go through RGB to tagged BT.709 limited-range 4:2:0
  // with left (MPEG-2/H.264 default) chroma siting, tagged as such.
  const vf = (image === 'png' ? '' : 'scale=in_range=pc:in_color_matrix=bt601:flags=accurate_rnd+full_chroma_int+full_chroma_inp,format=gbrp,') +
    'scale=out_range=tv:out_color_matrix=bt709:out_h_chr_pos=0:out_v_chr_pos=128:flags=accurate_rnd+full_chroma_int,format=yuv420p';
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', image === 'png' ? 'png' : 'mjpeg', '-i', '-',
    '-vf', vf, '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-g', String(fps * 2), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-chroma_sample_location', 'left',
    ...(x264threads ? ['-threads', String(x264threads)] : []), '-an', file];
  const p = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  children.add(p);
  let err = '', dead = null;
  p.stderr.on('data', d => { err = (err + d).slice(-4000); });
  const done = new Promise((res, rej) => p.on('exit', (code, sgn) => {
    children.delete(p);
    dead = new Error(`ffmpeg exited (${sgn || code})${err ? ': ' + err.trim() : ''}`);
    code === 0 ? res() : rej(dead);
  }));
  done.catch(() => {});
  let stdinErr = null;
  p.stdin.on('error', e => { stdinErr = e; });
  return {
    // rejects as soon as the encoder dies or its pipe breaks -- never waits forever for 'drain'
    write: buf => new Promise((res, rej) => {
      if (dead || p.exitCode != null || p.signalCode != null) return rej(dead || new Error('ffmpeg died: ' + err));
      if (stdinErr) return rej(new Error('ffmpeg stdin: ' + stdinErr.message));
      const cleanup = () => { p.stdin.off('drain', onDrain); p.stdin.off('error', onErr); p.off('exit', onExit); };
      const onDrain = () => { cleanup(); res(); };
      const onErr = e => { cleanup(); rej(new Error('ffmpeg stdin: ' + e.message)); };
      const onExit = () => { cleanup(); setImmediate(() => rej(dead || new Error('ffmpeg exited'))); };
      if (p.stdin.write(buf)) return res();
      p.stdin.once('drain', onDrain); p.stdin.once('error', onErr); p.once('exit', onExit);
    }),
    end: async () => { p.stdin.end(); await done; },
    kill: () => { try { p.kill('SIGKILL'); } catch {} },
  };
}

// ---------- workers ----------
const stats = { done: 0, frames: 0 };
let next = 0, abort = null;
const todo = [];
for (const ch of chunks) {
  let ok = false;
  if (!A.fresh && fs.existsSync(ch.meta) && fs.existsSync(ch.file)) {
    try { const m = JSON.parse(fs.readFileSync(ch.meta, 'utf8')); ok = m.sig === sig && m.frames === ch.b - ch.a; } catch {}
  }
  if (ok) stats.done += ch.b - ch.a; else todo.push(ch);
}
if (todo.length < chunks.length) log(`resuming: ${chunks.length - todo.length}/${chunks.length} chunks already rendered from the same film ${filmHash.slice(0, 16)} and settings`);
log(`render ${fmt} ${W}x${H} @${fps}fps  t=${start}..${end}  ${N} frames  ${nChunks} chunks  ${workers} workers  capture=${capture} ${image}${image === 'jpeg' ? ' q' + quality : ''}  x264 crf${crf} ${preset} threads=${x264threads || 'auto'}${lenient ? '  LENIENT' : ''}`);

const T0 = Date.now();
let lastLog = 0;
function progress(force) {
  const now = Date.now();
  if (!force && now - lastLog < 10000) return;
  lastLog = now;
  const el = (now - T0) / 1000, rate = stats.frames / Math.max(el, 1e-3);
  const left = N - stats.done;
  log(`${stats.done}/${N} frames (${(100 * stats.done / N).toFixed(1)}%)  ${rate.toFixed(2)} f/s  ${(1000 / Math.max(rate, 1e-6)).toFixed(0)} ms/f wall  ETA ${rate > 0 ? Math.round(left / rate) : '?'} s`);
}

async function renderChunk(g, ch) {
  const enc = startEncoder(ch.file + '.part.mp4');
  try {
    for (let k = ch.a; k < ch.b; k++) {
      if (abort) throw abort;
      const buf = await g.frame(tOf(k));          // has its own watchdog (frameTimeout) + per-CDP-call deadlines
      if (k === ch.a) {
        const sz = imageSize(buf);
        if (!sz || sz[0] !== W || sz[1] !== H) throw new Error(`captured frame is ${sz} not ${W}x${H}`);
      }
      await enc.write(buf);
      stats.done++; stats.frames++; ch.n = (ch.n || 0) + 1;
      progress();
    }
    await enc.end();
  } catch (e) { enc.kill(); throw e; }
  if (server && server.misses.length) throw Object.assign(new Error('film requested missing files: ' + [...new Set(server.misses)].join(', ')), { fatal: !lenient });
  const pr = ffprobeFrames(ch.file + '.part.mp4');
  if (+pr.nb_read_packets !== ch.b - ch.a) throw new Error(`chunk ${ch.c}: ${pr.nb_read_packets} frames, expected ${ch.b - ch.a}`);
  fs.renameSync(ch.file + '.part.mp4', ch.file);
  fs.writeFileSync(ch.meta, JSON.stringify({ sig, frames: ch.b - ch.a, a: ch.a, b: ch.b, t0: tOf(ch.a), t1: tOf(ch.b - 1) }));
}

async function worker(wi) {
  let g = null;
  const open = async () => {
    g = await openFilm({ w: W, h: H, capture, format: image, quality, url: filmUrl, lenient, frameTimeout, readyTimeout, cdpTimeout: frameTimeout, log: m => log(`w${wi}`, m) });
    log(`w${wi} film ready in ${g.info.readyMs} ms (${g.info.nImgs} images)`);
    if (server && server.misses.length && !lenient) throw Object.assign(new Error('film requested missing files: ' + [...new Set(server.misses)].join(', ')), { fatal: true });
  };
  try {
    while (next < todo.length && !abort) {
      const ch = todo[next++];
      for (let attempt = 1; ; attempt++) {
        ch.n = 0;
        try {
          if (!g) await open();
          await renderChunk(g, ch);
          break;
        } catch (e) {
          stats.done -= ch.n; stats.frames -= ch.n; ch.n = 0;
          if (g) { await g.close(); g = null; }
          if (abort) return;
          if (e.fatal) { abort = e; log(`w${wi} chunk ${ch.c}: FATAL film error, stopping all workers`); throw e; }
          log(`w${wi} chunk ${ch.c} failed (attempt ${attempt}/3): ${e.message.slice(0, 600)}`);
          if (attempt >= 3) { abort = e; throw e; }
        }
      }
    }
  } finally { if (g) await g.close(); }
}

const results = await Promise.allSettled(Array.from({ length: Math.min(workers, todo.length) }, (_, i) => worker(i)));
const failed = results.find(r => r.status === 'rejected');
if (failed || abort) {
  const e = abort || failed.reason;
  die((e.fatal ? 'film is broken (fix it or pass --lenient):\n' : 'render failed after 3 attempts:\n') + e.message);
}
const renderSec = (Date.now() - T0) / 1000;
progress(true);
log(`frames done in ${renderSec.toFixed(1)} s  (${stats.frames ? (renderSec * 1000 / stats.frames).toFixed(1) : '-'} ms/frame wall)`);
if (server) { await server.close(); server = null; }

// ---------- concat (lossless) + audio ----------
const list = path.join(work, 'concat.txt');
fs.writeFileSync(list, chunks.map(ch => `file '${ch.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
const tmpOut = out.replace(/\.mp4$/, '') + '.part.mp4';
const muxArgs = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list];
if (audio) muxArgs.push('-ss', String(start), '-t', String(dur), '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000');
else muxArgs.push('-map', '0:v:0');
muxArgs.push('-c:v', 'copy', '-movflags', '+faststart',
  '-metadata', `comment=Albion Journal film ${fmt} t=${start}-${end} ${fps}fps film=${filmHash.slice(0, 16)} git=${filmGit}`,
  '-metadata', `description=film sha1 ${filmHash}`, tmpOut);
try { execFileSync('ffmpeg', muxArgs, { stdio: 'inherit' }); } catch (e) { die('concat/mux failed: ' + e.message); }
fs.renameSync(tmpOut, out);

// ---------- checks ----------
const pr = ffprobeFrames(out);
const problems = [];
const okFrames = +pr.nb_read_packets === N;
const okDur = Math.abs(+pr.duration - dur) < 0.5 / fps;
if (!okFrames) problems.push(`video has ${pr.nb_read_packets} frames, expected ${N}`);
if (!okDur) problems.push(`video duration ${pr.duration} s, expected ${dur}`);
let au = null;
if (audio) {
  au = ffprobeAudio(out);
  if (!au) problems.push('audio stream missing although --audio was given');
  else if (Math.abs(+au.duration - dur) > AAC_FRAME + 1e-6) problems.push(`audio duration ${au.duration} s, expected ${dur.toFixed(4)} s (+-${AAC_FRAME.toFixed(4)})`);
}
log(`OUTPUT ${out}`);
log(`  video: ${pr.codec_name} ${pr.width}x${pr.height} ${pr.pix_fmt} ${pr.color_space}/${pr.color_range} chroma=${pr.chroma_location} r=${pr.r_frame_rate} frames=${pr.nb_read_packets} (expected ${N}) ${okFrames ? 'OK' : 'MISMATCH'}  duration=${pr.duration} s (expected ${dur.toFixed(4)}) ${okDur ? 'OK' : 'MISMATCH'}`);
if (au) log(`  audio: ${au.codec_name} ${au.sample_rate} Hz ${au.channels} ch ${Math.round(au.bit_rate / 1000)} kb/s duration=${au.duration} s ${Math.abs(+au.duration - dur) <= AAC_FRAME + 1e-6 ? 'OK' : 'MISMATCH'}`);
log(`  container duration ${pr.format.duration} s, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${(pr.format.bit_rate / 1e6).toFixed(1)} Mb/s   film ${filmHash.slice(0, 16)} git ${filmGit}`);
// content sanity (warning only): stretches >= 3 s where >= 99.5% of the picture is background-dark,
// e.g. a scene file that is still a placeholder.  ~10 s of decoding per minute of 60 fps video.
if (!A['no-blank-check']) {
  const bd = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-skip_loop_filter', 'all', '-i', out, '-an', '-vf', 'scale=270:-2,blackdetect=d=3:pic_th=0.995:pix_th=0.14', '-f', 'null', '-'], { encoding: 'utf8' });
  const gaps = [...(bd.stderr || '').matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m => [start + +m[1], start + +m[2]]);
  if (gaps.length) log(`  WARNING: near-empty picture (background only) at ${gaps.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)} s`).join(', ')}  -- unfinished scenes?`);
  else log('  content check: no empty stretches >= 3 s');
}
if (problems.length) die('OUTPUT CHECK FAILED: ' + problems.join('; '), 2);
if (!A.keep) fs.rmSync(work, { recursive: true, force: true });
process.exit(0);
