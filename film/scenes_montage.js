// MONTAGE (80–88 s): eight one-second cuts on the bar hits, every screen a REAL capture (whole states or CSS crops of
// them), each cut stamped with the section's own name + emoji from the site in big Pixelify type.
//   80 ♻️ REFINING          rises out of the features whoosh, tilted panel, push-in on the top rows      (mont_ref)
//   81 💎 ENCHANTING        whip pan from the right, the camera travels from the chips down the rows    (mont_ench)
//   82 🧪 POTIONS & FOOD    pixel slices: the screen splits into bands that run past each other          (mont_cons)
//   83 🏝 ISLANDS           zoom-through into a 3D carousel of the real island art cards                 (mont_isl islCard)
//   84 🛡 ROADS TO CAERLEON  diagonal pixel-block dissolve, tilted 3D panel: the section in context        (mont_roads)
//                           (header title row, section bar with Roads lit, status, task, bandit card, killboard title)
//   85 ⚔️ BANDIT ASSAULT    punch into a crop band of the bandit-windows card only, scanning its lines   (mont_roads roads[0])
//   86 🧮 CALCULATOR        two full-width crop windows of the card swing in: item + materials, then the selects + result row  (mont_calc)
//   87 9 LANGUAGES          slot reel through the 9 real hero captures (lang_*), accelerating on the riser,
//                           then everything is pulled into one bright point by 88.0 (hard cut to the ending).
// States come through pick() (first existing, non-stale preferred). A missing state is never added (no console
// warning): a cut falls back to the previous cut's state with its own camera, or shows only its label.
(function () {
  const { W, H, U, E, seg, spring, clamp, lerp, hash, el, tf, scene, P, L, S, motionBlur } = FX;
  const { stateInfo, VP } = FX.lib;
  const PW = VP.width, VH = VP.height;
  const CUT = [80, 81, 82, 83, 84, 85, 86, 87];

  // ======================= manifest =======================
  const ST = n => (n ? stateInfo(n) : null);
  const has = n => !!ST(n);
  const pick = (...ns) => { ns = ns.flat().filter(Boolean); return ns.find(n => has(n) && !ST(n).stale) || ns.find(has) || null; };
  const rectsOf = (n, k) => (((ST(n) || {}).rects || {})[k]) || [];
  const labelsOf = (n, k) => (((ST(n) || {}).labels || {})[k]) || [];
  const imgSize = n => { const s = ST(n); return !s ? [PW, VH] : (s.fullPage ? [s.page[0], s.page[1]] : [VP.width, VP.height]); };
  const stripH = n => imgSize(n)[1];
  // the part of a page rect inside the saved image (phone table rows run past the right edge)
  const vis = (r, n) => { if (!r) return null; const x0 = Math.max(0, r[0]), x1 = Math.min(PW, r[0] + r[2]), y0 = Math.max(0, r[1]), y1 = Math.min(stripH(n), r[1] + r[3]); return x1 - x0 > 2 && y1 - y0 > 2 ? [x0, y0, x1 - x0, y1 - y0] : null; };
  const inside = (r, n) => !!r && r[0] >= -1 && r[1] >= 0 && r[0] + r[2] <= PW + 1 && r[1] + r[3] <= stripH(n);
  function uni(rs) { rs = rs.filter(Boolean); if (!rs.length) return null; const x0 = Math.min(...rs.map(r => r[0])), y0 = Math.min(...rs.map(r => r[1])), x1 = Math.max(...rs.map(r => r[0] + r[2])), y1 = Math.max(...rs.map(r => r[1] + r[3])); return [x0, y0, x1 - x0, y1 - y0]; }
  const grow = (r, a, b = a) => r && [r[0] - a, r[1] - b, r[2] + 2 * a, r[3] + 2 * b];
  const rowsV = (n, k) => rectsOf(n, 'row').slice(0, k).map(r => vis(r, n)).filter(Boolean);
  const first = (n, k) => vis(rectsOf(n, k)[0], n);
  // the section's own rail button (horizontal rail on phone / square layouts), to tie the stamp to the UI
  // (none when the rail runs past the page's edges, as on the phone: its end buttons would show cut words)
  const railOf = (n, word) => {
    if (L) return null;
    const rs = rectsOf(n, 'rail');
    if (rs.some(r => r[0] < -1 || r[0] + r[2] > PW + 1)) return null;
    const i = labelsOf(n, 'rail').findIndex(s => s.includes(word)); return i >= 0 ? vis(rs[i], n) : null;
  };

  // decode one big capture at a time (decoding them all at once overflows Chromium's decode budget and
  // img.decode() then rejects -> index.html would log 'img failed'); a loaded image that still cannot be
  // pre-decoded rasterises on its frame, so only a real load failure rejects.
  const nativeDecode = HTMLImageElement.prototype.decode;
  let decodeQ = Promise.resolve();
  function queuedDecode(im) {
    im.decode = function () {
      const loaded = () => new Promise((res, rej) => {
        if (im.complete) return im.naturalWidth ? res() : rej(new Error('load failed'));
        im.addEventListener('load', () => res(), { once: true });
        im.addEventListener('error', () => rej(new Error('load failed')), { once: true });
      });
      const job = decodeQ.then(loaded).then(async () => { for (let k = 0; k < 3; k++) { try { await nativeDecode.call(im); return; } catch (e) { /* retry, then rasterise on the frame */ } } });
      decodeQ = job.catch(() => {});
      return job;
    };
    return im;
  }
  // captures are painted as CSS backgrounds; one hidden <img> per file keeps each in the load wait
  const preloaded = new Set();
  let preHost = null;
  function preload(src) {
    if (preloaded.has(src)) return;
    preloaded.add(src);
    if (!preHost) preHost = el('div', 'abs', document.getElementById('stage'), { width: '1px', height: '1px', overflow: 'hidden', opacity: 0, left: '-10px', top: '-10px' });
    queuedDecode(el('img', '', preHost, { width: '1px', height: '1px' })).src = src;
  }

  // ======================= layout =======================
  // panel zone + label zone: label above the panel (9:16, 1:1), label column left of it (16:9)
  // (16:9 keeps ~5% side margins: label column 4.5–42.5% of the width, panels 45–95%)
  const BOX = P ? { x: W * 0.06, y: H * 0.235, w: W * 0.88, h: H * 0.72 } : S ? { x: W * 0.05, y: H * 0.25, w: W * 0.9, h: H * 0.715 } : { x: W * 0.45, y: H * 0.09, w: W * 0.5, h: H * 0.82 };
  const LZ = P ? { cx: W / 2, cy: H * 0.122, w: W * 0.88, h: H * 0.19 } : S ? { cx: W / 2, cy: H * 0.128, w: W * 0.9, h: H * 0.21 } : { cx: W * 0.235, cy: H * 0.5, w: W * 0.38, h: H * 0.62 };
  const FULL = { x: 0, y: 0, w: W, h: H };
  const BC = [BOX.x + BOX.w / 2, BOX.y + BOX.h / 2];

  // camera [cx, cy, z] in page CSS px, never showing past the capture's edges
  function camIn(n, box, cx, cy, z, zMax = 9) {
    const zMin = Math.max(box.w / PW, box.h / stripH(n));
    z = clamp(z, zMin, Math.max(zMin, zMax));
    const hw = box.w / 2 / z, hh = box.h / 2 / z, sh = stripH(n);
    return [PW <= 2 * hw + 0.5 ? PW / 2 : clamp(cx, hw, PW - hw), sh <= 2 * hh + 0.5 ? sh / 2 : clamp(cy, hh, sh - hh), z];
  }
  // frame a page rect (padded); ay = where it sits when the view is taller than it (0 = top)
  function frameR(n, box, r, pad = 0.1, ay = 0.5, zMax = 9) {
    if (!r) return camIn(n, box, PW / 2, VH / 2, 0);
    const zMin = Math.max(box.w / PW, box.h / stripH(n));
    const z = clamp(Math.min(box.w / (r[2] * (1 + pad)), box.h / (r[3] * (1 + pad))), zMin, Math.max(zMin, zMax)), hh = box.h / 2 / z;
    return camIn(n, box, r[0] + r[2] / 2, r[1] + r[3] / 2 + (0.5 - ay) * Math.max(0, 2 * hh - r[3] * (1 + pad)), z, zMax);
  }
  // push-in / pull-back by k that keeps the page point under the window's fractional position (ax, ay) fixed;
  // default top-left, so the first letters of every line stay in the window (text and tables read from the left)
  function zoomA(n, box, c, k, ax = 0, ay = 0) {
    const z1 = camIn(n, box, 0, 0, c[2] * k)[2];
    const px = c[0] + (ax - 0.5) * box.w / c[2], py = c[1] + (ay - 0.5) * box.h / c[2];
    return camIn(n, box, px - (ax - 0.5) * box.w / z1, py - (ay - 0.5) * box.h / z1, z1);
  }
  // the window's top edge goes into the gap just above a block (status, task, chips, rows...), never through a line
  const GAPK = ['rail', 'status', 'task', 'grp', 'search', 'filters', 'th', 'row', 'calc', 'calcSelects', 'calcOut', 'roads', 'q'];
  function snapTop(n, box, c, maxD = 70) {
    const hh = box.h / 2 / c[2], yt = c[1] - hh;
    if (yt <= 1) return c;
    let best = null;
    for (const k of GAPK) for (const r of rectsOf(n, k)) {
      if (!vis(r, n) || r[1] < 8) continue;
      const y = r[1] - 7, d = y <= yt ? yt - y : 1.6 * (y - yt);   // prefer opening the window upwards
      if (d <= maxD && (!best || d < best.d)) best = { y, d };
    }
    return best ? camIn(n, box, c[0], best.y + hh, c[2]) : c;
  }
  // camera kept inside one page rect r (a crop window: nothing outside r can show)
  function camR(r, box, cx, cy, z) {
    const hw = box.w / 2 / z, hh = box.h / 2 / z;
    return [r[2] <= 2 * hw ? r[0] + r[2] / 2 : clamp(cx, r[0] + hw, r[0] + r[2] - hw), r[3] <= 2 * hh ? r[1] + r[3] / 2 : clamp(cy, r[1] + hh, r[1] + r[3] - hh), z];
  }
  const ZB = L ? 1.32 : S ? 1.2 : 1;   // wide captures: get closer than "fit" so the UI reads
  // left/top-anchored framing at a zoom multiple of "fit" (tables read from the left: item, city, cost, profit)
  function anchorCam(n, box, r, zMul, ay = 0) {
    if (!r) return camIn(n, box, PW / 2, VH / 2, 0);
    const z = frameR(n, box, r, 0.06, ay)[2] * zMul, hw = box.w / 2 / z, hh = box.h / 2 / z, m = 10;
    const cx = r[2] + 2 * m > 2 * hw ? r[0] - m + hw : r[0] + r[2] / 2;
    const cy = r[3] + 2 * m > 2 * hh ? r[1] - m + hh : r[1] + r[3] / 2 + (0.5 - ay) * (2 * hh - r[3] - 2 * m);
    return camIn(n, box, cx, cy, z);
  }
  // stale capture (no rows): a shorter window around the populated top of the section, so no empty skeleton shows. The
  // window takes the block's whole width (phones: the page width), so no line of it runs past the window's edges; the
  // shots then move the window itself (push / pull of the rig), never the camera inside it
  function staleBox(n, focus) {
    if (!focus) return { box: BOX, cam: camIn(n, BOX, PW / 2, VH / 2, 0) };
    const fw = focus[2] + 24;
    const z0 = camIn(n, BOX, 0, 0, BOX.w / fw)[2];
    const h = clamp((focus[3] + 28) * z0, BOX.h * 0.42, BOX.h);
    const box = { x: BOX.x, y: BC[1] - h / 2, w: BOX.w, h };
    const z = camIn(n, box, 0, 0, box.w / fw)[2], cx = focus[0] - 12 + box.w / 2 / z, hh = box.h / 2 / z;
    const c = camIn(n, box, cx, focus[1] + focus[3] / 2, z), hd = first(n, 'header'), yt = c[1] - hh;
    // the window's top edge never cuts through the site header (logo, title, buttons): when the centred window would,
    // it top-anchors on the focus instead, its top just under the header
    if (hd && yt > hd[1] + 2 && yt < hd[1] + hd[3] - 2) return { box, cam: camIn(n, box, cx, Math.max(focus[1] - 14 / z, hd[1] + hd[3] + 1) + hh, z) };
    return { box, cam: c };
  }
  const lerpCam = (a, b, p) => [lerp(a[0], b[0], p), lerp(a[1], b[1], p), Math.exp(lerp(Math.log(a[2]), Math.log(b[2]), p))];

  // ======================= pieces =======================
  // a real capture in a rounded window; camera in page px
  function Screen(parent, n, box, o = {}) {
    const s = ST(n), [iw, ih] = imgSize(n);
    preload(s.img);
    const rad = o.radius == null ? 28 * U : o.radius;
    const frame = el('div', 'abs', parent, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px', overflow: 'hidden', borderRadius: rad + 'px', background: '#0b0d12',
      boxShadow: o.flat ? 'none' : `0 44px 130px rgba(0,0,0,.72), 0 0 0 ${Math.max(1, 1.5 * U)}px rgba(60,70,98,.95)` });
    const inner = el('div', 'abs', frame, { width: iw + 'px', height: ih + 'px', transformOrigin: '0 0', backgroundImage: `url("${s.img}")`, backgroundSize: `${iw}px ${ih}px`, backgroundRepeat: 'no-repeat' });
    if (!o.flat) el('div', 'abs', frame, { width: '100%', height: '100%', borderRadius: rad + 'px', zIndex: 2, boxShadow: `inset 0 ${2 * U}px 0 rgba(255,255,255,.07), inset 0 0 0 ${Math.max(1, U)}px rgba(255,255,255,.04)` });
    return { frame, inner, box, n, set(c) { inner.style.transform = `translate(${(box.w / 2 - c[0] * c[2]).toFixed(2)}px,${(box.h / 2 - c[1] * c[2]).toFixed(2)}px) scale(${c[2].toFixed(5)})`; } };
  }
  // a crop of a capture (page rect r) at k screen px per page px, as a positioned box
  function CropBox(parent, n, r, k, style) {
    const s = ST(n), [iw, ih] = imgSize(n);
    preload(s.img);
    return el('div', 'abs', parent, Object.assign({ width: r[2] * k + 'px', height: r[3] * k + 'px', overflow: 'hidden', backgroundImage: `url("${s.img}")`, backgroundRepeat: 'no-repeat',
      backgroundSize: `${iw * k}px ${ih * k}px`, backgroundPosition: `${-r[0] * k}px ${-r[1] * k}px` }, style || {}));
  }
  // shot rig: glow + window, posed per frame (whips, tilts, punches) with directional motion blur
  function Shot(Lr, n, box, rgb, o = {}) {
    const root = el('div', 'fill', Lr, { transformOrigin: `${W / 2}px ${H / 2}px` });
    const rig = el('div', 'fill', root, { transformOrigin: `${box.x + box.w / 2}px ${box.y + box.h / 2}px` });
    const halo = o.flat ? null : el('div', 'abs', rig, { left: box.x - 200 * U + 'px', top: box.y - 200 * U + 'px', width: box.w + 400 * U + 'px', height: box.h + 400 * U + 'px',
      background: `radial-gradient(50% 50% at 50% 50%, rgba(${rgb},.26) 0%, rgba(${rgb},.08) 45%, rgba(${rgb},0) 72%)` });
    const scr = n ? Screen(rig, n, box, o) : null;
    const mb = motionBlur();
    return {
      root, rig, halo, scr, mb, box,
      set(c) { if (scr) scr.set(c); },
      // {x,y,s,r,rx,ry,bx,by,bright,blur,o}
      pose(p) {
        tf(rig, { x: p.x || 0, y: p.y || 0, s: p.s == null ? 1 : p.s, r: p.r || 0, rx: p.rx || 0, ry: p.ry || 0, persp: 2400 * U, o: p.o == null ? 1 : p.o });
        if (!scr) return;
        const bx = p.bx || 0, by = p.by || 0;
        let f = (bx > 0.4 || by > 0.4) ? mb.url + ' ' : '';
        if (p.blur > 0.3) f += `blur(${p.blur.toFixed(1)}px) `;
        if (p.bright != null && Math.abs(p.bright - 1) > 0.005) f += `brightness(${p.bright.toFixed(3)})`;
        scr.frame.style.filter = f.trim() || 'none';
        mb.set(bx, by);
      },
    };
  }
  // horizontal bands of a window (for the slice transition), each clipped to its rows of the frame
  function Bands(Lr, n, box, N) {
    const out = [];
    for (let k = 0; k < N; k++) {
      const y0 = Math.round(box.y + box.h * k / N), y1 = Math.round(box.y + box.h * (k + 1) / N);
      const wrap = el('div', 'fill', Lr, { clipPath: `inset(${k ? y0 - 0.5 : 0}px -40% ${k < N - 1 ? H - y1 - 0.5 : 0}px -40%)`, display: 'none', transformOrigin: `${box.x + box.w / 2}px ${box.y + box.h / 2}px` });
      const sc = Screen(wrap, n, box), mb = motionBlur();
      out.push({ wrap, sc, mb, k, dir: k % 2 ? 1 : -1, blur(bx) { sc.frame.style.filter = bx > 0.4 ? mb.url : 'none'; mb.set(bx, 0); } });
    }
    return out;
  }
  const beatPulse = (t, T) => 1 + 0.012 * Math.exp(-Math.max(0, t - (T + 0.5)) / 0.09) * (t >= T + 0.5 ? 1 : 0);

  // ======================= labels =======================
  // the label icons ship with the film: a 7-glyph subset of Noto Color Emoji (CBDT colour bitmaps, OFL), so a render
  // host without the system emoji font still draws them in colour. The load starts while the scripts run, so the
  // page's document.fonts.ready waits for it; if it ever failed, the system stack below takes over.
  const EMO_SUB = 'data:font/ttf;base64,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';
  try { const ff = new FontFace('Montage Emoji', `url(${EMO_SUB})`); document.fonts.add(ff); ff.load().catch(() => {}); } catch (e) { /* system emoji */ }
  const EMO = "'Montage Emoji','Noto Color Emoji','Apple Color Emoji','Segoe UI Emoji',sans-serif";
  const LBL = [
    { e: '♻️', t: 'REFINING', rgb: '98,201,111' },
    { e: '💎', t: 'ENCHANTING', rgb: '106,165,224' },
    { e: '🧪', t: 'POTIONS & FOOD', br: 'POTIONS|& FOOD', brP: 1, rgb: '178,126,232' },
    { e: '🏝\uFE0F', t: 'ISLANDS', rgb: '238,188,78' },
    { e: '🛡\uFE0F', t: 'ROADS TO CAERLEON', br: 'ROADS TO|CAERLEON', brP: 1, brS: 1, rgb: '228,111,97' },
    { e: '⚔️', t: 'BANDIT ASSAULT', br: 'BANDIT|ASSAULT', brP: 1, rgb: '228,111,97' },
    { e: '🧮', t: 'CALCULATOR', rgb: '238,188,78' },
    { nine: 1, t: 'LANGUAGES', rgb: '245,212,126' },
  ];
  const escH = s => s.replace(/&/g, '&amp;');
  // faces: warm white→gold for the names, molten gold for the 9 (inline-block spans, so the emoji keeps its colours)
  const CLIP = ';-webkit-background-clip:text;background-clip:text;color:transparent;display:inline-block';
  const FACE = 'background:linear-gradient(180deg,#ffffff 0%,#fff7e2 40%,#f8dc93 74%,#e9b552 100%)' + CLIP;
  const NINE = '<span style="background:linear-gradient(180deg,#fbe39a 0%,#f5d47e 30%,#eebc4e 62%,#b9852a 100%)' + CLIP + '">9</span>';
  const txt = s => `<span style="${FACE}">${escH(s)}</span>`;
  // lines of a label for this format; the icon (emoji or the gold 9) leads the first line, or gets its own line in 16:9
  function linesOf(lb) {
    const icon = lb.nine ? NINE : (lb.e ? `<span class="emo" style="font-family:${EMO};text-shadow:none;display:inline-block">${lb.e}</span>` : '');
    if (L) return { icon, lines: (lb.br || lb.t).split('|').map(txt) };
    const ls = ((P && lb.brP) || (S && lb.brS) ? lb.br : lb.t).split('|').map(txt);
    ls[0] = icon + '&nbsp;' + ls[0];
    return { icon: null, lines: ls };
  }
  const LSTYLE = { letterSpacing: '.02em' };
  function probeW(html, cls, style) {
    const pr = el('div', 'abs ' + cls, document.getElementById('stage'), Object.assign({ fontSize: '100px', whiteSpace: 'nowrap', lineHeight: 1, visibility: 'hidden' }, style || {}));
    pr.innerHTML = html; const w = pr.offsetWidth; pr.remove(); return w;
  }
  // one size for every label of a format (DOM-measured, emoji included)
  let LSIZE = null;
  function labelSize() {
    if (LSIZE) return LSIZE;
    const cap = (P ? 150 : S ? 112 : 128) * U;
    let s = cap;
    for (const lb of LBL) {
      const { lines } = linesOf(lb);
      for (const ln of lines) s = Math.min(s, LZ.w * 100 / probeW(ln, 'px', LSTYLE));
      if (!L && lines.length > 1) s = Math.min(s, LZ.h / (lines.length * 1.08));
    }
    LSIZE = s; return s;
  }
  // hard pixel shadow (dark, so it never fills a letter's counter) + soft depth + a faint warm glow
  const shadowF = sz => `drop-shadow(0 ${(0.055 * sz).toFixed(1)}px 0 rgba(4,5,9,.96)) drop-shadow(0 ${(0.1 * sz).toFixed(1)}px ${(0.2 * sz).toFixed(1)}px rgba(0,0,0,.8)) drop-shadow(0 0 ${(0.22 * sz).toFixed(1)}px rgba(238,188,78,.22))`;
  function Label(parent, i) {
    const lb = LBL[i], T = CUT[i], sz = labelSize();
    const { icon, lines } = linesOf(lb);
    const a = el('div', 'abs', parent, { width: '0px', height: '0px', left: LZ.cx + 'px' });
    const box = el('div', 'abs', a, { width: '0px', height: '0px' });
    const rows = [];
    if (icon) rows.push({ html: icon, size: sz * (lb.nine ? 1.9 : 1.3), icon: true });
    for (const ln of lines) rows.push({ html: ln, size: sz });
    const gap = sz * 0.1;
    const els = rows.map(r => {
      const e = el('div', 'abs px', box, Object.assign({ fontSize: r.size + 'px', whiteSpace: 'nowrap', lineHeight: 1, filter: shadowF(r.size) }, LSTYLE));
      e.innerHTML = r.html;
      return { e, w: e.offsetWidth, h: r.size * 1.02, icon: r.icon };
    });
    const totH = els.reduce((s, r) => s + r.h, 0) + gap * (els.length - 1);
    // 9:16: a two-line stack keeps its letters' top edge below the app overlays (>= ~7.5% of the height)
    const cy = P ? Math.max(LZ.cy, H * 0.069 + totH / 2) : LZ.cy;
    a.style.top = cy + 'px';
    let y = -totH / 2, maxW = 0;
    for (const r of els) { r.e.style.left = -r.w / 2 + 'px'; r.e.style.top = y + 'px'; r.cy = y + r.h / 2; y += r.h + gap; maxW = Math.max(maxW, r.w); }
    const emo = box.querySelector('.emo');
    if (emo) emo.style.transformOrigin = '50% 60%';
    // gold rule under the stack + the stamp's ink ring
    const ruleW = Math.min(maxW * 0.62, LZ.w * 0.6), ruleH = Math.max(2, 5 * U);
    const rule = el('div', 'abs', box, { left: -ruleW / 2 + 'px', top: totH / 2 + sz * 0.2 + 'px', width: ruleW + 'px', height: ruleH + 'px', borderRadius: ruleH + 'px',
      background: `linear-gradient(90deg, rgba(${lb.rgb},0), rgb(${lb.rgb}) 22%, #f5d47e 50%, rgb(${lb.rgb}) 78%, rgba(${lb.rgb},0))`, boxShadow: `0 0 18px rgba(${lb.rgb},.75)` });
    const rw = maxW + sz * 0.7, rh = totH + sz * 0.6;
    const ring = el('div', 'abs', a, { left: -rw / 2 + 'px', top: -rh / 2 + 'px', width: rw + 'px', height: rh + 'px', borderRadius: sz * 0.22 + 'px', boxSizing: 'border-box', border: `${Math.max(2, 5 * U)}px solid rgba(255,236,190,.9)`, boxShadow: `0 0 40px rgba(${lb.rgb},.8), inset 0 0 30px rgba(${lb.rgb},.4)`, opacity: 0 });
    const tilt = i % 2 ? 1.6 : -1.6, ringS = lb.nine ? 0.1 : 0.3;   // 9 LANGUAGES: a tight ring (the code row sits under it)
    // the stamp falls for 0.08 s and LANDS on the hit (the first cut starts with the montage, so it lands just after)
    const TLd = i === 0 ? T + 0.03 : T, TS = TLd - 0.08;
    FX.burst({ t: TLd, x: LZ.cx, y: cy, n: i === 0 ? 90 : 46, speed: 1300, angle: -Math.PI / 2, spread: Math.PI * 2, gravity: 700, life: 0.6, size: 2.6, color: [255, 214, 140], streak: 0.025 });
    return {
      a, box, w: maxW, h: totH, T, cy, sz,
      // ex: exit pose {x,y,s,o,blur} for this frame
      set(t, ex) {
        if (t < TS || t >= T + 0.95) { a.style.display = 'none'; return; }
        a.style.display = '';
        const p = seg(t, TS, TLd, E.inQ), d = t - TLd;
        // falling (big, soft) -> impact squash -> settle, then a slow grow while it holds
        const s = lerp(1.9, 1, p) * (d >= 0 ? 1 + 0.07 * (spring(d, 4.2, 0.38) - 1) : 1) * (1 + 0.03 * seg(d, 0, 0.9));
        ex = ex || {};
        const eo = ex.o == null ? 1 : ex.o;
        tf(box, { x: ex.x || 0, y: (ex.y || 0) + (1 - p) * -24 * U, s: s * (ex.s == null ? 1 : ex.s), r: tilt * (1 + 2 * (1 - p)), o: seg(t, TS, TS + 0.03) * eo, blur: (1 - p) * 9 + (ex.blur || 0), bright: d >= 0 ? 1 + 0.7 * Math.exp(-d / 0.06) : 1 });
        if (emo) { const e = spring(d + 0.02, 3.8, 0.42); tf(emo, { s: d < -0.02 ? 0.3 : 0.3 + 0.7 * e, r: (1 - e) * -28 }); }
        rule.style.transform = `scaleX(${Math.max(0.001, seg(d, 0.0, 0.2, E.outC)).toFixed(3)})`;
        const q = seg(d, 0, 0.4, E.outC);
        tf(ring, { x: ex.x || 0, y: ex.y || 0, s: (lb.nine ? 0.97 : 0.92) + ringS * q, o: d >= 0 ? (1 - q) * 0.85 * eo : 0 });
      },
    };
  }

  // ======================= timing shared by several layers =======================
  const WAVE0 = 83.86, WAVE1 = 84.07;                       // 83→84 diagonal pixel-block dissolve
  const waveF = t => lerp(-0.2, 1.2, seg(t, WAVE0, WAVE1));  // front position on the diagonal (0 = top-left, 1 = bottom-right)
  const COL0 = 87.6, COL1 = 87.975;                          // the riser's pull into one bright point
  const colK = t => seg(t, COL0, COL1, E.inC);
  function collapsePose(t) { const k = colK(t); return { s: lerp(1, 0.015, k), r: 10 * k, bright: 1 + 2.4 * k, o: 1 - seg(t, 87.94, 87.99) }; }
  function applyCollapse(e, t) {
    const c = collapsePose(t);
    if (t < COL0) { e.style.transform = 'none'; e.style.filter = 'none'; e.style.opacity = 1; return; }
    e.style.transform = `rotate(${c.r.toFixed(2)}deg) scale(${c.s.toFixed(4)})`;
    e.style.filter = `brightness(${c.bright.toFixed(3)})`;
    e.style.opacity = c.o.toFixed(3);
  }

  // ======================= background (own, opaque) =======================
  // whips move the pixel grid with the camera; speed lines on the whips, radial ones on the zoom-through
  const WHIPS = [[79.8, 80.22, 0, -1], [80.82, 81.2, -1, 0], [81.84, 82.12, 1, 0], [85.82, 86.2, 1, 0], [86.82, 87.12, 0, -1]];
  const T_IN = 79.92;   // the features exit is over by ~79.9: background + REFINING's blurred rise cover the frames before the cut
  scene('mont_bg', T_IN, 88.0, (Lr) => {
    el('div', 'fill', Lr, { background: '#0b0d12' });
    el('div', 'fill', Lr, { background: 'radial-gradient(70% 45% at 70% -5%, rgba(23,29,46,.85) 0%, rgba(11,13,18,0) 75%)' });
    const glow = el('div', 'fill', Lr);
    const gs = 24 * U;
    const grid = el('div', 'fill', Lr, { backgroundImage: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: `${gs}px ${gs}px`,
      maskImage: 'radial-gradient(75% 65% at 50% 50%, #000 0%, transparent 100%)', WebkitMaskImage: 'radial-gradient(75% 65% at 50% 50%, #000 0%, transparent 100%)' });
    const cv = el('canvas', 'fill', Lr); cv.width = Math.ceil(W / 2); cv.height = Math.ceil(H / 2); const ctx = cv.getContext('2d');
    const dark = el('div', 'fill', Lr, { background: '#030305', opacity: 0 });
    const ACC = LBL.map(l => l.rgb);
    return (t) => {
      const i = clamp(Math.floor(t - 80), 0, 7), rgb = ACC[i];
      const hitG = t < 80 ? 0 : Math.exp(-Math.max(0, t - CUT[i]) / 0.25);
      glow.style.background = `radial-gradient(${P ? '85% 50%' : L ? '55% 70%' : '70% 60%'} at ${(BC[0] / W * 100).toFixed(1)}% ${(BC[1] / H * 100).toFixed(1)}%, rgba(${rgb},${(0.16 + 0.12 * hitG).toFixed(3)}) 0%, rgba(${rgb},.05) 45%, rgba(${rgb},0) 75%)`;
      let gx = 0, gy = -t * 12 * U;
      for (const [a, b, dx, dy] of WHIPS) { const p = seg(t, a, b, E.ioC); gx += dx * p * W * 0.6; gy += dy * p * H * 0.5; }
      grid.style.backgroundPosition = `${gx.toFixed(1)}px ${gy.toFixed(1)}px`;
      // speed lines
      ctx.clearRect(0, 0, cv.width, cv.height);
      const cw = cv.width, ch = cv.height;
      ctx.globalCompositeOperation = 'lighter';
      for (const [a, b, dx, dy] of WHIPS) {
        const m = Math.sin(Math.PI * seg(t, a, b)); if (m <= 0.02) continue;
        for (let k = 0; k < 46; k++) {
          const len = (120 + 380 * hash(k, 41)) * U * m, along = (hash(k, 42) * 1.6 - 0.3 + seg(t, a, b) * 1.2 * (0.6 + hash(k, 43)));
          const al = (0.05 + 0.2 * hash(k, 44)) * m;
          ctx.strokeStyle = `rgba(255,${(214 + 30 * hash(k, 45)) | 0},170,${al.toFixed(3)})`; ctx.lineWidth = (0.6 + 1.6 * hash(k, 46)) * U;
          ctx.beginPath();
          if (dx) { const y = hash(k, 47) * ch, x = (dx < 0 ? 1 - along : along) * cw; ctx.moveTo(x, y); ctx.lineTo(x - dx * len / 2, y); }
          else { const x = hash(k, 47) * cw, y = (dy < 0 ? 1 - along : along) * ch; ctx.moveTo(x, y); ctx.lineTo(x, y - dy * len / 2); }
          ctx.stroke();
        }
      }
      const zm = Math.sin(Math.PI * seg(t, 82.8, 83.12));
      if (zm > 0.02) {
        const cx = BC[0] / 2, cy = BC[1] / 2, R = Math.hypot(cw, ch) * 0.6;
        for (let k = 0; k < 70; k++) {
          const ang = hash(k, 51) * Math.PI * 2, r0 = R * (0.15 + 0.6 * ((hash(k, 52) + seg(t, 82.8, 83.12) * 1.3) % 1)), len = (60 + 220 * hash(k, 53)) * U * zm;
          ctx.strokeStyle = `rgba(255,236,200,${((0.08 + 0.22 * hash(k, 54)) * zm).toFixed(3)})`; ctx.lineWidth = (0.8 + 1.4 * hash(k, 55)) * U;
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); ctx.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len)); ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      dark.style.opacity = (0.85 * seg(t, COL0 + 0.1, COL1, E.inQ)).toFixed(3);
    };
  }, { z: 22 });

  // ======================= 80 ♻️ REFINING =======================
  const N1 = pick('mont_ref', 'mont_loading');
  scene('mont_ref', T_IN, 81.0, (Lr) => {
    const T = 80, n = N1;
    if (!n) return () => {};
    const rows = rowsV(n, 6);
    const focus = rows.length ? uni([first(n, 'task'), ...rectsOf(n, 'th').slice(0, 3).map(r => vis(r, n)), ...rows]) : uni([railOf(n, 'Refining'), first(n, 'status'), first(n, 'task'), first(n, 'filters')]);
    const sb = rows.length ? { box: BOX, cam: anchorCam(n, BOX, focus, ZB, 0.15) } : staleBox(n, focus), box = sb.box;
    const sh = Shot(Lr, n, box, LBL[0].rgb);
    // (stale: the window pushes in as a whole, the full-width framing inside it holds)
    const c0 = snapTop(n, box, sb.cam), c1 = rows.length ? zoomA(n, box, c0, 1.13) : c0, grow = rows.length ? 0 : 0.06;
    return (t) => {
      sh.set(lerpCam(c0, c1, seg(t, T, T + 1, E.outQ)));
      const a = seg(t, T_IN, T + 0.12, E.outQuint), b = seg(t, T + 0.84, T + 1.0, E.inC);
      sh.pose({ y: (1 - a) * H * 0.4, s: (0.88 + 0.12 * a) * beatPulse(t, T) * (1 + grow * seg(t, T, T + 1, E.outQ)), rx: 30 * (1 - a) + lerp(7, 4, seg(t, T, T + 1)), ry: (L ? -9 : -5) + 3 * (1 - a) - 8 * b, x: -b * W * 1.25, by: (1 - a) * 45, bx: b * 110, bright: 1 + 0.25 * (1 - a) });
    };
  }, { z: 24 });

  // ======================= 81 💎 ENCHANTING =======================
  const N2 = pick('mont_ench') || N1;
  const NB = 9;
  scene('mont_ench', 80.96, 82.03, (Lr) => {
    const T = 81, n = N2;
    if (!n) return () => {};
    const grp = uni(rectsOf(n, 'grp').map(r => vis(r, n)));
    const rows = rowsV(n, 4);
    let box = BOX, c0, c1;
    if (rows.length) {
      // chips -> rows: the camera travels down the table
      const top = uni([first(n, 'task'), grp || first(n, 'filters')]) || first(n, 'status');
      const bot = uni([...rectsOf(n, 'th').slice(0, 3).map(r => vis(r, n)), ...rows]);
      const zK = (P ? 1.18 : 1.1) * ZB;
      c0 = snapTop(n, BOX, anchorCam(n, BOX, top, zK, 0.25)); c1 = snapTop(n, BOX, anchorCam(n, BOX, bot, zK * 1.04, 0.35));
    } else {
      const sb = staleBox(n, uni([railOf(n, 'Enchanting'), first(n, 'status'), first(n, 'task'), grp, first(n, 'filters')]));
      box = sb.box; c0 = snapTop(n, box, sb.cam); c1 = c0;
    }
    const grow = rows.length ? 0 : 0.05;
    const sh = Shot(Lr, n, box, LBL[1].rgb), bands = Bands(Lr, n, box, NB);
    return (t) => {
      const c = lerpCam(c0, c1, seg(t, T + 0.08, T + 0.95, E.ioC));
      const a = seg(t, T - 0.04, T + 0.14, E.outQuint);
      const sliced = t >= T + 0.84;
      sh.rig.style.display = sliced ? 'none' : '';
      sh.set(c);
      const k = 1 + grow * seg(t, T + 0.08, T + 0.95, E.ioC);
      sh.pose({ x: (1 - a) * W * 0.95, ry: (L ? 7 : 4) + 14 * (1 - a), rx: 3, bx: (1 - a) * 110, s: beatPulse(t, T) * k, bright: 1 + 0.2 * (1 - a) });
      for (const b of bands) {
        b.wrap.style.display = sliced ? '' : 'none';
        if (!sliced) continue;
        const p = seg(t, T + 0.84 + b.k * 0.007, T + 1.0 + b.k * 0.007, E.inQ);
        b.sc.set(c);
        tf(b.wrap, { x: b.dir * p * W * 1.2, ry: (L ? 7 : 4), rx: 3, s: k, persp: 2400 * U });
        b.blur(p * 70);
      }
    };
  }, { z: 25 });

  // ======================= 82 🧪 POTIONS & FOOD =======================
  const N3 = pick('mont_cons') || N2;
  scene('mont_cons', 81.9, 83.0, (Lr) => {
    const T = 82, n = N3;
    if (!n) return () => {};
    const grp = uni(rectsOf(n, 'grp').map(r => vis(r, n)));
    const rows = rowsV(n, 5);
    const focus = rows.length ? uni([grp, ...rows]) : uni([railOf(n, 'Potions'), first(n, 'status'), first(n, 'task'), grp, first(n, 'filters')]) || first(n, 'status');
    const sb = rows.length ? { box: BOX, cam: anchorCam(n, BOX, focus, ZB, 0.2) } : staleBox(n, focus), box = sb.box, cF = sb.cam;
    const sh = Shot(Lr, n, box, LBL[2].rgb), bands = Bands(Lr, n, box, NB);
    // pull-back: starts close, settles on the framing (top-left anchored: the window opens to the right and down);
    // stale: the full-width framing holds and the window itself pulls back
    const cS = snapTop(n, box, cF), c0 = rows.length ? zoomA(n, box, cS, 1.4) : cS, c1 = rows.length ? zoomA(n, box, cS, 1.12) : cS;
    const kOf = t => (rows.length ? 1 : lerp(1.07, 1, seg(t, T - 0.05, T + 0.95, E.outC)));
    const rot = t => lerp(2.4, 0.6, seg(t, T - 0.1, T + 0.9, E.outQ));
    return (t) => {
      const c = lerpCam(c0, c1, seg(t, T - 0.05, T + 0.95, E.outC));
      const inB = t < T + 0.16;
      sh.rig.style.display = inB ? 'none' : '';
      for (const b of bands) {
        b.wrap.style.display = inB ? '' : 'none';
        if (!inB) continue;
        const p = seg(t, T - 0.1 + b.k * 0.009, T + 0.08 + b.k * 0.009, E.outQuint);
        b.sc.set(c);
        tf(b.wrap, { x: -b.dir * (1 - p) * W * 1.2, r: rot(t), s: kOf(t), o: t >= T - 0.1 + b.k * 0.009 ? 1 : 0 });
        b.blur((1 - p) * 70);
      }
      sh.set(c);
      // hold: slow pull-back while the frame straightens; out: zoom straight through the screen
      const z = seg(t, T + 0.8, T + 1.0, E.inC);
      sh.pose({ r: rot(t), s: (1 + 2.3 * z) * beatPulse(t, T) * kOf(t), blur: z * 16, bright: 1 + 1.6 * z, o: 1 - seg(t, T + 0.9, T + 1.0) });
    };
  }, { z: 26 });

  // ======================= 83 🏝 ISLANDS: a 3D carousel of the real island cards =======================
  const N4 = pick('mont_isl');
  const CITY_RGB = { STERLING: '200,222,250', MARTLOCK: '110,160,235', BRIDGEWATCH: '245,160,70', LYMHURST: '125,205,110', THETFORD: '175,120,235', CAERLEON: '232,88,76', BRECILIEN: '80,200,195' };
  scene('mont_isl', 82.94, WAVE1 + 0.01, (Lr) => {
    const T = 83;
    const n = N4;
    let cards = n ? rectsOf(n, 'islCard').map((r, i) => ({ r, i, name: labelsOf(n, 'islName')[i] || '' })).filter(c => inside(c.r, n)) : [];
    // a card under the page's floating Settings button (fixed, so it sits on one card in a full-page capture) is skipped
    const hits = (a, b) => a && b && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    const clean = cards.filter(c => !rectsOf(n, 'settings').some(r => hits(c.r, r)));
    if (clean.length >= 3) cards = clean;
    if (cards.length < 2) {
      // fallback: the islands screen (or the previous one) as a tilted panel
      const m = n || N3, sh = Shot(Lr, m, BOX, LBL[3].rgb);
      if (!m) return () => {};
      const cF = snapTop(m, BOX, frameR(m, BOX, uni([first(m, 'task'), first(m, 'status')]), 0.1, 0.1));
      return (t) => { const a = seg(t, T - 0.04, T + 0.2, E.outQuint); sh.set(zoomA(m, BOX, cF, lerp(1.25, 1.1, seg(t, T, T + 1)))); sh.pose({ s: 0.4 + 0.6 * a, blur: (1 - a) * 14, ry: -8, rx: 6, o: seg(t, T - 0.04, T) }); };
    }
    const glow = el('div', 'fill', Lr, { opacity: 0 });
    const flow = el('div', 'fill', Lr, { transformOrigin: `${BC[0]}px ${BC[1]}px` });
    const cr = cards[0].r;
    const cw = P ? W * 0.7 : S ? W * 0.5 : W * 0.3, k = cw / cr[2], ch = cr[3] * k;
    const fy = BC[1] - (P ? 40 : S ? 10 : 30) * U;
    const sp1 = cw * (P ? 0.66 : 0.74), sp2 = cw * (P ? 0.28 : 0.36);
    const els = cards.map((c, j) => {
      const box = CropBox(flow, n, c.r, k, { left: BC[0] - cw / 2 + 'px', top: fy - ch / 2 + 'px', borderRadius: 16 * U + 'px',
        boxShadow: '0 40px 90px rgba(0,0,0,.7), 0 0 0 1px rgba(60,70,98,.9)' });
      // side cards are dimmed by a black veil (cheaper to composite than a filter on each 3D card)
      const dim = el('div', 'abs', box, { left: 0, top: 0, width: '100%', height: '100%', background: '#000', opacity: 0 });
      const gl = el('div', 'abs', box, { left: 0, top: 0, width: '100%', height: '100%', overflow: 'hidden', mixBlendMode: 'screen', display: 'none' });
      const band = el('div', 'abs', gl, { top: '-30%', height: '160%', width: '22%', transform: 'rotate(14deg)', background: 'linear-gradient(90deg, rgba(255,240,205,0) 0%, rgba(255,240,205,.32) 50%, rgba(255,240,205,0) 100%)' });
      const key = Object.keys(CITY_RGB).find(kk => c.name.toUpperCase().includes(kk));
      return { box, dim, gl, band, j, rgb: CITY_RGB[key] || '238,188,78', refl: null };
    });
    const nC = els.length;
    // centred card: arrives on the 2nd card (neighbours both sides), steps on the beat, rushes on into the dissolve
    const uA = nC >= 3 ? 1 : 0, uB = Math.min(uA + 1, nC - 1);
    // the step on the beat is a snap (0.14 s), so each card reads cleanly for most of its half second
    const uAt = t => uA - 0.9 + 0.9 * seg(t, T - 0.06, T + 0.24, E.outQuint) + (uB - uA) * seg(t, T + 0.43, T + 0.57, E.ioQ) + 1.4 * seg(t, T + 0.78, T + 1.06, E.inQ);
    const REFL = `below ${10 * U}px linear-gradient(transparent 64%, rgba(255,255,255,.2))`;
    const mb = motionBlur();
    flow.style.filter = mb.url;
    return (t) => {
      const u = uAt(t), du = (uAt(t) - uAt(t - 1 / 60)) * 60;
      const burst = seg(t, T - 0.06, T + 0.16, E.outQuint);
      tf(flow, { s: (0.35 + 0.65 * burst) * beatPulse(t, T), o: seg(t, T - 0.06, T - 0.02) });
      mb.set(Math.min(6, Math.abs(du) * cw * 0.003), 0);
      flow.style.filter = (1 - burst) > 0.02 ? `blur(${((1 - burst) * 14).toFixed(1)}px)` : (Math.abs(du) > 0.3 ? mb.url : 'none');
      // glow takes the colour of the card in front
      const ci = clamp(Math.round(u), 0, nC - 1);
      glow.style.background = `radial-gradient(${P ? '80% 42%' : '55% 60%'} at ${(BC[0] / W * 100).toFixed(1)}% ${(fy / H * 100).toFixed(1)}%, rgba(${els[ci].rgb},.34) 0%, rgba(${els[ci].rgb},.1) 42%, rgba(${els[ci].rgb},0) 72%)`;
      glow.style.opacity = (seg(t, T - 0.02, T + 0.1) * (0.85 + 0.15 * Math.sin(t * Math.PI * 2))).toFixed(3);
      for (const c of els) {
        const d = c.j - u, ad = Math.abs(d), sd = Math.sign(d);
        // cards beyond the second neighbour are not painted; the reflection only on the front three (paint cost)
        c.box.style.display = ad > 2.1 ? 'none' : '';
        if (ad > 2.1) continue;
        const rf = ad < 1.6 ? REFL : 'none';
        if (rf !== c.refl) { c.box.style.webkitBoxReflect = rf; c.refl = rf; }
        const x = sd * (Math.min(ad, 1) * sp1 + Math.max(0, ad - 1) * sp2);
        const ry = -clamp(d, -1, 1) * 52, s = 1 - 0.2 * Math.min(ad, 1), zz = -Math.min(ad, 2) * 160 * U;
        c.box.style.transform = `perspective(${1700 * U}px) translate3d(${x.toFixed(1)}px,0px,${zz.toFixed(1)}px) rotateY(${ry.toFixed(2)}deg) scale(${s.toFixed(4)})`;
        c.box.style.zIndex = String(100 - Math.round(ad * 10));
        c.box.style.opacity = (1 - clamp((ad - 1.5) / 0.6)).toFixed(3);
        c.dim.style.opacity = (0.5 * Math.min(ad, 1.4) / 1.4).toFixed(3);
        // glint as a card lands in front
        const lands = [T + 0.2, T + 0.57];
        let gp = -1; for (const tl of lands) { const p = seg(t, tl - 0.02, tl + 0.28, E.ioQ); if (p > 0 && p < 1 && ad < 0.3) gp = p; }
        c.gl.style.display = gp >= 0 ? '' : 'none';
        if (gp >= 0) c.band.style.left = ((-0.3 + 1.4 * gp) * 100).toFixed(1) + '%';
      }
    };
  }, { z: 27 });

  // pixel-block dissolve 83 → 84: a diagonal front of gold/dark pixels; behind it the roads cut is revealed
  // (the roads layer is clipped to the swept half-plane, the blocks hide the straight edge)
  scene('mont_wipe', WAVE0, WAVE1 + 0.01, (Lr) => {
    const cv = el('canvas', 'fill', Lr); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
    const c = (P ? 80 : 72) * U, cols = Math.ceil(W / c), rows = Math.ceil(H / c), bw = 0.13;
    const cells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      cells.push({ x: x * c, y: y * c, dc: ((x + 0.5) * c / W + (y + 0.5) * c / H) / 2, a: 0.45 + 0.55 * hash(i, 601), b: 0.4 + 0.6 * hash(i, 602), g: hash(i, 603) });
    }
    return (t) => {
      ctx.clearRect(0, 0, W, H);
      const f = waveF(t);
      for (const q of cells) {
        const lo = q.dc - bw * q.a, hi = q.dc + bw * q.b;
        if (f < lo || f > hi) continue;
        const age = (f - lo) / (hi - lo);
        ctx.fillStyle = age < 0.18 ? '#f5d47e' : (q.g < 0.22 ? `rgba(238,188,78,${(0.95 - 0.5 * age).toFixed(3)})` : (q.g < 0.5 ? '#1c2130' : '#0d1017'));
        ctx.fillRect(q.x, q.y, c + 0.5, c + 0.5);
        if (q.g >= 0.22) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(q.x, q.y, c, Math.max(1, 3 * U)); }
      }
    };
  }, { z: 36 });

  // ======================= 84 🛡 ROADS TO CAERLEON + 85 ⚔️ BANDIT ASSAULT =======================
  const N5 = pick('mont_roads') || N4 || N3;
  function halfPlane(f) {
    const g = 2 * f;
    if (g <= 0) return 'polygon(0px 0px, 0px 0px, 0px 0px)';
    if (g >= 2) return 'none';
    if (g <= 1) return `polygon(0px 0px, ${(g * W).toFixed(1)}px 0px, 0px ${(g * H).toFixed(1)}px)`;
    return `polygon(0px 0px, ${W}px 0px, ${W}px ${((g - 1) * H).toFixed(1)}px, ${((g - 1) * W).toFixed(1)}px ${H}px, 0px ${H}px)`;
  }
  // 84: the section in context: the header's "🛡 Roads to Caerleon · BETA" row (with the whole header on 1:1), the
  // section bar with Roads lit (phone / square), the status line, the task, the bandit-windows card and the title row
  // of the killboard card, cut above its body (a skeleton or an error while the killboard host is unreachable; the live
  // table otherwise). The framing is fixed (no edge ever runs through a line); the window itself drifts in.
  scene('mont_roads', WAVE0, 85.0, (Lr) => {
    const T = 84, n = N5;
    if (!n) return () => {};
    const r0 = first(n, 'roads'), r1 = vis(rectsOf(n, 'roads')[1], n), st = first(n, 'status'), hdr = first(n, 'header'), rail = railOf(n, 'Roads'), view = first(n, 'view');
    let box = BOX, c;
    if (r0) {
      // header rows: phone title row ~50 css px above the section bar; desktop title sits in the first header row
      const top = P ? (rail ? rail[1] - 50 : (st ? st[1] - 8 : r0[1] - 90)) : S ? 0 : (hdr ? hdr[1] + 12 : (st ? st[1] - 8 : r0[1] - 70));
      // killboard card: its title row (+ the Refresh button that wraps under it on the phone)
      const bot = r1 ? r1[1] + (P ? 61 : 41) : r0[1] + r0[3] + 8;
      // phone: the page width; square: up to the Lite/Pro toggle (before "← Sections"); desktop: the card's text column
      // up to the gap between the "🛡 Roads to Caerleon · BETA" title and the toggle
      const x0 = L ? r0[0] - 10 : 0;
      const x1 = P ? PW : S ? Math.min(PW, view ? view[0] + view[2] + 6 : Math.max(r0[0] + r0[2], rail ? rail[0] + rail[2] : 0) + 20) : (view && view[0] > x0 + 400 ? view[0] - 4 : x0 + r0[2] * 0.9);
      const z = BOX.w / (x1 - x0), h = Math.min(BOX.h, (bot - top) * z);
      box = { x: BOX.x, y: BC[1] - h / 2, w: BOX.w, h };
      c = camIn(n, box, x0 + box.w / 2 / z, top + h / 2 / z, z);
    } else {
      // no roads capture (fallback state): the top of the section, snapped to a gap
      const sb = staleBox(n, uni([first(n, 'status'), first(n, 'task')]));
      box = sb.box; c = snapTop(n, box, sb.cam);
    }
    const sh = Shot(Lr, n, box, LBL[4].rgb);
    sh.set(c);
    return (t) => {
      Lr.style.clipPath = t < WAVE1 ? halfPlane(waveF(t)) : 'none';
      const p = seg(t, WAVE0, T + 0.95, E.outQ), o = seg(t, T + 0.84, T + 1.0, E.inE);
      sh.pose({ rx: (L ? 0.6 : 1) * lerp(16, 6, p), ry: (L ? -1.1 : P ? -0.6 : -0.9) * lerp(18, 8, p), r: L ? 0 : -1.2, s: lerp(0.9, 1, p) * (1 + 0.55 * o) * beatPulse(t, T), blur: o * 10, bright: 1 + 0.8 * o });
    };
  }, { z: 28 });

  // 85: a crop window on the bandit-windows card ONLY (nothing else of the page can show), clear of the label:
  // a full-bleed band under the label (9:16, 1:1) / right of the label column (16:9); the camera scans along its lines
  // (title -> launch windows -> the red hours) and drifts down through it
  scene('mont_bandit', 85.0, 86.0, (Lr) => {
    const T = 85, n = N5;
    if (!n) return () => {};
    let r = first(n, 'roads') || first(n, 'task') || first(n, 'status');
    if (!r) return () => {};
    r = [r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4];   // inside the card's border
    const z = P ? W / (r[2] * 0.6) : S ? W / (r[2] * 0.42) : W * 0.55 / (r[2] * 0.39);
    const bw = L ? W * 0.55 : W, bh = Math.min(H * (P ? 0.6 : 0.5), r[3] * z);
    const win = { x: L ? W * 0.45 : 0, w: bw, y: (L ? H * 0.5 : H * (P ? 0.6 : 0.62)) - bh / 2, h: bh };
    const sh = Shot(Lr, n, win, LBL[5].rgb, { flat: true, radius: 0 });
    // soft fades at both ends: the band is a deliberate macro crop (its lines run on past both edges)
    const edge = L ? 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,.35) 5%, #000 15%, #000 85%, rgba(0,0,0,.35) 95%, transparent 100%)'
      : 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,.35) 4%, #000 13%, #000 87%, rgba(0,0,0,.35) 96%, transparent 100%)';
    sh.scr.frame.style.webkitMaskImage = edge; sh.scr.frame.style.maskImage = edge;
    // red danger rules along the band
    const rules = [win.y, win.y + win.h].map(y => el('div', 'abs', sh.rig, { left: win.x + 'px', top: y - 1.5 * U + 'px', width: win.w + 'px', height: 3 * U + 'px',
      background: 'linear-gradient(90deg, rgba(228,111,97,0) 0%, rgba(228,111,97,.95) 12%, #f08a6e 50%, rgba(228,111,97,.95) 88%, rgba(228,111,97,0) 100%)', boxShadow: '0 0 22px rgba(228,80,60,.75)', transformOrigin: '0 50%' }));
    // scan: from the card's left edge to just past the red hours (phone: the whole card), drifting down while closing in
    const visW = win.w / z, pan = Math.max(0, P ? r[2] - visW : Math.min(r[2] - visW, 0.71 * r[2] - visW));
    const c0 = camR(r, win, r[0] + visW / 2, r[1], z), c1 = camR(r, win, r[0] + pan + visW / 2, r[1] + r[3], z * 1.06);
    const red = el('div', 'fill', Lr, { background: 'radial-gradient(70% 55% at 100% 100%, rgba(200,30,30,.28) 0%, rgba(200,30,30,0) 70%)', mixBlendMode: 'screen' });
    el('div', 'fill', Lr, { background: 'radial-gradient(110% 80% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,.5) 100%)' });
    FX.flash(T, 0.22, 0.06);
    return (t) => {
      const a = seg(t, T, T + 0.16, E.outE), b = seg(t, T + 0.82, T + 1.0, E.inC), p = seg(t, T, T + 0.95, E.ioQ);
      // the zoom changes the window's page height, so the clamp to the card is redone every frame
      const zc = Math.exp(lerp(Math.log(c0[2]), Math.log(c1[2]), p));
      sh.set(camR(r, win, lerp(c0[0], c1[0], p), lerp(c0[1], c1[1], p), zc));
      sh.pose({ s: lerp(1.4, 1, a) * beatPulse(t, T), r: lerp(-5, -1.8, a), x: b * W * 1.25, bx: b * 110, blur: (1 - a) * 7, bright: 1 + 0.5 * (1 - a) });
      rules.forEach(e => { e.style.transform = `scaleX(${Math.max(0.001, seg(t, T + 0.02, T + 0.22, E.outC)).toFixed(3)})`; });
      red.style.opacity = (0.6 + 0.4 * Math.sin(t * Math.PI * 4)).toFixed(3);
    };
  }, { z: 29 });

  // ======================= 86 🧮 CALCULATOR =======================
  // two crop windows of the calculator card, each the card's full width (nothing runs past their edges): (A) the item
  // header + the materials table + the materials line under it, (B) the populated "I sell / Quality / Price / Sale price
  // / Qty" row, its note and the result row (Invest 576 …). The card's lines between and under them (the red "No market
  // price…" warning shown while prices are missing, the untranslated per-piece breakdown at the bottom of the result
  // box) stay outside both windows. Offsets are css px from the card's own rects, measured on the captures (the same
  // card CSS in every layout): the materials line ends ~53 px above the selects row, the "Cost per piece" line starts
  // ~44 px above it, the red warning sits 28..19 px above it; the breakdown starts 29 px (phone: 47 px) above the result
  // box's bottom, the result numbers end 50 px (phone: 66 px) above it.
  const N7 = pick('mont_calc', 'mont_calc_search') || N5;
  scene('mont_calc', 85.96, 87.0, (Lr) => {
    const T = 86, n = N7;
    if (!n) return () => {};
    const calc = first(n, 'calc'), out = first(n, 'calcOut'), sel = rectsOf(n, 'calcSelects').map(r => vis(r, n)).filter(Boolean);
    const rgb = LBL[6].rgb;
    if (calc && out && sel.length) {
      const selTop = Math.min(...sel.map(r => r[1]));
      const x0 = Math.max(0, calc[0] - 6), x1 = Math.min(PW, calc[0] + calc[2] + 6);
      // (phone: the page's floating Settings button sits on the result box; window B ends above it)
      const setB = rectsOf(n, 'settings').filter(r => r[1] > selTop && r[1] < out[1] + out[3] && r[0] < x1 && r[0] + r[2] > x0).map(r => r[1] - 2);
      const rA = [x0, Math.max(0, calc[1] - 8), x1 - x0, 0], rB = [x0, selTop - 12, x1 - x0, 0];
      rA[3] = selTop - 65 - rA[1];
      rB[3] = Math.min(out[1] + out[3] - (P ? 58 : 37), ...setB) - rB[1];
      const z = BOX.w / rA[2], gap = (P ? 44 : 30) * U;
      const hA = rA[3] * z, hB = rB[3] * z, tot = hA + gap + hB, k = Math.min(1, BOX.h * 0.96 / tot);
      // (if the pair is taller than the panel zone, both windows shrink together, still full width of the card)
      const zz = z * k, wW = rA[2] * zz, xW = BC[0] - wW / 2, yA = BC[1] - (hA + gap + hB) * k / 2;
      const boxA = { x: xW, y: yA, w: wW, h: hA * k }, boxB = { x: xW, y: yA + (hA + gap) * k, w: wW, h: hB * k };
      const shA = Shot(Lr, n, boxA, rgb), shB = Shot(Lr, n, boxB, rgb);
      shA.set([rA[0] + rA[2] / 2, rA[1] + rA[3] / 2, zz]); shB.set([rB[0] + rB[2] / 2, rB[1] + rB[3] / 2, zz]);
      return (t) => {
        // A whips in from the left with the 3D swing, B follows from the right a beat-fraction later; both leave upward
        const a = seg(t, T - 0.04, T + 0.14, E.outQuint), sw = spring(t - T + 0.04, 2.6, 0.5);
        const a2 = seg(t, T + 0.06, T + 0.24, E.outQuint), sw2 = spring(t - T - 0.06, 2.6, 0.5);
        const b = seg(t, T + 0.82, T + 1.0, E.inC), g = 1 + 0.03 * seg(t, T + 0.1, T + 0.9, E.outQ);
        shA.pose({ x: -(1 - a) * W * 0.95, ry: lerp(-42, L ? -6 : -4, sw), rx: 4, y: -b * H * 1.2, bx: (1 - a) * 110, by: b * 120, s: beatPulse(t, T) * g, bright: 1 + 0.2 * (1 - a) });
        shB.pose({ x: (1 - a2) * W * 0.95, ry: lerp(42, L ? -6 : -4, sw2), rx: 4, y: -b * H * 1.2, bx: (1 - a2) * 110, by: b * 120, s: beatPulse(t, T) * g, bright: 1 + 0.2 * (1 - a2), o: t >= T + 0.06 ? 1 : 0 });
      };
    }
    // no calculator card in the capture: the section's populated top, full width
    const sb = staleBox(n, uni([first(n, 'status'), first(n, 'task'), first(n, 'q') || first(n, 'search')]));
    const sh = Shot(Lr, n, sb.box, rgb), c0 = snapTop(n, sb.box, sb.cam);
    sh.set(c0);
    return (t) => {
      const a = seg(t, T - 0.04, T + 0.14, E.outQuint), sw = spring(t - T + 0.04, 2.6, 0.5), b = seg(t, T + 0.82, T + 1.0, E.inC);
      sh.pose({ x: -(1 - a) * W * 0.95, ry: lerp(-42, L ? -6 : -4, sw), rx: 4, y: -b * H * 1.2, bx: (1 - a) * 110, by: b * 120, s: beatPulse(t, T) * (1 + 0.05 * seg(t, T + 0.08, T + 0.9, E.outQ)), bright: 1 + 0.2 * (1 - a) });
    };
  }, { z: 30 });

  // ======================= 87 9 LANGUAGES: slot reel through the real hero captures =======================
  const CODES = ['en', 'ru', 'es', 'de', 'fr', 'pl', 'pt', 'it', 'tr'].filter(c => has('lang_' + c));
  const LAND0 = 87.06, FLIPD = [0.115, 0.105, 0.095, 0.088, 0.08, 0.074, 0.068, 0.062];
  const FLIPS = []; { let s = LAND0; for (let k = 1; k < CODES.length; k++) { s += FLIPD[(k - 1) % FLIPD.length]; FLIPS.push(s); } }
  const reelPos = t => (t < LAND0 ? lerp(-1.7, 0, seg(t, 86.96, LAND0, E.outQuint)) : FLIPS.reduce((a, s) => a + seg(t, s - 0.034, s, E.outQ), 0));
  scene('mont_lang', 86.9, 88.0, (Lr) => {
    const root = el('div', 'fill', Lr, { transformOrigin: `${W / 2}px ${H / 2}px` });
    const lab = Label(root, 7);
    // the code row: EN RU ES ... (the active language lights up)
    const cs = (P ? 46 : S ? 34 : 40) * U;
    const row = el('div', 'abs', root, { width: '0px', height: '0px' });
    const spans = CODES.map(c => { const s = el('span', 'px', null, { display: 'inline-block', margin: `0 ${0.32 * cs}px`, color: '#dde2ec', transformOrigin: '50% 60%' }); s.textContent = c.toUpperCase(); return s; });
    const rowIn = el('div', 'abs px', row, { fontSize: cs + 'px', whiteSpace: 'nowrap', lineHeight: 1 }); spans.forEach(s => rowIn.appendChild(s));
    const rowW = rowIn.offsetWidth; rowIn.style.left = -rowW / 2 + 'px'; rowIn.style.top = -cs / 2 + 'px';
    // (9:16 / 1:1: clear of the gold rule under the label)
    const rowY = L ? lab.cy + lab.h / 2 + 90 * U : lab.cy + lab.h / 2 + (P ? 56 : 44) * U + 0.3 * lab.sz;
    row.style.left = LZ.cx + 'px'; row.style.top = rowY + 'px';
    if (!CODES.length) return (t) => { lab.set(t); applyCollapse(root, t); };
    const NL = CODES.map(c => 'lang_' + c);
    // the hero: the anvil logo (it sits above the title: ~84 css px on the phone layout, ~110 on the wide ones),
    // the title, the server line, the lead and the two buttons
    let R = uni(NL.flatMap(n => ['title', 'sub', 'lead', 'go'].map(k => rectsOf(n, k)[0])));
    const tY = Math.min(...NL.map(n => (rectsOf(n, 'title')[0] || [0, 1e9])[1]));
    R = R ? grow(R, 30, 22) : [0, VH * 0.1, PW, VH * 0.3];
    if (tY < 1e9) R = [R[0], tY - (P ? 84 : 110), R[2], R[1] + R[3] - (tY - (P ? 84 : 110))];
    R = [Math.max(0, R[0]), Math.max(0, R[1]), Math.min(PW, R[0] + R[2]) - Math.max(0, R[0]), Math.min(VH, R[1] + R[3]) - Math.max(0, R[1])];
    const k = Math.min(BOX.w * (L ? 0.96 : 1) / R[2], BOX.h / (R[3] * 1.6)), cw = R[2] * k, ch = R[3] * k;
    const vh = Math.min(BOX.h, ch * 1.8), gap = 26 * U, pitch = ch + gap;
    const mo = clamp(0.5 - ch / 2 / vh - 0.01, 0.04, 0.24), mk = `linear-gradient(180deg, rgba(0,0,0,0) 0%, #000 ${(mo * 100).toFixed(1)}%, #000 ${(100 - mo * 100).toFixed(1)}%, rgba(0,0,0,0) 100%)`;
    const win = el('div', 'abs', root, { left: BC[0] - cw / 2 + 'px', top: BC[1] - vh / 2 + 'px', width: cw + 'px', height: vh + 'px', WebkitMaskImage: mk, maskImage: mk });
    const reel = el('div', 'abs', win, { width: cw + 'px', height: vh + 'px' });
    const cards = NL.map((n, j) => CropBox(reel, n, R, k, { left: '0px', top: (vh - ch) / 2 + 'px', borderRadius: 22 * U + 'px', boxShadow: `0 0 0 ${Math.max(1, 1.5 * U)}px rgba(60,70,98,.95), 0 30px 80px rgba(0,0,0,.6)` }));
    // the slot window frame (gold rails above and below the active card)
    const railY = [BC[1] - ch / 2 - gap / 2, BC[1] + ch / 2 + gap / 2];
    const rails = railY.map(y => el('div', 'abs', root, { left: BC[0] - cw * 0.55 + 'px', top: y - 2 * U + 'px', width: cw * 1.1 + 'px', height: 4 * U + 'px', background: 'linear-gradient(90deg, rgba(238,188,78,0), #f5d47e 20%, #eebc4e 80%, rgba(238,188,78,0))', boxShadow: '0 0 18px rgba(238,188,78,.7)', transformOrigin: '50% 50%' }));
    const halo = el('div', 'abs', root, { left: BC[0] - cw * 0.8 + 'px', top: BC[1] - ch * 1.1 + 'px', width: cw * 1.6 + 'px', height: ch * 2.2 + 'px', background: 'radial-gradient(50% 50% at 50% 50%, rgba(238,188,78,.22) 0%, rgba(238,188,78,0) 70%)' });
    root.insertBefore(halo, root.firstChild);
    const mb = motionBlur();
    reel.style.filter = mb.url;
    return (t) => {
      const pos = reelPos(t), v = (reelPos(t) - reelPos(t - 1 / 90)) * 90;
      mb.set(0, Math.min(70, Math.abs(v) * pitch * 0.006));
      reel.style.filter = Math.abs(v) > 0.2 ? mb.url : 'none';
      cards.forEach((c, j) => {
        const d = j - pos, ad = Math.abs(d);
        c.style.display = ad < 1.6 ? '' : 'none';
        if (ad >= 1.6) return;
        tf(c, { y: d * pitch, s: 1 - 0.06 * Math.min(ad, 1), bright: 1 - 0.55 * Math.min(ad, 1) });
      });
      const ai = clamp(Math.round(pos), 0, CODES.length - 1);
      spans.forEach((s, j) => {
        const on = j === ai && t >= LAND0 - 0.02;
        s.style.color = on ? '#f5d47e' : '#dde2ec';
        s.style.opacity = on ? 1 : (j < ai ? 0.6 : 0.28);
        s.style.textShadow = on ? '0 0 18px rgba(238,188,78,.8)' : 'none';
        s.style.transform = on ? 'scale(1.3)' : 'none';
      });
      halo.style.opacity = seg(t, 86.96, 87.04).toFixed(3);
      const ri = seg(t, 86.98, 87.1, E.outC);
      let tick = 0; for (const s of [LAND0, ...FLIPS]) if (t >= s) tick = Math.exp(-(t - s) / 0.05);
      rails.forEach(r => tf(r, { sx: Math.max(0.001, ri), sy: 1 + 1.2 * tick, bright: 1 + 1.4 * tick }));
      tf(row, { y: (1 - spring(t - 87.0, 3, 0.55)) * 20 * U, o: seg(t, 87.0, 87.05) });
      tf(win, { y: (1 - seg(t, 86.96, 87.06, E.outQuint)) * H * 0.25, o: seg(t, 86.96, 86.99) });
      lab.set(t);
      applyCollapse(root, t);
    };
  }, { z: 31 });

  // ======================= labels for cuts 1-7 (stamped on the hits) =======================
  scene('mont_lbl', 80.0, 86.95, (Lr) => {
    const labs = [0, 1, 2, 3, 4, 5, 6].map(i => Label(Lr, i));
    // exit of each label, in step with its cut's transition
    const EX = [
      t => { const b = seg(t, 80.8, 80.93, E.inC); return { x: -b * W * 0.7, o: 1 - seg(t, 80.87, 80.93), blur: b * 6 }; },
      t => { const b = seg(t, 81.8, 81.93, E.inQ); return { x: b * W * 0.5, o: 1 - seg(t, 81.86, 81.93) }; },
      t => { const b = seg(t, 82.8, 82.93, E.inC); return { s: 1 + 1.4 * b, o: 1 - seg(t, 82.85, 82.93), blur: b * 10 }; },
      t => { const b = seg(t, 83.82, 83.93, E.inQ); return { s: 1 - 0.1 * b, o: 1 - b }; },
      t => { const b = seg(t, 84.8, 84.93, E.inE); return { s: 1 + 0.5 * b, o: 1 - seg(t, 84.86, 84.93) }; },
      t => { const b = seg(t, 85.8, 85.93, E.inC); return { x: b * W * 0.7, o: 1 - seg(t, 85.87, 85.93), blur: b * 6 }; },
      t => { const b = seg(t, 86.8, 86.93, E.inC); return { y: -b * H * 0.5, o: 1 - seg(t, 86.87, 86.93), blur: b * 6 }; },
    ];
    return (t) => { labs.forEach((lb, i) => lb.set(t, EX[i](t))); };
  }, { z: 38 });

  // ======================= cut flashes + the final pull into a bright point =======================
  for (const T of CUT) if (T !== 85) FX.flash(T, T === 80 ? 0.2 : 0.13, 0.05);
  scene('mont_fx', 86.9, 88.0, (Lr) => {
    const cv = el('canvas', 'fill', Lr); cv.width = Math.ceil(W / 2); cv.height = Math.ceil(H / 2); const ctx = cv.getContext('2d');
    const CX = W / 2, CY = H / 2;
    const core = el('div', 'abs', Lr, { left: CX - 500 * U + 'px', top: CY - 500 * U + 'px', width: 1000 * U + 'px', height: 1000 * U + 'px', borderRadius: '50%', mixBlendMode: 'screen',
      background: 'radial-gradient(circle, rgba(255,253,245,1) 0%, rgba(255,236,190,.95) 9%, rgba(245,212,126,.55) 22%, rgba(238,188,78,.18) 42%, rgba(238,188,78,0) 66%)', opacity: 0 });
    const streak = el('div', 'abs', Lr, { left: -W * 0.2 + 'px', top: CY - 4 * U + 'px', width: W * 1.4 + 'px', height: 8 * U + 'px', mixBlendMode: 'screen', opacity: 0,
      background: 'linear-gradient(90deg, rgba(238,188,78,0), rgba(255,246,220,.95) 50%, rgba(238,188,78,0))', boxShadow: '0 0 40px rgba(238,188,78,.9)' });
    const ring = el('div', 'abs', Lr, { left: CX - 500 * U + 'px', top: CY - 500 * U + 'px', width: 1000 * U + 'px', height: 1000 * U + 'px', borderRadius: '50%', boxSizing: 'border-box', border: `${8 * U}px solid rgba(255,236,190,.9)`, boxShadow: '0 0 60px rgba(238,188,78,.8), inset 0 0 40px rgba(238,188,78,.4)', opacity: 0 });
    const white = el('div', 'fill', Lr, { background: '#fff8e8', opacity: 0 });
    const NP = 120;
    return (t) => {
      // embers sucked into the point on the riser
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.globalCompositeOperation = 'lighter';
      const R = Math.hypot(W, H) * 0.55 / 2;
      for (let i = 0; i < NP; i++) {
        const ts = 87.05 + hash(i, 701) * 0.7, te = Math.min(87.985, ts + 0.35 + 0.3 * hash(i, 702));
        if (t < ts || t > te) continue;
        const p = seg(t, ts, te, E.inC), ang = hash(i, 703) * Math.PI * 2 + p * 0.8, r0 = R * (0.6 + 0.6 * hash(i, 704));
        const r = r0 * (1 - p), r2 = r + (20 + 120 * p) * U / 2;
        const x = CX / 2 + Math.cos(ang) * r, y = CY / 2 + Math.sin(ang) * r, x2 = CX / 2 + Math.cos(ang - 0.08) * r2, y2 = CY / 2 + Math.sin(ang - 0.08) * r2;
        ctx.strokeStyle = `rgba(255,${(200 + 50 * hash(i, 705)) | 0},140,${(0.35 + 0.6 * p).toFixed(3)})`; ctx.lineWidth = (1 + 1.6 * hash(i, 706)) * U;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      const ci = seg(t, 87.72, 87.985, E.inQ);
      tf(core, { s: 0.15 + 1.25 * ci, o: ci > 0 ? 0.25 + 0.75 * ci : 0 });
      tf(streak, { sx: 0.05 + 1.1 * ci, o: ci });
      const rp = seg(t, 87.45, COL1, E.inC);
      tf(ring, { s: lerp(2.0, 0.06, rp), o: rp > 0 && rp < 1 ? 0.25 + 0.6 * rp : 0 });
      white.style.opacity = (0.9 * seg(t, 87.9, 87.99, E.inQ)).toFixed(3);
    };
  }, { z: 40 });
})();
