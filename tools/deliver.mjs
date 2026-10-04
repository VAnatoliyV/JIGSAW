// Social-upload copy of a master render (the crf 14 master is ~30 Mb/s, ~450 MB per 120 s: above
// Meta's 25 Mb/s API limit and close to X's 512 MB cap).
//
//   node tools/deliver.mjs --in out/albion_journal_9x16_60fps.mp4 --audio assets/audio/final_mix.wav \
//        --start 0 --out out/albion_journal_9x16_60fps_social.mp4
//   [--crf 18] [--maxrate 16M] [--bufsize 32M] [--preset slow] [--threads 4] [--editlist none|keep]
//
// Video: re-encoded from the master, H.264 High@4.2, crf 18 capped at 16 Mb/s (VBV), BT.709 tags,
//        left chroma siting, 2 s GOP, faststart.
// Audio: AAC 320k encoded again from the WAV (not AAC->AAC), cut to the master's range.
// --editlist none (default): no MP4 edit lists (Meta's publishing spec asks for none). The B-frame
//        delay is absorbed by negative CTS offsets, so the first frame still has pts 0; the AAC
//        encoder's 1024 priming samples are compensated by starting the WAV 1024 samples later, so a
//        player that plays the priming (no edit list to skip it) stays in sync.
// --editlist keep: plain remux-style output with edit lists (exact for players that honour them).
// The result is checked: frame count/duration = master, audio duration, A/V offset by cross-correlation.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const argv = process.argv.slice(2);
const A = {};
for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) throw new Error('bad arg ' + argv[i]); A[argv[i].slice(2)] = argv[++i]; }
if (!A.in || !A.out) throw new Error('usage: --in master.mp4 --out social.mp4 [--audio mix.wav --start 0]');
const inp = path.resolve(A.in), out = path.resolve(A.out);
const audio = A.audio && A.audio !== 'none' ? path.resolve(A.audio) : null;
const start = +(A.start || 0);
const editlist = A.editlist || 'none';
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const probe = (file, sel, entries) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', sel, '-count_packets', '-show_entries', entries, '-of', 'json', file]).toString());

const mv = probe(inp, 'v:0', 'stream=r_frame_rate,nb_read_packets,duration,width,height').streams[0];
const [fn, fd] = mv.r_frame_rate.split('/').map(Number);
const fps = fn / fd, N = +mv.nb_read_packets, dur = N / fps;
const hasMasterAudio = !!probe(inp, 'a:0', 'stream=codec_name').streams[0];
const tags = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', inp]).toString()).format.tags || {};
log(`master ${inp}: ${mv.width}x${mv.height} ${N} frames @${fps} = ${dur} s`);

const PRIME = 1024 / 48000;
const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inp];
if (audio) {
  const ss = start + (editlist === 'none' ? PRIME : 0);
  args.push('-ss', String(ss), '-t', String(dur - (editlist === 'none' ? PRIME : 0)), '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000');
} else if (hasMasterAudio) {
  if (editlist === 'none') throw new Error('--editlist none needs --audio <wav> (the master AAC has priming that only an edit list can trim)');
  args.push('-map', '0:v:0', '-map', '0:a:0', '-c:a', 'copy');
} else args.push('-map', '0:v:0');
args.push('-c:v', 'libx264', '-preset', A.preset || 'slow', '-crf', String(A.crf || 18), '-maxrate', A.maxrate || '16M', '-bufsize', A.bufsize || '32M',
  '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-g', String(Math.round(fps * 2)), '-r', mv.r_frame_rate,
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-chroma_sample_location', 'left',
  ...(A.threads ? ['-threads', String(A.threads)] : []),
  '-movflags', editlist === 'none' ? '+faststart+negative_cts_offsets' : '+faststart', ...(editlist === 'none' ? ['-use_editlist', '0'] : []),
  '-metadata', `comment=${(tags.comment || '').trim()} social-copy`, '-metadata', `description=${tags.description || ''}`, out + '.part.mp4');
const T0 = Date.now();
execFileSync('ffmpeg', args, { stdio: 'inherit' });
fs.renameSync(out + '.part.mp4', out);
log(`encoded in ${((Date.now() - T0) / 1000).toFixed(1)} s`);

// does the moov box (not the media data) contain a box type, e.g. 'elst'?
function moovHas(file, type) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size, hdr = Buffer.alloc(16);
  try {
    for (let pos = 0; pos + 8 <= size;) {
      fs.readSync(fd, hdr, 0, 16, pos);
      let len = hdr.readUInt32BE(0); const t = hdr.toString('latin1', 4, 8);
      if (len === 1) len = Number(hdr.readBigUInt64BE(8)); else if (len === 0) len = size - pos;
      if (t === 'moov') { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b.includes(Buffer.from(type)); }
      if (len < 8) break;
      pos += len;
    }
  } finally { fs.closeSync(fd); }
  return false;
}

// ---------- checks ----------
const problems = [];
const ov = probe(out, 'v:0', 'stream=nb_read_packets,duration,bit_rate,start_time:format=duration,bit_rate,size').streams[0];
const fmtInfo = probe(out, 'v:0', 'format=duration,bit_rate,size').format;
if (+ov.nb_read_packets !== N) problems.push(`video ${ov.nb_read_packets} frames, master has ${N}`);
const firstPts = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-read_intervals', '%+#1', '-of', 'json', out]).toString()).frames[0].pts_time;
if (Math.abs(+firstPts) > 1e-6) problems.push(`first video frame at ${firstPts} s, not 0`);
const elst = moovHas(out, 'elst');
if (editlist === 'none' && elst) problems.push('file still has an edit list');
let syncMsg = '';
if (audio) {
  const oa = probe(out, 'a:0', 'stream=duration').streams[0];
  // decoded the way a player WITHOUT edit-list support sees it (there is none to honour anyway)
  const dec = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-map', '0:a:0', '-t', String(Math.min(dur, 8)), '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const ref = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(start), '-t', String(Math.min(dur, 8)), '-i', audio, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const a = new Float32Array(dec.buffer, dec.byteOffset, dec.length >> 2), b = new Float32Array(ref.buffer, ref.byteOffset, ref.length >> 2);
  let best = 0, bestLag = 0;
  const n = Math.min(a.length, b.length) - 4096;
  for (let lag = -2048; lag <= 2048; lag++) {
    let s = 0;
    for (let i = 4096; i < n; i += 3) s += a[i + lag] * b[i];
    if (s > best) { best = s; bestLag = lag; }
  }
  syncMsg = `audio ${oa.duration} s, A/V offset ${bestLag} samples (${(bestLag / 48).toFixed(2)} ms; + = audio late)`;
  if (Math.abs(+oa.duration - dur) > PRIME + 1e-6) problems.push(`audio duration ${oa.duration} s, video ${dur} s`);
  if (Math.abs(bestLag) > 48) problems.push('A/V offset above 1 ms: ' + syncMsg);
}
log(`OUTPUT ${out}: ${ov.nb_read_packets} frames, first pts ${firstPts}, ${(+fmtInfo.size / 1e6).toFixed(1)} MB, ${(fmtInfo.bit_rate / 1e6).toFixed(1)} Mb/s avg, edit lists: ${elst ? 'yes' : 'none'}${syncMsg ? ', ' + syncMsg : ''}`);
if (problems.length) { log('CHECK FAILED: ' + problems.join('; ')); process.exit(2); }
