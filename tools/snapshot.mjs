// Frozen film snapshots + a private static server, so a long render cannot pick up half-finished
// edits other agents make to film/ or assets/ while it runs, and so finished chunks are only reused
// for the exact same film content.
//
//   const snap = ensureSnapshot({ root, dir, reuse });  // copies root/film + root/assets (minus audio)
//   snap.hash   -> sha1 of every served file (path + bytes)
//   const srv = await serveDir(snap.dir);  srv.url + '/film/index.html?...';  srv.misses (404s);  srv.close()
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { execFileSync } from 'child_process';

// what the film page can load: film/** and assets/** except the (huge, not page-loaded) audio
const INCLUDE = ['film', 'assets'];
const EXCLUDE = new Set(['assets/audio', 'film/devcap']);   // devcap = dev-only synthetic captures, never in a render
const skip = rel => EXCLUDE.has(rel) || path.basename(rel).startsWith('.') || rel.endsWith('.part') || rel.endsWith('~');

function listFiles(root) {
  const out = [];
  const walk = rel => {
    const abs = path.join(root, rel);
    const st = fs.statSync(abs);             // follows symlinks
    if (st.isDirectory()) { for (const n of fs.readdirSync(abs).sort()) { const r = rel ? rel + '/' + n : n; if (!skip(r)) walk(r); } }
    else if (st.isFile()) out.push(rel);
  };
  for (const d of INCLUDE) if (fs.existsSync(path.join(root, d))) walk(d);
  return out;
}

export function treeHash(root) {
  const h = crypto.createHash('sha1');
  let bytes = 0;
  const files = listFiles(root);
  for (const rel of files) {
    const b = fs.readFileSync(path.join(root, rel));
    bytes += b.length;
    h.update(rel + '\0' + b.length + '\0'); h.update(b);
  }
  return { hash: h.digest('hex'), files: files.length, bytes };
}

export function gitDescribe(root) {
  try {
    const rev = execFileSync('git', ['-C', root, 'rev-parse', '--short=10', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', ...INCLUDE], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return rev + (dirty ? '-dirty' : '');
  } catch { return 'nogit'; }
}

// dir/SNAPSHOT.json marks a complete snapshot.  reuse=true: keep any complete snapshot found at dir
// (explicit --snapshot shared by several renders); reuse=false: keep it only if it equals the live tree.
export function ensureSnapshot({ root, dir, reuse, log = () => {} }) {
  const marker = path.join(dir, 'SNAPSHOT.json');
  const t0 = Date.now();
  if (fs.existsSync(marker)) {
    const m = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (reuse) {
      const liveNow = treeHash(root);
      log(`using frozen snapshot ${dir} (film ${m.hash.slice(0, 12)}, taken ${m.created}, git ${m.git})` +
        (liveNow.hash === m.hash ? '' : `  NOTE: the live tree has changed since (live ${liveNow.hash.slice(0, 12)}); delete the snapshot dir to pick up the changes`));
      return { dir, ...m };
    }
    const liveNow = treeHash(root);
    if (liveNow.hash === m.hash) { log(`snapshot ${dir} matches the live tree (film ${m.hash.slice(0, 12)})`); return { dir, ...m }; }
    log(`live tree changed (film ${m.hash.slice(0, 12)} -> ${liveNow.hash.slice(0, 12)}): taking a new snapshot`);
  }
  const tmp = dir + '.tmp';
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const rel of listFiles(root)) {
    const dst = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(root, rel), dst);
  }
  const th = treeHash(tmp);      // hash what was actually copied (a file edited mid-copy is caught by the page checks)
  const m = { hash: th.hash, files: th.files, bytes: th.bytes, created: new Date().toISOString(), git: gitDescribe(root), root: path.resolve(root) };
  fs.writeFileSync(path.join(tmp, 'SNAPSHOT.json'), JSON.stringify(m, null, 1));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  log(`snapshot ${dir}: ${th.files} files, ${(th.bytes / 1e6).toFixed(1)} MB, film ${th.hash.slice(0, 12)}, git ${m.git} (${Date.now() - t0} ms)`);
  return { dir, ...m };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.txt': 'text/plain' };

export function serveDir(root) {
  const misses = [];
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    const abs = path.resolve(base, '.' + p);
    if (!abs.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(abs, (err, data) => {
      if (err) {
        if (!/favicon\.ico$/.test(p)) misses.push(p);
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'content-length': data.length, 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      res({ url: `http://127.0.0.1:${port}`, port, misses, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }) });
    });
  });
}
