// Production renderer for the film.
//
//   node tools/render.mjs --fmt v|s|h --fps 30|60 --start 0 --end 120 --workers 2 \
//        --audio assets/audio/music/music_mix.wav|none --out out/film_v.mp4
//
// Optional: --chunk-sec 3 (frames are split into contiguous chunks of this length, handed out to the
//             workers from a queue; one ffmpeg per chunk; chunks are concatenated losslessly)
//           --chunks M (exact number of contiguous chunks instead, e.g. --chunks <workers>)
//           --capture bf|cdp (default bf = HeadlessExperimental.beginFrame, deterministic)
//           --image jpeg|png (capture format, default jpeg)  --quality 95 (JPEG quality)
//             --crf 14   --preset medium
//           --x264-threads K (per chunk encoder, default auto)     --work <dir> (chunk dir)
//           --keep (keep chunk files)   --fresh (ignore finished chunks from an earlier run)
//           --url <film url> (default http://localhost:8800/film/index.html?w=W&h=H)
//
// Frame k (0-based) shows t = (round(start*fps) + k) / fps.  The video has exactly
// round((end-start)*fps) frames; the audio input is cut with -ss start -t (end-start).
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { openFilm, FMTS, imageSize } from './film_browser.mjs';

// ---------- args ----------
const argv = process.argv.slice(2);
const A = {};
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (!k.startsWith('--')) throw new Error('bad arg ' + k);
  const key = k.slice(2);
  if (['keep', 'fresh'].includes(key)) A[key] = true;
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
const x264threads = A['x264-threads'] || null;
const f0 = Math.round(start * fps);
const N = Math.round((end - start) * fps);
const dur = N / fps;
if (N <= 0) throw new Error('empty range');
if (audio && !fs.existsSync(audio)) throw new Error('audio not found: ' + audio);
const nChunks = Math.min(N, A.chunks ? Math.max(1, +A.chunks) : Math.max(workers, Math.ceil(N / (fps * +(A['chunk-sec'] || 3)))));
const work = path.resolve(A.work || path.join(path.dirname(out), '.render_' + path.basename(out, '.mp4')));
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(path.dirname(out), { recursive: true });
const sig = JSON.stringify({ fmt, fps, start, end, f0, N, nChunks, capture, image, quality, crf, preset, x264threads, url: A.url || null });
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// contiguous chunks
const chunks = [];
for (let c = 0; c < nChunks; c++) {
  const a = Math.floor(N * c / nChunks), b = Math.floor(N * (c + 1) / nChunks);
  chunks.push({ c, a, b, file: path.join(work, `chunk_${String(c).padStart(3, '0')}.mp4`), meta: path.join(work, `chunk_${String(c).padStart(3, '0')}.json`) });
}
const tOf = k => (f0 + k) / fps;

function ffprobeFrames(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries',
    'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_packets,duration,pix_fmt,color_space,color_range:format=duration,bit_rate', '-of', 'json', file]).toString());
  return { ...j.streams[0], format: j.format };
}

// kill every chrome / ffmpeg child if we die (no orphaned browsers eating the shared CPUs)
const children = new Set();
const killAll = () => { for (const c of children) { try { c.kill('SIGKILL'); } catch {} } };
process.on('exit', killAll);
for (const sgn of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sgn, () => { killAll(); process.exit(130); });

// ---------- encoder for one chunk ----------
function startEncoder(file) {
  // Chrome's JPEG is full-range BT.601 YCbCr; go through RGB to tagged BT.709 limited-range 4:2:0.
  const vf = (image === 'png' ? '' : 'scale=in_range=pc:in_color_matrix=bt601:flags=accurate_rnd+full_chroma_int+full_chroma_inp,format=gbrp,') +
    'scale=out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p';
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', image === 'png' ? 'png' : 'mjpeg', '-i', '-',
    '-vf', vf, '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-g', String(fps * 2), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    ...(x264threads ? ['-threads', String(x264threads)] : []), '-an', file];
  const p = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  children.add(p); p.on('exit', () => children.delete(p));
  let err = '';
  p.stderr.on('data', d => { err = (err + d).slice(-4000); });
  const done = new Promise((res, rej) => p.on('exit', code => code === 0 ? res() : rej(new Error('ffmpeg exit ' + code + ': ' + err))));
  done.catch(() => {});
  p.stdin.on('error', () => {});
  return {
    write: buf => new Promise((res, rej) => {
      if (p.exitCode != null) return rej(new Error('ffmpeg died: ' + err));
      if (p.stdin.write(buf)) res(); else p.stdin.once('drain', res);
    }),
    end: async () => { p.stdin.end(); await done; },
    kill: () => { try { p.kill('SIGKILL'); } catch {} },
  };
}

// ---------- workers ----------
const stats = { done: 0, frames: 0 };
let next = 0;
const todo = [];
for (const ch of chunks) {
  let ok = false;
  if (!A.fresh && fs.existsSync(ch.meta) && fs.existsSync(ch.file)) {
    try { const m = JSON.parse(fs.readFileSync(ch.meta, 'utf8')); ok = m.sig === sig && m.frames === ch.b - ch.a; } catch {}
  }
  if (ok) stats.done += ch.b - ch.a; else todo.push(ch);
}
if (todo.length < chunks.length) log(`resuming: ${chunks.length - todo.length}/${chunks.length} chunks already rendered`);
log(`render ${fmt} ${W}x${H} @${fps}fps  t=${start}..${end}  ${N} frames  ${nChunks} chunks  ${workers} workers  capture=${capture} q${quality}  x264 crf${crf} ${preset}`);

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
      const buf = await g.frame(tOf(k));
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
  const pr = ffprobeFrames(ch.file + '.part.mp4');
  if (+pr.nb_read_packets !== ch.b - ch.a) throw new Error(`chunk ${ch.c}: ${pr.nb_read_packets} frames, expected ${ch.b - ch.a}`);
  fs.renameSync(ch.file + '.part.mp4', ch.file);
  fs.writeFileSync(ch.meta, JSON.stringify({ sig, frames: ch.b - ch.a, a: ch.a, b: ch.b, t0: tOf(ch.a), t1: tOf(ch.b - 1) }));
}

async function worker(wi) {
  let g = null;
  const open = async () => {
    g = await openFilm({ w: W, h: H, capture, format: image, quality, url: A.url ? A.url : undefined, log: m => log(`w${wi}`, m) });
    children.add(g.proc); g.proc.on('exit', () => children.delete(g.proc));
  };
  try {
    while (next < todo.length) {
      const ch = todo[next++];
      for (let attempt = 1; ; attempt++) {
        ch.n = 0;
        try {
          if (!g) await open();
          await renderChunk(g, ch);
          break;
        } catch (e) {
          stats.done -= ch.n; stats.frames -= ch.n; ch.n = 0;
          log(`w${wi} chunk ${ch.c} failed (attempt ${attempt}): ${e.message.slice(0, 400)}`);
          if (g) { await g.close(); g = null; }
          if (attempt >= 3) throw e;
        }
      }
    }
  } finally { if (g) await g.close(); }
}

await Promise.all(Array.from({ length: Math.min(workers, todo.length) }, (_, i) => worker(i)));
const renderSec = (Date.now() - T0) / 1000;
progress(true);
log(`frames done in ${renderSec.toFixed(1)} s  (${stats.frames ? (renderSec * 1000 / stats.frames).toFixed(1) : '-'} ms/frame wall)`);

// ---------- concat (lossless) + audio ----------
const list = path.join(work, 'concat.txt');
fs.writeFileSync(list, chunks.map(ch => `file '${ch.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
const tmpOut = out.replace(/\.mp4$/, '') + '.part.mp4';
const muxArgs = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list];
if (audio) muxArgs.push('-ss', String(start), '-t', String(dur), '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000');
else muxArgs.push('-map', '0:v:0');
muxArgs.push('-c:v', 'copy', '-movflags', '+faststart', '-metadata', `comment=Albion Journal film ${fmt} t=${start}-${end} ${fps}fps`, tmpOut);
execFileSync('ffmpeg', muxArgs, { stdio: 'inherit' });
fs.renameSync(tmpOut, out);

// ---------- checks ----------
const pr = ffprobeFrames(out);
let aDur = null;
if (audio) {
  const ja = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,duration,bit_rate,sample_rate,channels', '-of', 'json', out]).toString());
  aDur = ja.streams[0];
}
const okFrames = +pr.nb_read_packets === N;
const okDur = Math.abs(+pr.duration - dur) < 0.5 / fps;
log(`OUTPUT ${out}`);
log(`  video: ${pr.codec_name} ${pr.width}x${pr.height} ${pr.pix_fmt} ${pr.color_space}/${pr.color_range} r=${pr.r_frame_rate} frames=${pr.nb_read_packets} (expected ${N}) ${okFrames ? 'OK' : 'MISMATCH'}  duration=${pr.duration} s (expected ${dur.toFixed(4)}) ${okDur ? 'OK' : 'MISMATCH'}`);
if (aDur) log(`  audio: ${aDur.codec_name} ${aDur.sample_rate} Hz ${aDur.channels} ch ${Math.round(aDur.bit_rate / 1000)} kb/s duration=${aDur.duration} s`);
log(`  container duration ${pr.format.duration} s, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${(pr.format.bit_rate / 1e6).toFixed(1)} Mb/s`);
if (!A.keep && okFrames) fs.rmSync(work, { recursive: true, force: true });
if (!okFrames || !okDur) { log('FRAME/DURATION CHECK FAILED'); process.exit(2); }
