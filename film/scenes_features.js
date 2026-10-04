// FEATURES (32–80 s): three product moments, every UI pixel a REAL capture (whole states or CSS crops of them).
//   01 CRAFTING     32–48  title card → home "Open Crafting →" click → the table pushes in → category chip →
//                          sort by profit (rows fly from their old to their new place, one per tick) → open the top
//                          row → the camera lands on unit cost / sweet spot / full batch on the VO.
//   02 BLACK MARKET 48–64  title card in Caerleon red → home card click → table → Gear chip → sort (re-sort ticks,
//                          column callouts on the VO) → the top item's price card: buy-city row, Black Market row.
//   03 ANY PRICE    64–80  title card → search box click → "mas cap" typed key by key (one capture per key) →
//                          "Master's Cape" → the 7 city rows + Black Market row wipe in on the pops → best price →
//                          "NO SPREADSHEETS. / NO GUESSWORK." flourish.
// States come from the manifest through pick() (first existing, non-stale preferred). A missing state is never
// added (no console warning): the previous state holds, animations that need it are skipped, and the VO words
// that would have pointed at it become kinetic type instead.
(function () {
  const { W, H, U, E, K, seg, spring, clamp, lerp, hash, noise1, el, tf, scene, P, L, S, motionBlur, TL } = FX;
  const { Cursor, cursorPath, PageView, stateInfo, VP, Callout } = FX.lib;

  // ======================= timeline =======================
  const evT = (type, near, tol = 0.3) => { let best = near, d = tol + 1e-9; for (const e of TL.events) if (e.type === type && Math.abs(e.t - near) < d) { d = Math.abs(e.t - near); best = e.t; } return best; };
  const evIn = (type, a, b) => TL.events.filter(e => e.type === type && e.t > a && e.t < b).map(e => e.t).sort((x, y) => x - y);
  const voT = (id, dflt) => ((TL.vo || []).find(v => v.id === id) || { t: dflt }).t;

  // ======================= manifest =======================
  const PW = VP.width, VH = VP.height;
  const ST = n => (n ? stateInfo(n) : null);
  const has = n => !!ST(n);
  const pick = (...ns) => { ns = ns.flat().filter(Boolean); return ns.find(n => has(n) && !ST(n).stale) || ns.find(has) || null; };
  const rectsOf = (n, k) => (((ST(n) || {}).rects || {})[k]) || [];
  const labelsOf = (n, k) => (((ST(n) || {}).labels || {})[k]) || [];
  const keysOf = (n, k) => (((ST(n) || {}).keys || {})[k]) || [];
  const rectOf = (n, k, i = 0) => rectsOf(n, k)[i] || null;
  const itemsOf = (n, k = 'items') => ((ST(n) || {})[k]) || [];
  // size of a state's image in page px (interaction states: the saved strip from the top of the page)
  const imgSize = n => { const s = ST(n); return !s ? [PW, VH] : (s.fullPage ? [s.page[0], s.page[1]] : [VP.width, VP.height]); };
  const stripH = n => imgSize(n)[1];
  const scrollTop = n => (ST(n) ? ST(n).page[3] || 0 : 0);
  // the click that LED to a state ('click', in the previous state's layout) or is ABOUT to happen ('next')
  const actOf = (n, f = 'click') => { const c = (ST(n) || {})[f]; return c && c.type === 'click' && c.at ? c : null; };
  // part of a page rect inside the saved strip (table rows run past the right edge on phones)
  const vis = (r, n) => { if (!r) return null; const x0 = Math.max(0, r[0]), x1 = Math.min(PW, r[0] + r[2]), y0 = Math.max(0, r[1]), y1 = Math.min(stripH(n), r[1] + r[3]); return x1 - x0 > 2 && y1 - y0 > 2 ? [x0, y0, x1 - x0, y1 - y0] : null; };
  function uni(rs) { rs = rs.filter(Boolean); if (!rs.length) return null; const x0 = Math.min(...rs.map(r => r[0])), y0 = Math.min(...rs.map(r => r[1])), x1 = Math.max(...rs.map(r => r[0] + r[2])), y1 = Math.max(...rs.map(r => r[1] + r[3])); return [x0, y0, x1 - x0, y1 - y0]; }
  const ctr = r => [r[0] + r[2] / 2, r[1] + r[3] / 2];
  const grow = (r, a, b = a) => r && [r[0] - a, r[1] - b, r[2] + 2 * a, r[3] + 2 * b];
  const rowRects = (n, k = 'items', max = 8) => { const its = itemsOf(n, k); const rs = (its.length ? its.map(i => i.rect) : rectsOf(n, 'row')).slice(0, max); return rs.map(r => vis(r, n)).filter(Boolean); };
  const thRect = (n, key) => { const ks = keysOf(n, 'th'), rs = rectsOf(n, 'th'); const i = ks.indexOf(key); return i >= 0 ? vis(rs[i], n) : null; };

  // ======================= layout + camera =======================
  // the UI panel: a tall phone panel in 9:16, near-square in 1:1, a wide window in 16:9 (room for side light)
  const BOX = P ? { x: W * 0.07, y: H * 0.1, w: W * 0.86, h: H * 0.82 } : S ? { x: W * 0.075, y: H * 0.095, w: W * 0.85, h: H * 0.83 } : { x: W * 0.1, y: H * 0.1, w: W * 0.8, h: H * 0.82 };
  const ZMAX = P ? 4.4 : S ? 2.7 : 2.9;
  const SAFE = { x0: W * 0.06, x1: W * 0.94, y0: H * 0.06, y1: H * 0.94 };
  // how many page px of width the panel shows for each kind of shot (phones: always the full width)
  // (det: one number line; row: a price-card row's name + first price columns)
  const FW = P ? { sec: PW, rows: PW, det: 410, card: PW, srch: PW, typ: PW, row: PW }
    : S ? { sec: 660, rows: 780, det: 460, card: 760, srch: 600, typ: 540, row: 640 }
    : { sec: 880, rows: 1120, det: 640, card: 1050, srch: 640, typ: 700, row: 700 };
  const TOPFADE = 58 * U;           // dark inner fade under the panel's top edge (the tab sits there)
  const CAMBLUR = 7;                // cap of the camera's own motion blur on text-heavy UI (whooshes blur more)
  const ROWBG = '#151924';          // table background behind rows while they re-sort
  // camera = [cx, cy, z] in page CSS px; never shows past the strip edges
  const zMin = n => Math.max(BOX.w / PW, BOX.h / stripH(n));
  function cam(n, cx, cy, z) {
    z = clamp(z, zMin(n), ZMAX);
    const hw = BOX.w / 2 / z, hh = BOX.h / 2 / z, sh = stripH(n);
    return [PW <= 2 * hw + 0.5 ? PW / 2 : clamp(cx, hw, PW - hw), sh <= 2 * hh + 0.5 ? sh / 2 : clamp(cy, hh, sh - hh), z];
  }
  const zOf = (n, fw) => clamp(BOX.w / fw, zMin(n), ZMAX);
  // page px kept clear above a framed element: the panel's tab + top fade sit there
  const headroom = z => 14 + (TOPFADE * 0.8) / z;
  // view whose top-left corner sits at page (x, y), fw page px wide (y = the first element's top: headroom is added)
  function topLeft(n, x, y, fw) { const z = zOf(n, fw); return cam(n, x - 10 + BOX.w / 2 / z, y - headroom(z) + BOX.h / 2 / z, z); }
  // a (possibly page-wide) row framed fw page px wide: a row wider than the view shows its left part (the name and
  // the first columns), never the whole row at thumbnail size
  function rowShot(n, r, fw, dy = 0) {
    if (!r) return vpCam(n);
    const z = zOf(n, fw), hw = BOX.w / 2 / z;
    const cx = r[2] > 2 * hw * 0.9 ? r[0] - 14 + hw : r[0] + r[2] / 2;
    return cam(n, cx, r[1] + r[3] / 2 + dy, z);
  }
  // the part of page rect r that a camera shows (inset), for marks and glints on wide rows
  function inView(r, c, inset = 8) {
    if (!r || !c) return r;
    const hw = BOX.w / 2 / c[2], x0 = Math.max(r[0], c[0] - hw + inset), x1 = Math.min(r[0] + r[2], c[0] + hw - inset);
    return x1 - x0 > 4 ? [x0, r[1], x1 - x0, r[3]] : r;
  }
  // visible x-range of a set of header columns ('th' keys); null when none of them is visible
  function xSpan(n, keys) { const rs = keys.map(k => thRect(n, k)).filter(Boolean); return rs.length ? [Math.min(...rs.map(r => r[0])), Math.max(...rs.map(r => r[0] + r[2]))] : null; }
  // frame a page rect (padded) inside the panel
  function frame(n, r, pad = 0.14, zCap = ZMAX, ay = 0.5) {
    if (!r) return vpCam(n);
    const z = Math.min(BOX.w / (r[2] * (1 + pad)), BOX.h / (r[3] * (1 + pad)), zCap);
    const zz = clamp(z, zMin(n), ZMAX), hh = BOX.h / 2 / zz;
    const cy = r[1] + r[3] / 2 + (0.5 - ay) * Math.max(0, 2 * hh - r[3] * (1 + pad));
    return cam(n, r[0] + r[2] / 2, cy, zz);
  }
  // what the user saw at capture time
  const vpCam = n => cam(n, PW / 2, scrollTop(n) + VH / 2, zMin(n));
  // keep page point (px,py) inside the view with a screen margin m
  function keep(n, c, px, py, m = 90 * U) {
    if (px == null) return c;
    const z = c[2], hw = Math.max(0, BOX.w / 2 - m) / z, hh = Math.max(0, BOX.h / 2 - m) / z;
    return cam(n, clamp(c[0], px - hw, px + hw), clamp(c[1], py - hh, py + hh), z);
  }
  // slow push-in; on phones the full-width shots zoom about their left edge (the text's left padding stays)
  const zoomed = (n, c, k) => {
    if (!P) return cam(n, c[0], c[1], c[2] * k);
    const z = clamp(c[2] * k, zMin(n), ZMAX);
    return cam(n, c[0] - BOX.w / 2 / c[2] + BOX.w / 2 / z, c[1], z);
  };
  const colOf = n => { const r = rectOf(n, 'task') || rectOf(n, 'status'); return r ? [r[0], r[2]] : [0, PW]; };
  // camera keyframes [[t, cam, ease]] (zoom interpolated in log space); keys are kept in time order
  function track(keys) {
    keys = keys.filter(k => k && k[1]).map((k, i) => [k[0], k[1], k[2], i]).sort((a, b) => a[0] - b[0] || a[3] - b[3]);
    return t => {
      if (t <= keys[0][0]) return keys[0][1];
      for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
        const [t0, a] = keys[i - 1], [t1, b, e] = keys[i];
        const p = (e || E.ioC)(clamp((t - t0) / Math.max(1e-6, t1 - t0)));
        return [lerp(a[0], b[0], p), lerp(a[1], b[1], p), Math.exp(lerp(Math.log(a[2]), Math.log(b[2]), p))];
      }
      return keys[keys.length - 1][1];
    };
  }
  // state cuts [[t, state, crossfade]] → opacity map (newest on top)
  function mixAt(cuts, t) {
    const m = { __top: null }; let cur = -1;
    for (let i = 0; i < cuts.length; i++) if (t >= cuts[i][0]) cur = i;
    if (cur < 0) { if (cuts.length) { m[cuts[0][1]] = 1; m.__top = cuts[0][1]; } return m; }
    const [t0, n, d] = cuts[cur], p = d > 0 ? clamp((t - t0) / d) : 1;
    m[n] = p; m.__top = n;
    if (p < 1 && cur > 0 && cuts[cur - 1][1] !== n) m[cuts[cur - 1][1]] = 1;
    return m;
  }
  const cutsOf = list => list.filter(c => c && has(c[1])).sort((a, b) => a[0] - b[0]);

  // ======================= shared pieces =======================
  // anchor + centred text (DOM-measured)
  function word(parent, html, size, cls, style, z) {
    const a = el('div', 'abs', parent, { width: '0px', height: '0px', zIndex: z == null ? 'auto' : String(z) });
    const e = el('div', 'abs ' + cls, a, Object.assign({ fontSize: size + 'px', whiteSpace: 'nowrap', lineHeight: 1 }, style || {}));
    e.innerHTML = html;
    const w = e.offsetWidth, h = e.offsetHeight;
    e.style.left = -w / 2 + 'px'; e.style.top = -h / 2 + 'px';
    return { a, e, w, h, size };
  }
  function fitDom(parent, html, cls, style, maxW, max) {
    const pr = el('div', 'abs ' + cls, parent, Object.assign({ fontSize: '100px', whiteSpace: 'nowrap', lineHeight: 1, visibility: 'hidden' }, style || {}));
    pr.innerHTML = html; const w = pr.offsetWidth; pr.remove();
    return Math.min(max, maxW * 100 / w);
  }
  const STAR = s => `<svg viewBox="-10 -10 20 20" width="${s}" height="${s}"><path d="M0,-10 L1.4,-1.4 L10,0 L1.4,1.4 L0,10 L-1.4,1.4 L-10,0 L-1.4,-1.4 Z" fill="#fff6dc"/></svg>`;

  // Decoding every big capture at once overflows Chromium's decode budget: img.decode() then rejects although the
  // file is fine (index.html would log 'img failed'). This section's images queue their decode one at a time; an
  // image that is fully loaded but still cannot be pre-decoded is ready all the same (it rasterises on its frame),
  // so only a real load failure rejects.
  const nativeDecode = HTMLImageElement.prototype.decode;
  let decodeQ = Promise.resolve();
  function queuedDecode(im) {
    if (!im) return im;
    im.decode = function () {
      const loaded = () => new Promise((res, rej) => {
        if (im.complete) return im.naturalWidth ? res() : rej(new Error('load failed'));
        im.addEventListener('load', () => res(), { once: true });
        im.addEventListener('error', () => rej(new Error('load failed')), { once: true });
      });
      const job = decodeQ.then(loaded).then(async () => { for (let k = 0; k < 3; k++) { try { await nativeDecode.call(im); return; } catch (e) { /* budget: retry, then rasterise on the frame */ } } });
      decodeQ = job.catch(() => {});
      return job;
    };
    return im;
  }
  // a crop of a state's image (page rect r) at its own page position inside the PageView. Crops paint the state's
  // image as a CSS background, so each capture is decoded once (one hidden <img> per file keeps it in the load wait).
  const preloaded = new Set();
  let preHost = null;
  function preload(src) {
    if (preloaded.has(src)) return;
    preloaded.add(src);
    if (!preHost) preHost = el('div', 'abs', document.getElementById('stage'), { width: '1px', height: '1px', overflow: 'hidden', opacity: 0, left: '-10px', top: '-10px' });
    const im = el('img', '', preHost, { width: '1px', height: '1px' }); im.src = src;
    queuedDecode(im);
  }
  // (o = page origin of the parent when it is a positioned wrapper inside the PageView)
  function Crop(parent, n, r, z = 3, o = [0, 0]) {
    const s = ST(n), [iw, ih] = imgSize(n);
    preload(s.img);
    const w = el('div', 'abs', parent, { left: (r[0] - o[0]) + 'px', top: (r[1] - o[1]) + 'px', width: r[2] + 'px', height: r[3] + 'px', overflow: 'hidden', opacity: 0, zIndex: z, transformOrigin: '50% 50%',
      backgroundImage: `url("${s.img}")`, backgroundRepeat: 'no-repeat', backgroundSize: `${iw}px ${ih}px`, backgroundPosition: `${-r[0]}px ${-r[1]}px` });
    return { w, r };
  }
  // cut page rect h (e.g. the site's floating Settings button) out of a crop, so it does not travel with the crop
  function hole(c, h) {
    if (!c || !h) return;
    const r = c.r, x0 = h[0] - r[0], y0 = h[1] - r[1];
    if (x0 >= r[2] || y0 >= r[3] || x0 + h[2] <= 0 || y0 + h[3] <= 0) return;
    c.w.style.clipPath = `path(evenodd, 'M0 0 H${r[2].toFixed(1)} V${r[3].toFixed(1)} H0 Z M${x0.toFixed(1)} ${y0.toFixed(1)} h${h[2].toFixed(1)} v${h[3].toFixed(1)} h${(-h[2]).toFixed(1)} Z')`;
  }

  // the UI panel: real-screenshot viewer + glow + tab + screen-space overlays + cursor
  function Panel(Lr, num, name, rgb) {
    const tilt = el('div', 'fill', Lr, { transformOrigin: `${((BOX.x + BOX.w / 2) / W * 100).toFixed(1)}% ${((BOX.y + BOX.h / 2) / H * 100).toFixed(1)}%` });
    const halo = el('div', 'abs', tilt, { left: BOX.x - 160 * U + 'px', top: BOX.y - 160 * U + 'px', width: BOX.w + 320 * U + 'px', height: BOX.h + 320 * U + 'px', background: `radial-gradient(50% 50% at 50% 50%, rgba(${rgb},.20) 0%, rgba(${rgb},.07) 45%, rgba(${rgb},0) 72%)` });
    const view = PageView(tilt, BOX, { radius: 30 * U });
    view.frame.style.boxShadow = `0 50px 140px rgba(0,0,0,.72), 0 0 0 ${Math.max(1, 1.5 * U)}px rgba(60,70,98,.95), 0 0 70px rgba(${rgb},.16)`;
    view.inner.style.width = PW + 'px';
    // glass rim light on the panel edge
    const rim = el('div', 'abs', tilt, { left: BOX.x + 'px', top: BOX.y + 'px', width: BOX.w + 'px', height: BOX.h + 'px', borderRadius: 30 * U + 'px', zIndex: 4, pointerEvents: 'none',
      boxShadow: `inset 0 ${2 * U}px 0 rgba(255,255,255,.07), inset 0 0 0 ${Math.max(1, U)}px rgba(255,255,255,.035)` });
    const imgs = {};
    const add = n => { if (!n || !has(n)) return null; if (!imgs[n]) { imgs[n] = queuedDecode(view.add(n)); preloaded.add(ST(n).img); } return imgs[n]; };
    // overlays clipped to the panel (marks, glints) and unclipped ones (callouts, cursor)
    const clipL = el('div', 'abs', tilt, { left: BOX.x + 'px', top: BOX.y + 'px', width: BOX.w + 'px', height: BOX.h + 'px', overflow: 'hidden', borderRadius: 30 * U + 'px', zIndex: 5 });
    // dark inner fade under the top edge: whatever text the camera's top cuts through sinks under the tab
    el('div', 'abs', clipL, { left: '0px', top: '0px', width: BOX.w + 'px', height: TOPFADE + 'px', background: 'linear-gradient(180deg, rgba(11,13,18,.94) 0%, rgba(11,13,18,.6) 48%, rgba(11,13,18,0) 100%)' });
    const free = el('div', 'fill', tilt, { zIndex: 7 });
    // the tab: "01  CRAFTING" sitting on the panel's top edge
    const tagS = (P ? 32 : S ? 24 : 24) * U;
    const tag = el('div', 'abs px', tilt, { fontSize: tagS + 'px', color: '#eef1f6', background: 'rgba(16,19,28,.94)', border: `${Math.max(1, 1.5 * U)}px solid rgba(${rgb},.55)`, borderRadius: tagS * 0.5 + 'px',
      padding: `${tagS * 0.34}px ${tagS * 0.62}px ${tagS * 0.26}px`, boxShadow: `0 10px 30px rgba(0,0,0,.55), 0 0 24px rgba(${rgb},.18)`, zIndex: 6, letterSpacing: '.06em' });
    tag.innerHTML = `<span style="color:rgb(${rgb})">${num}</span>&nbsp;&nbsp;${name}`;
    const tagW = tag.offsetWidth, tagH = tag.offsetHeight;
    tag.style.left = BOX.x + 34 * U + 'px'; tag.style.top = BOX.y - tagH / 2 + 'px';
    const cur = Cursor(free, (P ? 62 : 50) * U);
    const mb = motionBlur();
    let c = [PW / 2, VH / 2, 1];
    const pn = {
      tilt, halo, view, imgs, add, clipL, free, cur, mb, tag, tagW, tagH, rim,
      get c() { return c; },
      setCam(cc) { c = cc; view.setCam(cc[0], cc[1], cc[2]); },
      scr(px, py, cc = c) { return [BOX.x + BOX.w / 2 + (px - cc[0]) * cc[2], BOX.y + BOX.h / 2 + (py - cc[1]) * cc[2]]; },
      scrR(r, cc = c) { if (!r) return null; const [x, y] = pn.scr(r[0], r[1], cc); return [x, y, r[2] * cc[2], r[3] * cc[2]]; },
      mix(map) { for (const n in imgs) { imgs[n].style.opacity = (map[n] || 0).toFixed(3); imgs[n].style.zIndex = map.__top === n ? 2 : 1; } },
      // whoosh in / out + gentle 3D drift (amt 0..1) — screen-space overlays live inside `tilt`, so they stay registered
      // page changes are hard cuts on the click frame; each gets a small scale punch of the whole panel
      punches: [],
      pose(t, tIn, tOut, amt) {
        const a = seg(t, tIn + 0.1, tIn + 0.56, E.outQuint), b = seg(t, tOut, tOut + 0.5, E.inQ);
        const drift = amt * (1 - b);
        const rx = 22 * (1 - a) - 16 * b + drift * (3.2 + 1.4 * Math.sin(t * 0.9)), ry = drift * ((L ? -7 : -5) + 2 * Math.sin(t * 0.7 + 1));
        let punch = 1;
        for (const [tc, k] of pn.punches) if (t >= tc && t < tc + 0.5) punch = 1 + k * Math.exp(-(t - tc) / 0.07);
        tf(tilt, { y: (1 - a) * H * 0.95 - b * H * 1.05, s: (0.88 + 0.12 * a) * (1 + 0.06 * b) * punch, rx, ry, persp: 2600 * U, o: clamp(a * 3) * (1 - seg(t, tOut + 0.3, tOut + 0.5)) });
        pn.wb = (1 - a) * 46 + b * 50;
        pn.blur(0, 0);
      },
      // directional blur of the panel: the whoosh (vertical) plus the camera's own speed (camF(t) vs camF(t - 1/30)),
      // the latter capped low so text stays legible through camera moves
      blur(bx, by) {
        const x = Math.min(CAMBLUR, bx), y = Math.max(pn.wb || 0, Math.min(CAMBLUR, by));
        view.frame.style.filter = x > 1.2 || y > 1.2 ? mb.url : 'none';
        mb.set(x > 1.2 ? x : 0, y > 1.2 ? y : 0);
      },
      camBlur(camF, t) {
        const c1 = camF(t), c0 = camF(t - 1 / 30);
        const dx = (c1[0] - c0[0]) * c1[2], dy = (c1[1] - c0[1]) * c1[2], dz = Math.abs(Math.log(c1[2] / c0[2])) * Math.min(BOX.w, BOX.h) * 0.5;
        pn.blur(Math.abs(dx) * 0.2 + dz * 0.1, Math.abs(dy) * 0.2 + dz * 0.1);
      },
    };
    return pn;
  }

  // gold outline that frames a target (screen rect), clipped to the panel
  function Mark(pn, rgb = '245,212,126') {
    const e = el('div', 'abs', pn.clipL, { border: `${Math.max(2, 3 * U)}px solid rgb(${rgb})`, borderRadius: 10 * U + 'px', boxShadow: `0 0 26px rgba(${rgb},.55), inset 0 0 18px rgba(${rgb},.18)`, opacity: 0, transformOrigin: '50% 50%' });
    return { e, set(r, o, s = 1, pad = 7 * U) {
      if (!r || o <= 0.002) { e.style.opacity = 0; return; }
      e.style.left = (r[0] - BOX.x - pad) + 'px'; e.style.top = (r[1] - BOX.y - pad) + 'px'; e.style.width = (r[2] + 2 * pad) + 'px'; e.style.height = (r[3] + 2 * pad) + 'px';
      tf(e, { s, o });
    } };
  }
  // light sweep across a target (screen rect) + a sparkle on its corner
  function Glint(pn) {
    const box = el('div', 'abs', pn.clipL, { overflow: 'hidden', opacity: 0, mixBlendMode: 'screen', borderRadius: 8 * U + 'px' });
    const band = el('div', 'abs', box, { top: '-60%', height: '220%', width: '45%', background: 'linear-gradient(100deg, rgba(255,236,190,0) 0%, rgba(255,236,190,.85) 50%, rgba(255,236,190,0) 100%)' });
    const st = el('div', 'abs', pn.free, { width: 76 * U + 'px', height: 76 * U + 'px', opacity: 0 }, STAR(76 * U));
    return { set(t, t0, r) {
      const p = seg(t, t0 - 0.04, t0 + 0.42, E.ioQ), on = r && p > 0 && p < 1;
      box.style.opacity = on ? 1 : 0; st.style.opacity = 0;
      if (!on) return;
      box.style.left = (r[0] - BOX.x) + 'px'; box.style.top = (r[1] - BOX.y) + 'px'; box.style.width = r[2] + 'px'; box.style.height = r[3] + 'px';
      band.style.left = ((-0.5 + 1.6 * p) * 100).toFixed(1) + '%';
      const q = seg(t, t0, t0 + 0.5);
      st.style.left = (r[0] + r[2] - 38 * U) + 'px'; st.style.top = (r[1] - 38 * U) + 'px';
      tf(st, { s: Math.sin(q * Math.PI) * 1.1, r: q * 120, o: q > 0 && q < 1 ? 1 : 0 });
    } };
  }
  // spotlight: everything in the panel but the target dims (callouts may then sit over the dimmed UI)
  function Spot(pn, a = 0.58) {
    const e = el('div', 'abs', pn.clipL, { borderRadius: 10 * U + 'px', boxShadow: `0 0 0 ${4 * Math.max(W, H)}px rgba(5,6,10,${a})`, opacity: 0 });
    return { set(r, o, pad = 9 * U) {
      if (!r || o <= 0.002) { e.style.opacity = 0; return; }
      e.style.left = (r[0] - BOX.x - pad) + 'px'; e.style.top = (r[1] - BOX.y - pad) + 'px'; e.style.width = (r[2] + 2 * pad) + 'px'; e.style.height = (r[3] + 2 * pad) + 'px';
      e.style.opacity = clamp(o).toFixed(3);
    } };
  }
  // one spotlight gliding from target to target: list [{t0, t1, r (page rect)}]
  function spotRun(spot, pn, t, list) {
    list = list.filter(x => x.r);
    let cur = -1; for (let i = 0; i < list.length; i++) if (t >= list[i].t0 - 0.15) cur = i;
    if (cur < 0) return spot.set(null, 0);
    const it = list[cur], last = list[list.length - 1];
    let r = pn.scrR(it.r);
    if (cur > 0) { const k = seg(t, it.t0 - 0.15, it.t0 + 0.1, E.ioC), pr = pn.scrR(list[cur - 1].r); r = r.map((v, j) => lerp(pr[j], v, k)); }
    spot.set(r, seg(t, list[0].t0 - 0.15, list[0].t0 + 0.1) * (1 - seg(t, last.t1 - 0.2, last.t1)));
  }
  // callout placed above (or below) a screen rect, inside the panel and the safe margins
  function place(co, r) {
    if (!r) return [W / 2, H / 2];
    const gap = 20 * U;
    let y = r[1] - co.h / 2 - gap;
    if (y - co.h / 2 < Math.max(BOX.y + 14 * U, SAFE.y0)) y = r[1] + r[3] + co.h / 2 + gap;
    if (y + co.h / 2 > Math.min(BOX.y + BOX.h - 14 * U, SAFE.y1)) y = clamp(r[1] - co.h / 2 - gap, SAFE.y0 + co.h / 2, SAFE.y1 - co.h / 2);
    const x = clamp(r[0] + r[2] / 2, Math.max(BOX.x, SAFE.x0) + co.w / 2 + 12 * U, Math.min(BOX.x + BOX.w, SAFE.x1) - co.w / 2 - 12 * U);
    return [x, y];
  }
  // callout beside a screen rect on a fixed side ('above' | 'below' | 'right' | 'left'), kept inside the panel + safe area;
  // lift raises it by whole callout heights (stacked labels)
  const ov = (a, b) => (a && b ? Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])) : 0);
  function sidePos(co, r, side, lift = 0) {
    const gap = 18 * U;
    let x = r[0] + r[2] / 2, y = r[1] + r[3] / 2;
    if (side === 'above') y = r[1] - gap - co.h / 2 - lift * (co.h + 10 * U);
    else if (side === 'below') y = r[1] + r[3] + gap + co.h / 2 + lift * (co.h + 10 * U);
    else if (side === 'right') x = r[0] + r[2] + gap + co.w / 2;
    else x = r[0] - gap - co.w / 2;
    const x0 = Math.max(BOX.x, SAFE.x0) + 12 * U, x1 = Math.min(BOX.x + BOX.w, SAFE.x1) - 12 * U;
    const y0 = Math.max(BOX.y - co.h * 0.35, SAFE.y0), y1 = Math.min(BOX.y + BOX.h - 12 * U, SAFE.y1);
    return [clamp(x, x0 + co.w / 2, x1 - co.w / 2), clamp(y, y0 + co.h / 2, y1 - co.h / 2)];
  }
  // pick the side whose label covers the least of the other targets / labels (decided once, on the shot's camera)
  function pickSide(co, r, avoid, order = ['above', 'below', 'right', 'left']) {
    let best = order[0], bs = 1e18;
    order.forEach((side, i) => {
      const [x, y] = sidePos(co, r, side), box = [x - co.w / 2, y - co.h / 2, co.w, co.h];
      let s = i * 0.03 * co.w * co.h + 6 * ov(box, r);
      for (const a of avoid) s += ov(box, a);
      if (s < bs) { bs = s; best = side; }
    });
    return best;
  }
  const CO = (P ? 44 : S ? 34 : 32) * U;   // callout type size
  const callout = (parent, str, k = 1) => { const c = Callout(parent, str, CO * k); c.wrap.style.opacity = 0; return c; };
  // set a callout, then dim it (earlier labels of a stack stay on screen, quieter)
  function coSet(co, t, t0, t1, x, y, dim = 1) {
    co.set(t, t0, t1, x, y);
    if (dim < 1) co.wrap.style.opacity = (parseFloat(co.wrap.style.opacity || 0) * dim).toFixed(3);
  }

  // rows re-sort on real crops. On the sort click the AFTER capture's header appears; the old values whip sideways
  // under the sticky item column (the site scrolls the table to the clicked column), rows that leave the top 8 drop
  // out, rows that stay move to their new slot in one FLIP, and each slot's AFTER row lands on its tick (new rows slide
  // in from the right, kept rows get their new values). Every row crop lives inside the rows band (clipped); what is
  // under the band appears with the last tick. Returns null (skip) when either side has no rows.
  function Resort(pn, before, after, tClick, ticks) {
    if (!has(before) || !has(after)) return null;
    const aft = itemsOf(after).slice(0, 8), bef = itemsOf(after, 'itemsBefore');
    if (aft.length < 2 || bef.length < 2) return null;
    const inner = pn.view.inner;
    const slots = aft.map(it => vis(it.rect, after));
    const okSlots = slots.filter(Boolean);
    if (okSlots.length < 2) return null;
    const top = Math.min(...okSlots.map(r => r[1])), bot = Math.max(...okSlots.map(r => r[1] + r[3]));
    const befR = bef.map(b => vis(b.rect, before));
    const befOk = befR.filter(Boolean);
    if (!befOk.length) return null;
    const botB = Math.max(...befOk.map(r => r[1] + r[3]));
    // sticky item column (right edge of the 'item' header, else of the first cell) in each capture
    const stickOf = (n, its) => { const th = thRect(n, 'item'); if (th) return th[0] + th[2]; const c = its[0] && its[0].cells && its[0].cells[0]; return c ? Math.min(PW, c[0] + c[2]) : 0; };
    const sA = stickOf(after, aft), sB = stickOf(before, bef);
    const thA = rectsOf(after, 'th')[0], thB = rectsOf(before, 'th')[0];
    const split = sA > 24 && sB > 24 && sA < PW * 0.75 && sB < PW * 0.75 && !!thA && !!thB && thA[1] < top && thB[1] < top;
    const thY = split ? Math.max(0, thA[1]) : top, thYB = split ? Math.max(0, thB[1]) : top;
    // sideways scroll between the two captures (rows' left edges); the whip always moves a little
    const dxs = (bef[0].rect[0] || 0) - (aft[0].rect[0] || 0), sgn = dxs < 0 ? -1 : 1;
    const whip = Math.abs(dxs) > 8;
    const slide = sgn * Math.max(Math.abs(dxs), 40), slideIn = sgn * clamp(Math.abs(dxs) * 0.4, 40, 160);
    const setR = vis(rectOf(after, 'settings'), after), setRB = vis(rectOf(before, 'settings'), before);
    // the AFTER capture above the band (the header's scrolling part slides in on its own)
    const baseTop = [];
    if (thY > 2) baseTop.push(Crop(inner, after, [0, 0, PW, thY], 3));
    if (top - thY > 2) baseTop.push(Crop(inner, after, [0, thY, split ? sA : PW, top - thY], 3));
    // the rows band: table background, every row crop inside it
    const band = el('div', 'abs', inner, { left: '0px', top: top + 'px', width: PW + 'px', height: (bot - top) + 'px', overflow: 'hidden', zIndex: 4, background: ROWBG, opacity: 0 });
    const O = [0, top];
    // the scrolling side (right of the sticky column, header row included)
    let scW = null, oldBlock = null, hdrNew = null, scMb = null;
    if (split) {
      scW = el('div', 'abs', inner, { left: sA + 'px', top: thY + 'px', width: (PW - sA) + 'px', height: (bot - thY) + 'px', overflow: 'hidden', zIndex: 5, opacity: 0 });
      scMb = motionBlur();
      el('div', 'abs', scW, { left: '0px', top: '0px', width: (PW - sA) + 'px', height: (top - thY) + 'px', background: '#1c2130' });
      const ob = [sB, thYB, PW - sB, Math.min(botB, bot + 60) - thYB];
      if (ob[2] > 4 && ob[3] > 4) { oldBlock = Crop(scW, before, ob, 2, [sA, thY]); hole(oldBlock, setRB); }
      if (top - thY > 2) hdrNew = Crop(scW, after, [sA, thY, PW - sA, top - thY], 3, [sA, thY]);
    }
    const key = it => it.k || (it.name + '|' + it.sub);
    const flights = [];
    aft.forEach((it, i) => {
      const to = slots[i]; if (!to) return;
      const bi = bef.findIndex(b => key(b) === key(it));
      const from = bi >= 0 ? befR[bi] : null;
      const tl = ticks[i] != null ? ticks[i] : tClick + 0.5 + 0.25 * i;
      const name = from ? Crop(band, before, [0, from[1], split ? sB : PW, from[3]], 5, O) : null;
      const row = Crop(band, after, [0, to[1], PW, to[3]], 6, O);
      hole(name, setRB); hole(row, setR);
      flights.push({ i, to, from, bi, tl, name, row });
    });
    const kept = new Set(flights.filter(f => f.from).map(f => f.bi));
    const leavers = befR.map((r, j) => (r && !kept.has(j) ? { r, j, c: Crop(band, before, [0, r[1], split ? sB : PW, r[3]], 4, O) } : null)).filter(Boolean);
    for (const lv of leavers) hole(lv.c, setRB);
    // below the band: appears with the last tick
    const below = stripH(after) - bot > 2 ? Crop(inner, after, [0, bot, PW, stripH(after) - bot], 3) : null;
    // the floating Settings button stays where it floats
    const setC = setR && setR[1] < bot && setR[1] + setR[3] > thY ? Crop(inner, after, setR, 8) : null;
    const lastTl = Math.max(...flights.map(f => f.tl));
    const tDone = lastTl + 0.3;
    // landing flash: gone (< 1 %) before the crops hand over to the real image at tDone
    const glow = (t, tl) => (t >= tl ? 1 + 0.55 * Math.exp(-(t - tl) / 0.07) : 1);
    const sp = t => seg(t, tClick, tClick + 0.2, E.outC);
    return {
      tDone, top, bot, flights, lastTl, sA: split ? sA : 0, first: flights.length ? flights[0] : null,
      on: t => t >= tClick && t < tDone,
      // page-x offset of the AFTER header while it slides in (marks on it follow)
      hdrX: t => (split && whip ? (1 - sp(t)) * slideIn : 0),
      set(t) {
        const on = t >= tClick && t < tDone, o = on ? 1 : 0;
        for (const c of baseTop) c.w.style.opacity = o;
        band.style.opacity = o;
        if (scW) scW.style.opacity = o;
        if (setC) setC.w.style.opacity = o;
        if (!on) { if (below) below.w.style.opacity = 0; return; }
        // sideways whip
        const p = sp(t);
        if (oldBlock) tf(oldBlock.w, { x: whip ? -slide * p : 0, o: 1 - seg(t, tClick + (whip ? 0.05 : 0.02), tClick + (whip ? 0.22 : 0.16)) });
        if (hdrNew) { tf(hdrNew.w, { x: whip ? (1 - p) * slideIn : 0, o: 1 }); }
        if (scW) { const b = whip ? Math.sin(p * Math.PI) * 14 : 0; scW.style.filter = b > 1 ? scMb.url : 'none'; scMb.set(b, 0); }
        // rows leaving the top 8 drop out
        for (const lv of leavers) {
          const q = seg(t, tClick + 0.03 + lv.j * 0.025, tClick + 0.26 + lv.j * 0.025, E.inC);
          tf(lv.c.w, { x: -q * PW * 0.05, y: q * 6, o: 1 - q, bright: 1 - 0.35 * q });
        }
        // kept rows: one FLIP for all of them, their new values land on the tick
        const fp = seg(t, tClick + 0.06, tClick + 0.46, E.ioC), arc = Math.sin(fp * Math.PI);
        for (const f of flights) {
          const land = t >= f.tl;
          if (f.name) {
            tf(f.name.w, { x: arc * PW * 0.015, y: (f.to[1] - f.from[1]) * fp, s: 1 + 0.02 * arc, o: t < f.tl + 0.07 ? 1 : 0, bright: 1 + 0.08 * arc });
            f.name.w.style.zIndex = fp > 0 && fp < 1 ? 7 : 5;
            f.name.w.style.boxShadow = fp > 0 && fp < 1 ? `0 ${(14 * arc).toFixed(1)}px ${(32 * arc).toFixed(1)}px rgba(0,0,0,${(0.55 * arc).toFixed(2)})` : 'none';
            tf(f.row.w, { o: land ? clamp((t - f.tl) / 0.06) : 0, bright: glow(t, f.tl) });
          } else {
            // new to the top 8: slides into its (empty) slot and lands on its tick
            const q = seg(t, f.tl - 0.2, f.tl, E.outC);
            tf(f.row.w, { x: (1 - q) * PW * 0.3, o: clamp((t - (f.tl - 0.2)) / 0.07), bright: land ? glow(t, f.tl) : 1.06 });
            f.row.w.style.boxShadow = !land && q > 0 ? '0 10px 26px rgba(0,0,0,.5)' : 'none';
          }
        }
        if (below) {
          const w = seg(t, lastTl - 0.04, lastTl + 0.2, E.outC);
          below.w.style.opacity = w > 0 ? 1 : 0;
          below.w.style.clipPath = `inset(0 0 ${((1 - w) * 100).toFixed(2)}% 0)`;
        }
      },
    };
  }

  // ======================= title cards =======================
  // huge outlined numeral that fills with molten gold, the feature name slammed in letter by letter, one line of
  // Inter. Enters on the impact, zooms through the camera on the whoosh at t0+1.5.
  function TitleCard(Lr, c) {
    const t0 = c.t0, tOut = t0 + 1.5, rgb = c.rgb;
    const root = el('div', 'fill', Lr, { transformOrigin: '50% 50%' });
    // hard cut: opaque on the impact frame (whatever the previous section was doing is gone)
    const cut = el('div', 'fill', root, { background: '#0b0d12' });
    const D = 2 * Math.hypot(W, H);
    const rays = el('div', 'abs', root, { left: W / 2 - D / 2 + 'px', top: H * 0.46 - D / 2 + 'px', width: D + 'px', height: D + 'px',
      background: `repeating-conic-gradient(from 0deg, rgba(${rgb},0) 0deg, rgba(${rgb},.07) 3deg, rgba(${rgb},0) 7deg, rgba(${rgb},0) 15deg)`,
      WebkitMaskImage: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 2%, #000 9%, rgba(0,0,0,.45) 20%, rgba(0,0,0,0) 33%)', maskImage: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 2%, #000 9%, rgba(0,0,0,.45) 20%, rgba(0,0,0,0) 33%)' });
    const glow = el('div', 'fill', root, { background: `radial-gradient(${P ? '75% 42%' : L ? '48% 60%' : '62% 55%'} at 50% 46%, rgba(${rgb},.30) 0%, rgba(${rgb},.09) 42%, rgba(${rgb},0) 72%)` });
    if (c.red) el('div', 'fill', root, { background: 'radial-gradient(90% 60% at 50% 110%, rgba(150,20,24,.42) 0%, rgba(80,8,12,.18) 45%, rgba(0,0,0,0) 75%), radial-gradient(60% 40% at 50% -10%, rgba(120,16,20,.3) 0%, rgba(0,0,0,0) 70%)' });
    const ring = el('div', 'abs', root, { width: 900 * U + 'px', height: 900 * U + 'px', borderRadius: '50%', border: `${9 * U}px solid rgba(${c.ringRgb || '255,236,190'},.9)`, boxShadow: `0 0 60px rgba(${rgb},.8)`, opacity: 0 });
    const streak = el('div', 'abs', root, { width: W * 1.3 + 'px', height: 5 * U + 'px', left: -W * 0.15 + 'px', background: `linear-gradient(90deg, rgba(${rgb},0), rgba(255,246,220,.95) 50%, rgba(${rgb},0))`, boxShadow: `0 0 40px rgba(${rgb},.9)`, opacity: 0 });
    // --- type ---
    const block = el('div', 'abs', root, { width: '0px', height: '0px', left: W / 2 + 'px', top: H * 0.46 + 'px' });
    const numS = P ? 600 * U : S ? 430 * U : 660 * U;
    const numStyle = { color: 'transparent', WebkitTextStroke: `${Math.max(3, 6 * U)}px #eebc4e`, letterSpacing: '0.02em' };
    const num = word(block, c.num, numS, 'px', Object.assign({ filter: `drop-shadow(0 0 28px rgba(${rgb},.45))` }, numStyle));
    const fill = word(block, c.num, numS, 'px gold', { letterSpacing: '0.02em' });
    const shine = word(block, c.num, numS, 'px', { letterSpacing: '0.02em', background: 'linear-gradient(100deg, rgba(255,255,255,0) 40%, rgba(255,255,255,.95) 50%, rgba(255,255,255,0) 60%)', backgroundSize: '300% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' });
    const nameMax = L ? W * 0.44 : W * 0.84;
    const nameS = fitDom(root, c.name, 'px', { letterSpacing: '.04em' }, nameMax, (P ? 170 : S ? 130 : 176) * U);
    const name = word(block, '', nameS, 'px', { color: '#f2f4f8', letterSpacing: '.04em', filter: 'drop-shadow(0 10px 26px rgba(0,0,0,.85))' });
    const chars = [...c.name].map(ch => { const sp = el('span', '', name.e, { display: 'inline-block' }); sp.textContent = ch === ' ' ? ' ' : ch; return sp; });
    name.w = name.e.offsetWidth; name.h = name.e.offsetHeight; name.e.style.left = -name.w / 2 + 'px'; name.e.style.top = -name.h / 2 + 'px';
    const descS = fitDom(root, c.desc, 'inter', { fontWeight: 600, letterSpacing: '.03em' }, L ? W * 0.42 : W * 0.8, (P ? 46 : S ? 34 : 42) * U);
    const desc = word(block, c.desc, descS, 'inter', { fontWeight: 600, letterSpacing: '.03em', color: '#c9cfdb', textShadow: '0 4px 18px rgba(0,0,0,.9)' });
    const ruleW = Math.max(name.w * 0.5, 160 * U), ruleH = Math.max(2, 4 * U);
    const rule = el('div', 'abs', block, { width: ruleW + 'px', height: ruleH + 'px', left: -ruleW / 2 + 'px', top: -ruleH / 2 + 'px', transformOrigin: '50% 50%', background: `linear-gradient(90deg, rgba(${rgb},0), rgb(${rgb}) 20%, #f5d47e 50%, rgb(${rgb}) 80%, rgba(${rgb},0))`, boxShadow: `0 0 16px rgba(${rgb},.7)` });
    // layout: stacked (9:16, 1:1) or numeral left / words right (16:9)
    let numX, numY, nameX, nameY, ruleX, ruleY, descX, descY, alignLeft = false;
    const numH = num.h * 0.78;   // Pixelify digits sit high in their line box
    if (L) {
      const gap = 70 * U, rightW = Math.max(name.w, desc.w);
      const tot = num.w + gap + rightW;
      numX = -tot / 2 + num.w / 2; numY = 0;
      const rx = -tot / 2 + num.w + gap;
      nameX = rx + name.w / 2; nameY = -name.h * 0.42; ruleX = rx + ruleW / 2; ruleY = name.h * 0.32; descX = rx + desc.w / 2; descY = name.h * 0.32 + 26 * U + desc.h / 2;
      alignLeft = true;
    } else {
      const gap1 = (P ? 30 : 18) * U, gap2 = (P ? 34 : 24) * U, gap3 = (P ? 30 : 22) * U;
      const tot = numH + gap1 + name.h + gap2 + ruleH + gap3 + desc.h;
      let y = -tot / 2;
      numY = y + numH / 2; y += numH + gap1;
      nameY = y + name.h / 2; y += name.h + gap2;
      ruleY = y + ruleH / 2; y += ruleH + gap3;
      descY = y + desc.h / 2;
      numX = nameX = ruleX = descX = 0;
    }
    for (const T of [num, fill, shine]) tf(T.a, { x: numX, y: numY });
    tf(name.a, { x: nameX, y: nameY }); tf(desc.a, { x: descX, y: descY });
    rule.style.left = (ruleX - ruleW / 2) + 'px'; rule.style.top = (ruleY - ruleH / 2) + 'px';
    if (alignLeft) rule.style.transformOrigin = '0 50%';
    const NC = [W / 2 + numX, H * 0.46 + numY];
    ring.style.left = NC[0] - 450 * U + 'px'; ring.style.top = NC[1] - 450 * U + 'px';
    streak.style.top = NC[1] - 2.5 * U + 'px';
    FX.burst({ t: t0, x: NC[0], y: NC[1], n: 120, speed: 1700, angle: -Math.PI / 2, spread: Math.PI * 2, gravity: 900, life: 0.9, size: 3.2, color: c.spark || [255, 214, 140], streak: 0.03 });
    FX.burst({ t: t0, x: NC[0], y: NC[1] + numH * 0.5, n: 50, speed: 1100, angle: -Math.PI / 2, spread: 1.4, gravity: 1800, life: 0.8, size: 3, color: [255, 255, 255] });
    FX.flash(t0, 0.2, 0.07, null);
    return (t) => {
      const d = t - t0;
      cut.style.opacity = t < t0 + 0.06 ? 1 : 0;
      // exit: zoom through the camera
      const out = seg(t, tOut, tOut + 0.3, E.inE), fade = seg(t, tOut + 0.02, tOut + 0.21);
      tf(root, { s: (1 + 0.035 * seg(t, t0, tOut, E.outQ)) * (1 + 1.4 * out), o: 1 - fade });
      root.style.filter = out > 0.01 ? `blur(${(out * 16).toFixed(1)}px)` : 'none';
      // background energy
      rays.style.opacity = (0.9 * seg(t, t0, t0 + 0.25) * (1 - 0.35 * seg(t, t0 + 0.4, tOut))).toFixed(3);
      tf(rays, { r: d * 9 });
      glow.style.opacity = (0.55 + 0.45 * Math.exp(-Math.max(0, d) / 0.35) + 0.12 * Math.sin(t * Math.PI * 2)).toFixed(3);
      const rp = seg(t, t0, t0 + 0.55, E.outC);
      tf(ring, { s: 0.15 + 1.5 * rp, o: d >= 0 ? (1 - rp) * 0.9 : 0 });
      const sp = seg(t, t0, t0 + 0.4, E.outC);
      tf(streak, { sx: 0.2 + 1.1 * sp, o: d >= 0 ? (1 - sp) : 0 });
      // numeral: slam from 1.8x with blur, keeps breathing
      const ap = seg(d, 0, 0.22, E.outE);
      const ns = lerp(1.9, 1, ap) * (1 + 0.03 * seg(t, t0 + 0.2, tOut));
      tf(num.e, { s: ns, o: d >= 0 ? 0.55 + 0.45 * seg(d, 0, 0.05) : 0, blur: (1 - ap) * 14 });
      const fp = seg(t, t0 + 0.12, t0 + 0.9, E.ioQ);
      tf(fill.e, { s: ns, o: d >= 0.1 ? 1 : 0 });
      fill.e.style.clipPath = `inset(${((1 - fp) * 100).toFixed(1)}% 0 0 0)`;
      tf(shine.e, { s: ns });
      const shp = seg(t, t0 + 0.95, t0 + 1.45, E.ioQ);
      shine.e.style.opacity = shp > 0 && shp < 1 ? 1 : 0; shine.e.style.backgroundPosition = `${(100 - 100 * shp).toFixed(1)}% 0`;
      // name: letters slam down in a stagger
      chars.forEach((ch, i) => {
        const dd = d - 0.06 - i * 0.026, a = spring(dd, 3.6, 0.55);
        tf(ch, { y: (1 - a) * -0.55 * nameS, s: 1 + 0.22 * (1 - clamp(a)), o: dd >= 0 ? clamp(a * 2.6) : 0 });
      });
      // rule + descriptor
      tf(rule, { sx: Math.max(0.001, seg(t, t0 + 0.28, t0 + 0.62, E.outC)) });
      const da = spring(d - 0.38, 3, 0.6);
      tf(desc.e, { y: (1 - da) * 26 * U, o: d >= 0.38 ? clamp(da * 1.6) : 0 });
    };
  }

  // ======================= ambient light per section =======================
  scene('feat_amb', 32.0, 80.0, (Lr) => {
    const dim = el('div', 'fill', Lr, { background: 'radial-gradient(120% 80% at 50% 50%, rgba(5,6,10,.15) 0%, rgba(5,6,10,.55) 100%)' });
    const gold = el('div', 'fill', Lr, { background: `radial-gradient(${P ? '80% 45%' : '60% 60%'} at 50% 52%, rgba(238,188,78,.13) 0%, rgba(238,188,78,.04) 45%, rgba(238,188,78,0) 75%)` });
    // Black Market: Caerleon torchlight from below, a cold dark crown above
    const red = el('div', 'fill', Lr, { background: 'radial-gradient(85% 55% at 50% 108%, rgba(170,26,30,.55) 0%, rgba(110,14,20,.22) 42%, rgba(0,0,0,0) 72%), radial-gradient(55% 40% at 0% 30%, rgba(120,14,22,.30) 0%, rgba(0,0,0,0) 70%), radial-gradient(55% 40% at 100% 70%, rgba(120,14,22,.30) 0%, rgba(0,0,0,0) 70%)' });
    const crown = el('div', 'fill', Lr, { background: 'linear-gradient(180deg, rgba(3,2,4,.55) 0%, rgba(3,2,4,0) 35%)' });
    const cv = el('canvas', 'fill', Lr); cv.width = Math.ceil(W / 2); cv.height = Math.ceil(H / 2); const ctx = cv.getContext('2d');
    return (t) => {
      const bm = seg(t, 48.0, 48.25) * (1 - seg(t, 63.6, 64.0));
      red.style.opacity = (bm * (0.85 + 0.15 * noise1(t * 3.1, 7) + 0.08 * Math.sin(t * Math.PI))).toFixed(3);
      crown.style.opacity = bm.toFixed(3);
      gold.style.opacity = ((1 - bm) * (0.75 + 0.25 * Math.sin(t * Math.PI))).toFixed(3);
      dim.style.opacity = 1;
      // Black Market ash: slow red motes drifting up
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (bm > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 60; i++) {
          const per = 5 + hash(i, 31) * 5, ph = ((t + hash(i, 32) * per) % per) / per;
          const x = (hash(i, 33) + 0.03 * Math.sin(t * 0.8 + i)) * cv.width, y = cv.height * (1.05 - ph * 1.2);
          const a = Math.sin(ph * Math.PI) * (0.25 + 0.5 * hash(i, 34)) * bm, r = 1 + 1.6 * hash(i, 35);
          ctx.fillStyle = `rgba(255,${(70 + 60 * hash(i, 36)) | 0},50,${a.toFixed(3)})`; ctx.fillRect(x, y, r, r);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }, { z: 21 });

  // ======================= the three title cards =======================
  const GOLD = '238,188,78', RED = '228,92,74';
  scene('feat_title1', 32.0, 34.0, (Lr) => TitleCard(Lr, { t0: 32.0, num: '01', name: 'CRAFTING', desc: 'every recipe, costed <span class="gold">city by city</span>', rgb: GOLD }), { z: 36 });
  scene('feat_title2', 48.0, 50.0, (Lr) => TitleCard(Lr, { t0: 48.0, num: '02', name: 'BLACK MARKET', desc: 'buy in any city, sell in <span style="color:#e46f61">Caerleon</span>', rgb: RED, red: true, ringRgb: '255,190,170', spark: [255, 150, 110] }), { z: 36 });
  scene('feat_title3', 64.0, 66.0, (Lr) => TitleCard(Lr, { t0: 64.0, num: '03', name: 'ANY PRICE', desc: 'type a few letters, <span class="gold">every city</span> at once', rgb: GOLD }), { z: 36 });

  // ======================= 01 CRAFTING + 02 BLACK MARKET: the shared table flow =======================
  // home (hover state; the not-yet-hovered home crop sits on the target until the cursor arrives) → click → real
  // loading state → the populated table pushes in over it → category chip → sort by profit with the re-sort → open.
  function tableFlow(Lr, cfg) {
    const p = cfg.prefix, T = cfg.T;
    const pn = Panel(Lr, cfg.num, cfg.tag, cfg.rgb);
    const sHome = pick(p + '_home_hover');
    const goAct = actOf(sHome, 'next');
    const sLoad = pick(p + '_loading');
    const sTable = pick(p + '_table', p + '_gold_off');
    const sSort = pick(p + '_sort_net');
    const chipNames = cfg.chips.map(g => p + '_grp_' + g);
    const sortPrev = sSort && ST(sSort).prev;
    const sGrp = has(sortPrev) && sortPrev !== sTable && /_grp_/.test(sortPrev) ? sortPrev : pick(chipNames.flatMap(n => [n, n + '_gold_off']));
    const chipSt = sGrp && /_gold_off$/.test(sGrp) && has(ST(sGrp).prev) ? ST(sGrp).prev : sGrp;
    const sOpen = pick(cfg.open);
    for (const n of [sHome, sLoad, sTable, sGrp, sSort, sOpen]) pn.add(n);
    const sBefore = sGrp || sTable || sLoad;     // on screen when the sort is clicked
    const sRows = sSort || sBefore;              // on screen when the row is opened
    // ---- targets (page px) ----
    const goAt = goAct ? goAct.at : null, goR = goAct ? goAct.rect : null;
    const chipAct = actOf(chipSt);
    const chipKey = sGrp ? (sGrp.match(/_grp_([a-z]+)/) || [])[1] : null;
    const chipR = chipAct ? chipAct.rect : (() => { const i = keysOf(sTable, 'grp').indexOf(chipKey); return i >= 0 ? rectsOf(sTable, 'grp')[i] : null; })();
    const chipAt = chipAct ? chipAct.at : (chipR ? ctr(chipR) : null);
    // the sort header. Where the BEFORE capture shows that column the cursor clicks it there; where it does not (phones:
    // the site scrolls the table sideways to it first) the cursor clicks where it shows after the sort, and the
    // sideways whip on the click brings it under the cursor
    const sortAct = actOf(sSort);
    const sortKey = (sortAct && sortAct.sel && (sortAct.sel.match(/data-k="([A-Za-z]+)"/) || [])[1]) || 'net';
    const visCol = (n, k) => {
      const r = thRect(n, k); if (!r) return null;
      const it = thRect(n, 'item'), s = it ? it[0] + it[2] : 0;
      if (k !== 'item' && it && r[0] < s - 4) { const x1 = r[0] + r[2]; return x1 - s > 24 ? [s, r[1], x1 - s, r[3]] : null; }
      return r;
    };
    const skelTop = (() => { const r = vis(rectOf(sBefore, 'skel'), sBefore); return r ? [r[0], r[1], r[2], Math.min(r[3], 46)] : null; })();
    const sortPre = visCol(sBefore, sortKey), sortPost = sSort ? visCol(sSort, sortKey) : null;
    const sortAt = sortPre ? ctr(sortPre)
      : sortPost ? [sortPost[0] + sortPost[2] / 2, sortAct ? sortAct.at[1] : sortPost[1] + sortPost[3] / 2]
      : sortAct ? [clamp(sortAct.at[0], 6, PW - 6), sortAct.at[1]] : (skelTop ? ctr(skelTop) : null);
    const openAct = actOf(sOpen);
    const rowsAfter = rowRects(sRows);
    const openAt = openAct ? [clamp(openAct.at[0], 6, PW - 6), openAct.at[1]] : (rowsAfter[0] ? [rowsAfter[0][0] + Math.min(rowsAfter[0][2], PW) * 0.45, rowsAfter[0][1] + rowsAfter[0][3] / 2] : (skelTop ? ctr(skelTop) : null));
    const openR = rowsAfter[0] || (openAct ? vis(openAct.rect, sRows) : null);
    // ---- pre-hover: the plain home's crop of the target until the cursor arrives ----
    const pre = (() => {
      if (!goR) return null;
      for (const ref of ['home_top', 'home_full']) {
        if (!has(ref)) continue;
        const rr = (rectsOf(ref, goR[2] > 300 ? 'card' : 'go')).find(r => Math.abs(r[0] - goR[0]) < 6 && Math.abs(r[1] - goR[1]) < 10 && Math.abs(r[2] - goR[2]) < 6);
        if (!rr || stripH(ref) < goR[1] + goR[3] + 20) continue;
        const reg = vis(grow(uni([rr, goR]), 6, 8), sHome);
        if (reg) return Crop(pn.view.inner, ref, reg, 3);
      }
      return null;
    })();
    // ---- the table pushes in over the loading state ----
    const tabTop = (() => { const r = uni([rectOf(sTable, 'th'), rowRects(sTable)[0], vis(rectOf(sTable, 'skel'), sTable)]); return r ? Math.max(0, r[1] - 10) : VH * 0.45; })();
    const pushBox = el('div', 'abs', pn.view.inner, { left: '0px', top: '0px', zIndex: 3 });
    const pushMb = motionBlur();
    const pushOld = has(sLoad) && stripH(sLoad) - tabTop > 4 ? Crop(pushBox, sLoad, [0, tabTop, PW, stripH(sLoad) - tabTop], 3) : null;
    const pushNew = has(sTable) && stripH(sTable) - tabTop > 4 ? Crop(pushBox, sTable, [0, tabTop, PW, stripH(sTable) - tabTop], 4) : null;
    // ---- re-sort ----
    const ticks = evIn('tick', T.sort, T.open);
    const rs = sSort ? Resort(pn, sBefore, sSort, T.sort, ticks) : null;
    // ---- cuts: every page change is a hard cut on its click frame (+ a small punch of the panel) ----
    const cuts = cutsOf([
      [T.in - 0.2, sHome, 0], [T.c1, sLoad, 0], [T.tab + 0.3, sTable, 0], [T.chip, sGrp, 0],
      [rs ? rs.tDone : T.sort, sSort, 0], [T.open, sOpen, 0],
    ]);
    pn.punches.push([T.c1, 0.016], [T.chip, 0.007], [T.sort, 0.007], [T.open, 0.016]);
    // ---- camera ----
    const [cx0] = colOf(sTable);
    const camHome = cfg.homeFrame(sHome, goR, goAt);
    const camLoad = cfg.loadFrame ? cfg.loadFrame(sLoad) : (sLoad ? cam(sLoad, camHome[0], camHome[1], camHome[2]) : camHome);
    const grp0 = uni(rectsOf(sTable, 'grp'));
    const secTop = (rectOf(sTable, 'task') || grp0 || [0, VH * 0.3])[1];
    const camSec = keep(sTable, topLeft(sTable, cx0, secTop, FW.sec), chipAt && chipAt[0], chipAt && chipAt[1]);
    const thB = uni(rectsOf(sBefore, 'th').map(r => vis(r, sBefore))) || skelTop;
    const thY = thB ? thB[1] : (grp0 ? grp0[1] + grp0[3] + 60 : VH * 0.5);
    // rows framing: the header + the 8 rows, the band's bottom near the view's bottom (chips / filters above); on
    // 1:1 and 16:9 the x-range comes from the header columns the moment is about (cfg.cols), phones show the full width
    const bandBot = n => { const rs8 = rowRects(n); return rs8.length ? Math.max(...rs8.map(r => r[1] + r[3])) : thY + 420; };
    function rowsCam(n, keys) {
      const sp = !P && keys ? xSpan(n, keys) : null;
      const x0 = P ? 0 : sp ? sp[0] : cx0, x1 = P ? PW : sp ? sp[1] : cx0 + FW.rows;
      const z = P ? zMin(n) : zOf(n, x1 - x0 + 52), vh = BOX.h / z;
      const ctx = clamp(vh - (bandBot(n) - thY) - 24, 40 + headroom(z), P ? 300 : 170);
      return cam(n, (x0 + x1) / 2, thY - ctx + vh / 2, z);
    }
    const camRows = keep(sBefore, rowsCam(sBefore, cfg.cols.pre), sortAt && sortAt[0], sortAt && sortAt[1], 110 * U);
    const camSort = rowsCam(sRows, cfg.cols.sort);
    const camTop = keep(sRows, rowsCam(sRows, cfg.cols.top), openAt && openAt[0], openAt && openAt[1], 110 * U);
    // (each feature adds its own keys from the sort to the open click)
    const keys = [
      [T.in - 0.2, camHome], [T.c1 + 0.04, camHome],
      [T.c1 + 0.08, camLoad, E.lin], [T.tab - 0.05, camLoad],
      [T.tab + 0.45, camSec, E.ioC],
      [T.chip - 0.75, zoomed(sTable, camSec, 1.02), E.ioQ], [T.chip + 0.12, zoomed(sTable, camSec, 1.02)],
      [T.chip + 1.1, camRows, E.ioC], [T.sort - 0.02, zoomed(sBefore, camRows, 1.01), E.lin],
      [T.sort + 0.5, camSort, E.ioC],
    ];
    const P0 = goAt || [PW / 2, VH / 2];
    const pts = [[T.in + 0.3, P0[0] + PW * 0.5, P0[1] + VH * 0.32], [T.c1 - 0.28, P0[0] + 4, P0[1] + 3], [T.c1, ...P0], [T.c1 + 0.12, ...P0]];
    if (chipAt) pts.push([T.tab + 0.45, chipAt[0] + PW * 0.25, chipAt[1] + VH * 0.12], [T.chip - 0.3, chipAt[0] + 2, chipAt[1] + 2], [T.chip, ...chipAt], [T.chip + 0.15, ...chipAt]);
    if (sortAt) pts.push([T.sort - 0.4, sortAt[0] + 2, sortAt[1] + 2], [T.sort, ...sortAt], [T.sort + 0.15, ...sortAt], [T.sort + 0.6, sortAt[0] + PW * 0.12, sortAt[1] - VH * 0.05]);
    if (openAt) pts.push([T.open - 0.6, openAt[0] + PW * 0.2, openAt[1] + VH * 0.06], [T.open - 0.15, openAt[0] + 2, openAt[1] + 2], [T.open, ...openAt], [T.open + 0.2, ...openAt], [T.open + 0.8, openAt[0] + PW * 0.35, openAt[1] + VH * 0.2]);
    const clicks = [T.c1, chipAt ? T.chip : null, sortAt ? T.sort : null, openAt ? T.open : null].filter(x => x != null);
    // click marks: f(t) → [page rect, opacity, scale]. Navigation clicks mark the pressed element only up to the cut;
    // the chip stays marked; the sort mark follows the header as it slides in after the click
    const press = (tc, r) => t => [t < tc ? r : null, seg(t, tc - 0.16, tc - 0.07), 1.06 - 0.06 * seg(t, tc - 0.16, tc, E.outC)];
    const stay = (tc, r) => t => { const d = t - tc; return [d > -0.02 && d < 0.5 ? r : null, d < 0 ? 0 : 1 - seg(d, 0.18, 0.5), 1.12 - 0.12 * E.outC(clamp(d / 0.2))]; };
    const sortMark = t => {
      if (t < T.sort) return sortPre ? [sortPre, seg(t, T.sort - 0.14, T.sort - 0.06), 1.04] : [null, 0, 1];
      const r = sortPost || sortPre || skelTop, d = t - T.sort, dx = rs ? rs.hdrX(t) : 0;
      return [r && d < 0.55 ? [r[0] + dx, r[1], r[2], r[3]] : null, 1 - seg(d, 0.22, 0.55), 1.1 - 0.1 * E.outC(clamp(d / 0.2))];
    };
    const marks = [goR && press(T.c1, goR), chipR && stay(T.chip, chipR), sortAt && sortMark, openR && press(T.open, openR)].filter(Boolean).map(f => ({ f, m: Mark(pn) }));
    return { pn, T, cuts, keys, pts, clicks, marks, rs, pre, pushBox, pushMb, pushOld, pushNew, tabTop, sHome, sLoad, sTable, sGrp, sSort, sOpen, sRows, sBefore, rowsAfter, openAt, openR, camSort, camTop, cx0, goAt, thY };
  }

  // per-frame driver shared by both table features
  function flowUpdate(F, t, camF, curO) {
    const { pn, T } = F;
    const c = camF(t);
    pn.setCam(c);
    pn.camBlur(camF, t);
    // states (the re-sort draws its own base while it runs)
    if (F.rs && F.rs.on(t)) pn.mix({ __top: null });
    else pn.mix(mixAt(F.cuts, t));
    if (F.rs) F.rs.set(t);
    // pre-hover crop, until the cursor reaches the target
    if (F.pre) F.pre.w.style.opacity = clamp(1 - (t - (T.c1 - 0.22)) / 0.08).toFixed(3);
    // table push (old skeleton out to the left, populated table in from the right)
    const pp = seg(t, T.tab, T.tab + 0.3, E.ioC), pushing = t >= T.tab && t < T.tab + 0.3;
    if (F.pushNew) { F.pushNew.w.style.opacity = pushing ? 1 : 0; tf(F.pushNew.w, { x: (1 - pp) * PW }); }
    if (F.pushOld) { F.pushOld.w.style.opacity = pushing ? 1 : 0; tf(F.pushOld.w, { x: -pp * PW }); }
    const vb = pushing ? Math.sin(pp * Math.PI) * 14 : 0;
    F.pushBox.style.filter = vb > 0.8 ? F.pushMb.url : 'none'; F.pushMb.set(vb, 0);
    // cursor
    const [px, py] = cursorPath(t, F.pts);
    const [sx, sy] = pn.scr(px, py);
    pn.cur.set(t, sx, sy, F.clicks, curO(t));
    for (const mk of F.marks) { const [r, o, s] = mk.f(t); mk.m.set(r ? pn.scrR(r) : null, o, s); }
    return c;
  }
  // hide a callout (never set before its time)
  const off = co => co.set(0, 1e9, 1e9 + 1, 0, 0);

  // ---------------------------------------------------------------- 01 CRAFTING (UI) ----
  scene('feat_ui1', 33.3, 48.05, (Lr) => {
    const T = { in: evT('whoosh', 33.5), c1: evT('click', 34.5), tab: evT('whoosh', 35.0), chip: evT('click', 37.0), sort: evT('click', 39.0), open: evT('click', 43.0), openWh: evT('whoosh', 43.25), g1: evT('glint', 45.0), g2: evT('glint', 46.0), out: evT('whoosh', 47.5) };
    const F = tableFlow(Lr, { prefix: 'craft', num: '01', tag: 'CRAFTING', rgb: GOLD, T, chips: ['bag', 'gear'], open: ['craft_open'],
      // 1:1: the cost → profit columns while the rows re-sort (the profits descend), the names for "rises to the top";
      // 16:9: the names and every column up to the profit
      cols: S ? { pre: ['rev', 'channel', 'net'], sort: ['rev', 'channel', 'net'], top: ['item', 'city'] } : { pre: ['item', 'net'], sort: ['item', 'net'], top: ['item', 'net'] },
      // (the hero's anvil logo is in the shot: the hover capture has no 'logo' rect, the plain home of the same layout has)
      homeFrame: (n, goR, goAt) => {
        const t0 = rectOf(n, 'title'), ref = ['home_top', 'home_full'].find(h => { const t1 = rectOf(h, 'title'); return t0 && t1 && Math.abs(t0[0] - t1[0]) < 4 && Math.abs(t0[1] - t1[1]) < 4; });
        const logo = rectsOf(n, 'logo').length ? rectsOf(n, 'logo') : ref ? rectsOf(ref, 'logo') : [];
        return keep(n, frame(n, uni([...logo, ...['title', 'lead', 'go', 'all', 'stat'].flatMap(k => rectsOf(n, k))].map(r => vis(r, n))), 0.1, ZMAX, 0.45), goAt && goAt[0], goAt && goAt[1]);
      } });
    const { pn, sOpen, sRows, rowsAfter } = F;
    const ticks = evIn('tick', T.sort, T.open), lastTick = ticks.length ? ticks[ticks.length - 1] : T.sort + 2.25;
    // ---- top row: "...rises to the top" (the camera reaches the names after the last tick) ----
    const vRise = voT('v08', 37.4) + 3.83;
    const gl0 = Math.max(vRise - 0.1, lastTick + 0.04), gl1 = gl0 + 0.55;
    const topSpot = Spot(pn, 0.5);
    const topCo = callout(pn.free, 'BEST TO MAKE TODAY');
    const topMark = Mark(pn);
    const topIt = itemsOf(sRows)[0];
    const topCell = (topIt && topIt.cells && topIt.cells[0] ? vis(topIt.cells[0], sRows) : null) || rowsAfter[0];
    // ---- open row: unit cost / sweet spot / full batch, on the words of v09 ----
    const v9 = voT('v09', 43.2);
    const W1 = v9 + 1.28, W2 = v9 + 2.18, W3 = v9 + 3.02, tAll = W3 + 0.6;
    const detR = vis(rectOf(sOpen, 'det'), sOpen);
    const bs = rectsOf(sOpen, 'detB'), bsL = labelsOf(sOpen, 'detB'), bo = rectsOf(sOpen, 'batchOutB'), boL = labelsOf(sOpen, 'batchOutB'), bOut = rectOf(sOpen, 'batchOut');
    const same = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1;
    // bold numbers after the batch calculator: unit cost, net sale, silver per day, monthly normal
    const tail = bs.map((r, i) => ({ r, l: bsL[i] || '' })).filter(o => o.l && !bo.some(b => same(b, o.r)) && (!bOut || o.r[1] > bOut[1] + bOut[3] - 2));
    // + the plain words before the number, measured in the site's font at the size the bold number implies
    const SYS = '-apple-system,BlinkMacSystemFont,system-ui,sans-serif';
    const lead = (o, words) => {
      if (!o) return null;
      const fs = o.r[2] * 100 / Math.max(1, FX.lib.measure(o.l, 100, SYS, 700)), w = FX.lib.measure(words, fs, SYS, 400);
      return vis([o.r[0] - w - 2, o.r[1] - 3, o.r[2] + w + 6, o.r[3] + 6], sOpen);
    };
    const costR = lead(tail[0], 'Cost '), dayR = lead(tail[2] || tail[tail.length - 1], 'profit per day ');
    const bi = boL.findIndex(l => /^batch\b/i.test(l));
    const batchR = bi >= 0 ? vis(grow(uni(bo.filter((r, i) => i >= bi && boL[i] && r[1] >= bo[bi][1] - 2 && r[1] <= bo[bi][1] + bo[bi][3] * 1.8)), 4, 3), sOpen) : vis(bOut, sOpen);
    // a: spot + camera on the target (on the glint SFX where there is one), tw: callout on the voiced word
    const targets = [[W1 - 0.25, W1, costR, 'UNIT COST', null], [T.g1, W2, dayR, 'SWEET SPOT', T.g1], [T.g2, W3, batchR, 'FULL BATCH', T.g2]]
      .map(([a, tw, r, s, tg]) => ({ a, tw, r, s, tg, co: callout(pn.free, s, 0.86), m: Mark(pn), g: Glint(pn) }));
    const haveDet = !!(sOpen && detR && costR && dayR && batchR);
    const numSpot = Spot(pn, 0.6);
    // fallback (no expanded-row capture): the three words as kinetic type over the dimmed panel
    const fb = haveDet ? null : targets.map((tg, i) => word(pn.free, tg.s, (P ? 92 : 70) * U, 'px ' + (i === 1 ? 'gold' : ''), { color: '#f2f4f8', filter: 'drop-shadow(0 10px 30px rgba(0,0,0,.9))' }, 9));
    if (fb) fb.forEach(w => { w.a.style.opacity = 0; });
    const fbDim = el('div', 'abs', pn.clipL, { left: '0px', top: '0px', width: BOX.w + 'px', height: BOX.h + 'px', background: 'rgba(5,6,10,.62)', opacity: 0 });
    // ---- camera ----
    const keys = F.keys.slice();
    // re-sort on the sort framing, then (1:1) a glide to the names for the top row, hold through the open click
    keys.push([gl0, zoomed(sRows, F.camSort, 1.012), E.lin], [gl1, F.camTop, E.ioC], [T.openWh, zoomed(sRows, F.camTop, 1.012), E.lin]);
    let numList = [];
    if (haveDet) {
      // each number gets its own shot: its line at a readable size, the view's left edge on the block's text margin
      const tx0 = detR[0] + (P ? 6 : 10);
      const shotOf = (r, k = 1.14) => {
        const z = zOf(sOpen, Math.max(FW.det, r[2] * k)), hw = BOX.w / 2 / z;
        const cx = tx0 - 10 + 2 * hw >= r[0] + r[2] + 14 ? tx0 - 10 + hw : r[0] + r[2] + 14 - hw;
        return cam(sOpen, cx, r[1] + r[3] / 2, z);
      };
      targets.forEach(tg => { tg.shot = shotOf(tg.r); });
      const allR = uni(targets.map(tg => tg.r)), camAll = shotOf(allR, 1.1);
      // labels: the side that covers neither the other numbers nor the labels already up (decided on each shot)
      targets.forEach((tg, i) => {
        const sc = r => pn.scrR(r, tg.shot);
        // (the other numbers' whole text lines: a label must not sit on the words that lead into them either)
        const avoid = targets.filter((o, j) => j !== i).map(o => grow(sc([detR[0], o.r[1], detR[2], o.r[3]]), 0, 4 * U));
        for (const o of targets.slice(0, i)) { const [x, y] = sidePos(o.co, sc(o.r), o.side); avoid.push([x - o.co.w / 2, y - o.co.h / 2, o.co.w, o.co.h]); }
        tg.side = pickSide(tg.co, sc(tg.r), avoid);
      });
      const [s0, s1, s2] = targets.map(tg => tg.shot);
      const [A2, A3] = [targets[1].a, targets[2].a];
      // one move on the whoosh after the open click, landing on the first number; then number to number on the glints
      keys.push([T.openWh + 0.45, s0, E.outQuint],
        [A2 - 0.3, zoomed(sOpen, s0, 1.012), E.lin], [A2 + 0.05, s1, E.ioC],
        [A3 - 0.3, zoomed(sOpen, s1, 1.012), E.lin], [A3 + 0.05, s2, E.ioC],
        [tAll - 0.1, zoomed(sOpen, s2, 1.01), E.lin], [tAll + 0.35, camAll, E.ioC], [T.out + 0.1, zoomed(sOpen, camAll, 1.02), E.lin]);
      numList = [...targets.map((tg, i) => ({ t0: tg.a, t1: i < 2 ? targets[i + 1].a - 0.02 : tAll, r: tg.r })), { t0: tAll, t1: T.out - 0.05, r: grow(allR, 6, 4) }];
    } else keys.push([T.out, zoomed(sRows, F.camTop, 1.03), E.ioQ]);
    const camF = track(keys);
    // the label comes up as the camera settles on the names (1:1 glides there), else on the voiced words
    const glides = Math.abs(F.camTop[0] - F.camSort[0]) * F.camTop[2] > 40 || Math.abs(Math.log(F.camTop[2] / F.camSort[2])) > 0.05;
    const tRise = glides ? gl1 - 0.05 : vRise + 0.05;
    // top-row label side, decided on the top-row shot
    const topSide = topCell ? pickSide(topCo, pn.scrR(topCell, F.camTop), [], ['above', 'below']) : 'above';
    const tiltAmt = t => K(t, [[T.in, 0.9], [T.in + 0.7, 0.35], [T.c1 - 0.6, 0], [T.chip + 0.2, 0], [T.chip + 0.9, 0.45], [T.sort - 0.6, 0], [T.sort + 0.3, 0], [T.sort + 0.9, 0.6], [T.open - 0.8, 0.6], [T.open - 0.4, 0], [T.openWh + 0.5, 0], [W1, 0.25], [T.out, 0.5]]);
    // the cursor leaves while the rows re-sort, comes back for the open click, leaves after it
    const curO = t => seg(t, T.in + 0.3, T.in + 0.5) * (1 - seg(t, T.open + 0.6, T.open + 0.9)) * (1 - seg(t, T.sort + 0.4, T.sort + 0.7) * (1 - seg(t, T.open - 0.95, T.open - 0.65)));
    return (t) => {
      pn.pose(t, T.in, T.out, tiltAmt(t));
      flowUpdate(F, t, camF, curO);
      // the new top row: flash on its landing, callout on "rises to the top"
      const r0 = rowsAfter[0] ? pn.scrR(rowsAfter[0]) : null;
      const fl = F.rs && F.rs.first;
      spotRun(topSpot, pn, t, F.sSort && rowsAfter[0] ? [{ t0: tRise, t1: T.open - 0.1, r: rowsAfter[0] }] : []);
      if (F.sSort && r0 && topCell) {
        const [x, y] = sidePos(topCo, pn.scrR(topCell), topSide); topCo.set(t, tRise, T.open - 0.05, x, y);
        const mo = Math.max(fl ? seg(t, fl.tl - 0.02, fl.tl + 0.06) * (1 - seg(t, fl.tl + 0.35, fl.tl + 0.7)) : 0, seg(t, tRise - 0.1, tRise + 0.15) * (1 - seg(t, T.open - 0.25, T.open - 0.05)));
        topMark.set(r0, mo, 1 + 0.05 * (1 - spring(t - (t < tRise - 0.1 && fl ? fl.tl : tRise - 0.1), 3, 0.5)));
      } else { off(topCo); topMark.set(null, 0); }
      // numbers
      spotRun(numSpot, pn, t, haveDet ? numList : []);
      if (haveDet) {
        targets.forEach((tg, i) => {
          const r = pn.scrR(tg.r);
          const nextA = i < 2 ? targets[i + 1].a : 1e9;
          // earlier labels stay up, quieter; all three come back to full on the last shot
          const dimP = seg(t, nextA - 0.05, nextA + 0.15) * (1 - seg(t, tAll, tAll + 0.25));
          const [x, y] = sidePos(tg.co, r, tg.side);
          coSet(tg.co, t, tg.tw, T.out + 0.3, x, y, 1 - 0.45 * dimP);
          tg.m.set(r, seg(t, tg.a - 0.08, tg.a + 0.08) * (1 - 0.7 * dimP) * (t >= tAll ? 0.8 : 1) * (1 - seg(t, T.out - 0.1, T.out + 0.1)), 1 + 0.1 * (1 - spring(t - tg.a + 0.08, 3, 0.5)));
          if (tg.tg != null) tg.g.set(t, tg.tg, r);
        });
      } else {
        fbDim.style.opacity = (0.95 * seg(t, W1 - 0.3, W1) * (1 - seg(t, T.out - 0.2, T.out))).toFixed(3);
        const cy = BOX.y + BOX.h * 0.5, gap = (P ? 120 : 86) * U;
        fb.forEach((w, i) => {
          const a = spring(t - targets[i].tw, 3.2, 0.5);
          tf(w.a, { x: W / 2, y: cy + (i - 1) * gap + (1 - a) * 40 * U, s: 0.7 + 0.3 * a, o: t >= targets[i].tw ? clamp(a * 2) * (1 - seg(t, T.out - 0.2, T.out)) : 0 });
        });
      }
    };
  }, { z: 30 });

  // ---------------------------------------------------------------- 02 BLACK MARKET (UI) ----
  scene('feat_ui2', 49.3, 64.05, (Lr) => {
    const T = { in: evT('whoosh', 49.5), c1: evT('click', 50.5), tab: evT('whoosh', 51.0), chip: evT('click', 53.0), sort: evT('click', 55.0), open: evT('click', 58.0), g1: evT('glint', 60.0), g2: evT('glint', 61.0), out: evT('whoosh', 63.5) };
    const F = tableFlow(Lr, { prefix: 'flip', num: '02', tag: 'BLACK MARKET', rgb: RED, T, chips: ['gear'], open: ['flip_item'],
      // 1:1: quality / buy / profit columns while the rows re-sort and the VO names them; the names for the open click
      cols: S ? { pre: ['q', 'buy', 'net'], sort: ['q', 'buy', 'net'], top: ['item', 'net'] } : { pre: ['item', 'net'], sort: ['item', 'net'], top: ['item', 'net'] },
      homeFrame: (n, goR) => goR ? frame(n, grow(goR, Math.max(30, PW * 0.04), Math.max(goR[3] * 0.9, 120)), 0.08, ZMAX, 0.5) : vpCam(n),
      loadFrame: n => vpCam(n) });
    const { pn, sOpen, sRows } = F;
    // ---- VO v11 on the sorted table: where to buy, which quality, what you keep after tax ----
    const v11 = voT('v11', 54.4);
    const itemCol = thRect(sRows, 'item');
    const stickyR = itemCol ? itemCol[0] + itemCol[2] : 0;
    const top = F.rowsAfter[0], topIt = itemsOf(sRows)[0];
    // the top row's item cell; its second line reads tier · type · QUALITY
    const cell0 = topIt && topIt.cells && topIt.cells[0] ? vis(topIt.cells[0], sRows) : null;
    const nameA = actOf(sOpen), nameR = nameA && cell0 && nameA.rect[1] >= cell0[1] - 2 && nameA.rect[1] < cell0[1] + cell0[3] ? nameA.rect : null;
    const subR = cell0 ? (() => {
      const x0 = nameR ? nameR[0] : cell0[0] + Math.min(48, cell0[2] * 0.2), y0 = nameR ? nameR[1] + nameR[3] + 1 : cell0[1] + cell0[3] * 0.45;
      const r = [x0 - 3, y0, cell0[0] + cell0[2] - x0 - 2, cell0[1] + cell0[3] - y0 - 3];
      return r[2] > 20 && r[3] > 8 ? r : null;
    })() : null;
    // a column the sorted capture shows (not scrolled under the sticky item column): its header + the top row's cell
    const colTarget = k => {
      let th = thRect(sRows, k);
      if (th && itemCol && th[0] < stickyR - 4) { const x1 = th[0] + th[2]; th = x1 - stickyR > 40 ? [stickyR, th[1], x1 - stickyR, th[3]] : null; }
      return th && top ? [th[0], th[1], th[2], top[1] + top[3] - th[1]] : null;
    };
    // quality without its column → the sub-line; where-to-buy without its column → a label on the top row (no box;
    // the price card pays it off on 'BUY HERE')
    const colW = [[v11 + 1.3, 'buy', 'WHERE TO BUY'], [v11 + 2.08, 'q', 'WHICH QUALITY'], [v11 + 3.1, 'net', 'AFTER TAX']].map(([tw, k, s]) => {
      let r = colTarget(k), boxed = !!r;
      if (!r && k === 'q' && subR) { r = subR; boxed = true; }
      if (!r && top) { r = cell0 || [top[0], top[1], Math.min(top[2], PW), top[3]]; boxed = false; }
      return { tw, k, r, boxed, s, co: callout(pn.free, s), m: Mark(pn) };
    });
    const colEnd = T.open + 0.1;    // the three labels read together, then leave with the cut to the price card
    // ---- price card: the cheapest city row, the Black Market row ----
    const cityRows = rectsOf(sOpen, 'cityRow'), cityNames = labelsOf(sOpen, 'cityName');
    const cheapLbl = (labelsOf(sOpen, 'chips')[0] || '');
    const ci = cityNames.findIndex(nm => nm && cheapLbl.includes(nm));
    const buyR = vis(cityRows[ci >= 0 ? ci : 0], sOpen) || vis(rectOf(sOpen, 'chips', 0), sOpen);
    const bmR = vis(rectOf(sOpen, 'bmRow') || rectOf(sOpen, 'bmTable'), sOpen) || vis(rectOf(sOpen, 'chips', 2) || rectOf(sOpen, 'chips', 1), sOpen);
    const cardR = vis(rectOf(sOpen, 'card'), sOpen);
    const cardSpot = Spot(pn, 0.55);
    const shotBuy = buyR ? rowShot(sOpen, buyR, FW.row, P ? 40 : 20) : null, shotBm = bmR ? rowShot(sOpen, bmR, FW.row, P ? 40 : 20) : null;
    const cardT = [[T.g1, buyR && inView(buyR, shotBuy), 'BUY HERE'], [T.g2, bmR && inView(bmR, shotBm), 'SELL TO THE BLACK MARKET']].map(([tw, r, s]) => ({ tw, r, s, co: callout(pn.free, s), m: Mark(pn), g: Glint(pn) }));
    const cardList = cardT.map((ct, i) => ({ t0: ct.tw, t1: i === 0 ? cardT[1].tw - 0.05 : T.out - 0.05, r: sOpen ? ct.r : null }));
    // fallback (no price-card capture): the two card lines as kinetic type over the dimmed panel
    const fb = sOpen && cardR ? null : cardT.map((ct, i) => word(pn.free, i ? 'SELL TO THE BLACK MARKET' : 'BUY IN ANY CITY', fitDom(pn.free, 'SELL TO THE BLACK MARKET', 'px', {}, BOX.w * 0.86, (P ? 76 : 60) * U), 'px', { color: i ? '#e46f61' : '#f2f4f8', filter: 'drop-shadow(0 10px 30px rgba(0,0,0,.9))' }, 9));
    if (fb) fb.forEach(w => { w.a.style.opacity = 0; });
    const fbDim = el('div', 'abs', pn.clipL, { left: '0px', top: '0px', width: BOX.w + 'px', height: BOX.h + 'px', background: 'rgba(5,6,10,.62)', opacity: 0 });
    // ---- camera: the column framing holds while the labels are up; 1:1 widens to the clicked name just before the click ----
    const keys = F.keys.slice();
    const ticks = evIn('tick', T.sort, T.open), lastTick = ticks.length ? ticks[ticks.length - 1] : T.sort + 2.25;
    const wd1 = colW[2].tw - 0.04, wd0 = Math.min(wd1 - 0.2, Math.max(lastTick - 0.05, wd1 - 0.32));
    keys.push([wd0, zoomed(sRows, F.camSort, 1.01), E.lin], [wd1, F.camTop, E.ioC], [T.open + 0.1, zoomed(sRows, F.camTop, 1.008), E.lin]);
    if (sOpen && cardR) {
      const camCard = topLeft(sOpen, cardR[0], cardR[1], FW.card);
      keys.push([T.open + 0.7, camCard, E.outQuint], [T.g1 - 0.45, zoomed(sOpen, camCard, 1.02), E.lin], [T.g1 + 0.05, shotBuy || camCard, E.ioC], [T.g2 - 0.4, zoomed(sOpen, shotBuy || camCard, 1.01), E.lin], [T.g2 + 0.1, shotBm || camCard, E.ioC], [T.g2 + 1.1, zoomed(sOpen, shotBm || camCard, 1.03), E.lin], [T.out + 0.1, camCard, E.ioC]);
    } else keys.push([T.out, zoomed(sRows, F.camTop, 1.03), E.ioQ]);
    const camF = track(keys);
    // stacked column labels: each above its target; where it would cover a label already up it slides sideways (as
    // long as it still sits over its target), else it goes up a level. Checked on the column framing and on the one
    // held through the click.
    colW.forEach((cw, i) => {
      cw.lift = 0; cw.nx = 0;
      if (!cw.r) return;
      const cams = [camF(cw.tw), camF(T.open)];
      const box = (o, l, nx, c) => { const r = pn.scrR(o.r, c), [x, y] = sidePos(o.co, r, 'above', l); return [x + nx * c[2] - o.co.w / 2, y - o.co.h / 2, o.co.w, o.co.h]; };
      const ok = (L, nx) => cams.every(c => {
        const me = box(cw, L, nx, c), r = pn.scrR(cw.r, c);
        if (me[0] < Math.max(BOX.x, SAFE.x0) || me[0] + me[2] > Math.min(BOX.x + BOX.w, SAFE.x1)) return false;
        if (Math.min(me[0] + me[2], r[0] + r[2]) - Math.max(me[0], r[0]) < Math.min(r[2], me[2]) * 0.35) return false;
        return colW.slice(0, i).every(o => !o.r || ov(me, box(o, o.lift, o.nx, c)) <= 0);
      });
      search: for (let L = 0; L < 4; L++) {
        for (const nx of [0, 40, -40, 80, -80, 120, -120, 170, -170]) if (ok(L, nx / (P ? 2.2 : 1.5))) { cw.lift = L; cw.nx = nx / (P ? 2.2 : 1.5); break search; }
        cw.lift = L + 1 < 4 ? L + 1 : L;
      }
    });
    const tiltAmt = t => K(t, [[T.in, 0.9], [T.in + 0.7, 0.35], [T.c1 - 0.6, 0], [T.chip + 0.2, 0], [T.chip + 0.9, 0.45], [T.sort - 0.6, 0], [T.sort + 0.3, 0], [T.sort + 0.9, 0.4], [T.open - 0.8, 0.4], [T.open - 0.4, 0], [T.open + 0.6, 0], [T.g1, 0.3], [T.out, 0.65]]);
    // the cursor leaves while the rows re-sort, comes back for the open click, leaves after it
    const curO = t => seg(t, T.in + 0.3, T.in + 0.5) * (1 - seg(t, T.open + 0.6, T.open + 0.9)) * (1 - seg(t, T.sort + 0.4, T.sort + 0.7) * (1 - seg(t, T.open - 0.95, T.open - 0.65)));
    return (t) => {
      pn.pose(t, T.in, T.out, tiltAmt(t));
      flowUpdate(F, t, camF, curO);
      colW.forEach((cw, i) => {
        const r = cw.r && F.sSort ? pn.scrR(cw.r) : null;
        if (!r) { off(cw.co); cw.m.set(null, 0); return; }
        const nextT = i < 2 ? colW[i + 1].tw : 1e9, dimP = seg(t, nextT - 0.05, nextT + 0.15);
        const [x, y] = sidePos(cw.co, r, 'above', cw.lift);
        coSet(cw.co, t, cw.tw, colEnd, x + cw.nx * pn.c[2], y, 1 - 0.38 * dimP);
        cw.m.set(cw.boxed && t < T.open ? r : null, seg(t, cw.tw - 0.1, cw.tw + 0.08) * (1 - 0.6 * dimP), 1 + 0.06 * (1 - spring(t - cw.tw + 0.1, 3, 0.5)));
      });
      spotRun(cardSpot, pn, t, cardList);
      if (fb) {
        fbDim.style.opacity = (0.95 * seg(t, T.g1 - 0.3, T.g1) * (1 - seg(t, T.out - 0.2, T.out))).toFixed(3);
        fb.forEach((w, i) => {
          const a = spring(t - cardT[i].tw, 3.2, 0.5);
          tf(w.a, { x: W / 2, y: BOX.y + BOX.h * 0.5 + (i - 0.5) * (P ? 120 : 90) * U + (1 - a) * 40 * U, s: 0.7 + 0.3 * a, o: t >= cardT[i].tw ? clamp(a * 2) * (1 - seg(t, T.out - 0.2, T.out)) : 0 });
        });
      }
      cardT.forEach((ct, i) => {
        const r = ct.r && sOpen ? pn.scrR(ct.r) : null;
        const t1 = i === 0 ? cardT[1].tw - 0.05 : T.out - 0.05;
        if (r) { const [x, y] = place(ct.co, r); ct.co.set(t, ct.tw + 0.08, t1, x, y); } else off(ct.co);
        ct.m.set(r, seg(t, ct.tw - 0.05, ct.tw + 0.12) * (1 - seg(t, t1 - 0.2, t1)), 1 + 0.1 * (1 - spring(t - ct.tw, 3, 0.5)));
        ct.g.set(t, ct.tw, r);
      });
    };
  }, { z: 30 });

  // ---------------------------------------------------------------- 03 ANY PRICE (UI) ----
  scene('feat_ui3', 65.3, 80.0, (Lr) => {
    const T = { in: evT('whoosh', 65.5), c1: evT('click', 66.5), pop: evT('pop', 69.0), pick: evT('click', 70.0), cardWh: evT('whoosh', 70.25), best: evT('glint', 74.0), out: evT('whoosh', 79.5) };
    const keysT = evIn('key', 66.8, 68.8);
    const keyAt = i => (keysT[i] != null ? keysT[i] : 67 + 0.25 * i);
    const pops = evIn('pop', 70.3, 72.6);
    const pn = Panel(Lr, '03', 'ANY PRICE', GOLD);
    const sEmpty = pick('item_empty'), sFocus = pick('item_focus');
    const sQ = [1, 2, 3, 4, 5, 6, 7].map(i => pick('item_q' + i));
    const sCard = pick('item_card');
    for (const n of [sEmpty, sFocus, ...sQ, sCard]) pn.add(n);
    const sLastQ = [...sQ].reverse().find(Boolean) || sFocus || sEmpty;
    const s0 = sEmpty || sFocus;
    const qR = rectOf(s0, 'q') || rectOf(sLastQ, 'q');
    const qAt = (actOf(sFocus) || {}).at || (qR ? ctr(qR) : null);
    const [cx0] = colOf(s0);
    // the pick: the card's recorded click (in the last suggestion list's layout), else the Master's Cape row
    const cardAct = actOf(sCard);
    const capeIdx = itemsOf(sLastQ).findIndex(it => /^T\d_CAPE$/.test(it.k) || it.name === "Master's Cape");
    const capeR = capeIdx >= 0 ? vis(itemsOf(sLastQ)[capeIdx].rect, sLastQ) : null;
    const pickAt = cardAct ? cardAct.at : (capeR ? [capeR[0] + Math.min(capeR[2], PW) * 0.3, capeR[1] + capeR[3] / 2] : null);
    const pickR = capeR || (cardAct ? vis(cardAct.rect, sLastQ) : null);
    // ---- card rows: 7 cities + the Black Market table, wiped in on the pops (full-width bands of the capture) ----
    const cityRows = rectsOf(sCard, 'cityRow').map(r => vis(r, sCard)).filter(Boolean).slice(0, 7);
    const bmT = vis(rectOf(sCard, 'bmTable'), sCard) || vis(uni(rectsOf(sCard, 'bmRow')), sCard);
    const lastCity = cityRows[cityRows.length - 1];
    // without a Black Market table (no trades recorded) the 8th pop reveals the note under the city table
    const bmFallback = !bmT && lastCity ? (() => { const y0 = lastCity[1] + lastCity[3], cr = vis(rectOf(sCard, 'card'), sCard); const y1 = cr ? Math.min(cr[1] + cr[3], y0 + 46) : y0 + 40; return y1 - y0 > 8 ? [0, y0, PW, y1 - y0] : null; })() : null;
    const bands = [...cityRows, bmT || bmFallback].filter(Boolean).map(r => [0, r[1], PW, r[3]]);
    const inner = pn.view.inner;
    // the card without those bands: crops of the gaps between them
    const gaps = [];
    if (sCard && bands.length) {
      const ord = bands.slice().sort((a, b) => a[1] - b[1]);
      let y = 0;
      for (const b of ord) { if (b[1] - y > 1) gaps.push([0, y, PW, b[1] - y]); y = Math.max(y, b[1] + b[3]); }
      if (stripH(sCard) - y > 1) gaps.push([0, y, PW, stripH(sCard) - y]);
    }
    const baseCrops = gaps.map(g => Crop(inner, sCard, g, 3));
    const rowCrops = sCard ? bands.map((r, i) => ({ r, c: Crop(inner, sCard, r, 4), t0: pops[i] != null ? pops[i] : 70.5 + 0.25 * i,
      edge: el('div', 'abs', inner, { left: '0px', top: r[1] + 'px', width: Math.max(2, 2.5 / zOf(sCard, FW.card) * U) + 'px', height: r[3] + 'px', zIndex: 6, background: '#fff3cf', boxShadow: '0 0 12px 3px rgba(245,212,126,.95)', opacity: 0 }) })) : [];
    const revealDone = rowCrops.length ? rowCrops[rowCrops.length - 1].t0 + 0.3 : T.cardWh;
    const band = bands.length ? uni(bands) : null;
    // ---- best price: the city named in "cheapest to buy" ----
    const cityNames = labelsOf(sCard, 'cityName'), cheap = labelsOf(sCard, 'chips')[0] || '';
    const bi = cityNames.findIndex(nm => nm && cheap.includes(nm));
    const bestRow = bi >= 0 ? vis(rectsOf(sCard, 'cityRow')[bi], sCard) : vis(rectOf(sCard, 'chips', 0), sCard);
    const camBest = bestRow ? rowShot(sCard, bestRow, FW.row, P ? 60 : 30) : null;
    const bestR = bestRow && inView(bestRow, camBest);
    const bestCo = callout(pn.free, bi >= 0 ? 'BEST PRICE' : 'CHEAPEST TO BUY');
    const bestMark = Mark(pn), bestG = Glint(pn), bestSpot = Spot(pn, 0.55);
    // ---- kinetic echo of the typed letters: a gold Pixelify HUD in the space above the search card's heading (the
    // typing shot leaves room for it), on a soft dark backdrop ----
    const echoS = (P ? 82 : S ? 64 : 66) * U;
    const echoA = el('div', 'abs', pn.free, { width: '0px', height: '0px', zIndex: 9 });
    const echoBack = el('div', 'abs', echoA, { width: echoS * 9 + 'px', height: echoS * 3 + 'px', left: -echoS * 4.5 + 'px', top: -echoS * 1.5 + 'px', background: 'radial-gradient(50% 50% at 50% 50%, rgba(6,7,11,.75) 0%, rgba(6,7,11,.4) 55%, rgba(6,7,11,0) 100%)' });
    const pill = el('div', 'abs', echoA, { background: 'rgba(12,14,20,.92)', border: `${Math.max(2, 2.5 * U)}px solid rgba(238,188,78,.7)`, borderRadius: echoS * 0.32 + 'px', boxShadow: '0 18px 50px rgba(0,0,0,.7), 0 0 34px rgba(238,188,78,.25)' });
    const echoT = el('div', 'abs px', echoA, { fontSize: echoS + 'px', lineHeight: 1, whiteSpace: 'nowrap', color: '#f5d47e', letterSpacing: '.04em' });
    const echoChars = [...'mas cap'].map(ch => { const sp = el('span', '', echoT, { display: 'inline-block' }); sp.textContent = ch === ' ' ? ' ' : ch; return sp; });
    const cum = echoChars.map(sp => sp.offsetLeft + sp.offsetWidth), echoH = echoT.offsetHeight;
    const caret = el('div', 'abs', echoT, { top: echoS * 0.06 + 'px', width: Math.max(3, 0.075 * echoS) + 'px', height: echoS * 0.86 + 'px', background: '#f5d47e', boxShadow: '0 0 14px rgba(238,188,78,.8)' });
    const pillPad = echoS * 0.36;
    // ---- flourish: NO SPREADSHEETS. / NO GUESSWORK. ----
    const v14 = voT('v14', 75.6), N1 = v14 + 0.02, N2 = v14 + 1.32;
    const nMax = (P ? 124 : 100) * U;
    const nS = Math.min(fitDom(Lr, 'NO SPREADSHEETS.', 'px', {}, (L ? 0.56 : 0.82) * W, nMax), fitDom(Lr, 'NO GUESSWORK.', 'px', {}, (L ? 0.56 : 0.82) * W, nMax));
    const no1 = word(Lr, 'NO SPREADSHEETS.', nS, 'px', { color: '#f2f4f8', filter: 'drop-shadow(0 12px 30px rgba(0,0,0,.95))' }, 12);
    const no2 = word(Lr, 'NO GUESSWORK.', nS, 'px gold', { filter: 'drop-shadow(0 12px 30px rgba(0,0,0,.95)) drop-shadow(0 0 22px rgba(238,188,78,.35))' }, 12);
    no1.a.style.opacity = 0; no2.a.style.opacity = 0;
    const strike1 = el('div', 'abs', no1.a, { left: -no1.w / 2 - 10 * U + 'px', top: -3 * U + 'px', width: no1.w + 20 * U + 'px', height: Math.max(3, 6 * U) + 'px', background: '#e46f61', transformOrigin: '0 50%', boxShadow: '0 0 16px rgba(228,111,97,.8)' });
    const ul2 = el('div', 'abs', no2.a, { left: -no2.w * 0.45 + 'px', top: no2.h * 0.55 + 'px', width: no2.w * 0.9 + 'px', height: Math.max(3, 5 * U) + 'px', background: 'linear-gradient(90deg, rgba(238,188,78,0), #f5d47e 15%, #eebc4e 85%, rgba(238,188,78,0))', transformOrigin: '50% 50%', boxShadow: '0 0 16px rgba(238,188,78,.7)' });
    const sweepL = el('div', 'abs', pn.clipL, { left: '0px', top: '0px', width: BOX.w + 'px', height: BOX.h + 'px', mixBlendMode: 'screen', opacity: 0, background: 'linear-gradient(110deg, rgba(255,236,190,0) 38%, rgba(255,236,190,.32) 50%, rgba(255,236,190,0) 62%)', backgroundSize: '300% 100%' });
    const dimFl = el('div', 'abs', pn.clipL, { left: '0px', top: '0px', width: BOX.w + 'px', height: BOX.h + 'px', background: 'radial-gradient(70% 60% at 50% 50%, rgba(5,6,10,.72) 0%, rgba(5,6,10,.45) 100%)', opacity: 0 });
    // ---- cuts ----
    // every state change is a hard cut on its event frame (click, key, pick)
    const cuts = cutsOf([[T.in - 0.2, s0, 0], [T.c1, sFocus, 0], ...sQ.map((n, i) => [keyAt(i), n, 0]), [T.pick, sCard, 0]]);
    pn.punches.push([T.c1, 0.008], [T.pick, 0.016]);
    // ---- camera ----
    // the search card centred (9:16: the full width from the status line down)
    const srch = uni([qR, rectOf(s0, 'tier'), vis(rectOf(s0, 'hint'), s0)]);
    const camQ = !qR ? vpCam(s0) : P ? topLeft(s0, cx0, qR[1] - 230, FW.srch)
      : (() => { const z = zOf(s0, Math.max(FW.srch, (uni([qR, rectOf(s0, 'tier')]) || qR)[2] + 80)); return cam(s0, qR[0] - 30 + BOX.w / 2 / z, srch[1] + srch[3] / 2 - 20, z); })();
    // typing: the box near the top, room above its heading for the gold echo, the suggestions below
    const pillH = echoS * 1.0 + echoS * 0.36 * 1.24;
    const headY = qR ? qR[1] - 46 : 0;   // the search card's heading sits ~40 px above the box
    const camType = qR ? (() => {
      const z = zOf(s0, FW.typ), yTop = headY - (pillH + 34 * U) / z - headroom(z) * 0.4;
      return P ? cam(s0, PW / 2, yTop + BOX.h / 2 / z, z) : keep(s0, cam(s0, qR[0] - 40 + BOX.w / 2 / z, yTop + BOX.h / 2 / z, z), qR[0] + qR[2] / 2, qR[1]);
    })() : camQ;
    const listTop = qR ? qR[1] - (P ? 120 : 70) : VH * 0.3;
    const camList = keep(sLastQ, topLeft(sLastQ, cx0, listTop, FW.srch), pickAt && pickAt[0], pickAt && pickAt[1], 120 * U);
    const cardR = vis(rectOf(sCard, 'card'), sCard);
    const camCard = cardR ? topLeft(sCard, cardR[0], cardR[1], FW.card) : vpCam(sCard);
    const camRows = band ? (P ? cam(sCard, PW / 2, band[1] + Math.min(band[3], BOX.h / zOf(sCard, FW.card) * 0.9) / 2 - 20, zOf(sCard, FW.card)) : topLeft(sCard, cardR ? cardR[0] : cx0, band[1] - 40, FW.card)) : camCard;
    const kStart = keyAt(0);
    const camF = track([
      [T.in - 0.2, camQ], [T.c1 + 0.1, camQ], [kStart - 0.05, camType, E.ioC], [T.pop - 0.1, zoomed(s0, camType, 1.03), E.lin],
      [T.pop + 0.35, camList, E.outQuint], [T.pick + 0.08, camList],
      [T.cardWh + 0.25, camCard, E.outQuint], [revealDone, camRows, E.ioQ], [T.best - 0.4, zoomed(sCard, camRows, 1.02), E.ioQ],
      [T.best + 0.05, camBest || camCard, E.ioC], [N1 - 0.3, camBest || camCard], [N1 + 0.5, zoomed(sCard, camCard, 0.98), E.ioC], [T.out, zoomed(sCard, camCard, 1.04), E.lin],
    ]);
    const pickV = pickR && inView(pickR, camList);
    const pts = [];
    if (qAt) pts.push([T.in + 0.3, qAt[0] + PW * 0.45, qAt[1] + VH * 0.3], [T.c1 - 0.28, qAt[0] + 3, qAt[1] + 3], [T.c1, ...qAt], [T.c1 + 0.2, ...qAt], [kStart + 0.25, qAt[0] + PW * 0.2, qAt[1] + 90]);
    if (pickAt) pts.push([T.pop + 0.3, pickAt[0] + PW * 0.2, pickAt[1] - 40], [T.pick - 0.42, pickAt[0] + 2, pickAt[1] + 2], [T.pick, ...pickAt], [T.pick + 0.2, ...pickAt], [T.cardWh + 0.5, pickAt[0] + PW * 0.5, pickAt[1] + VH * 0.4]);
    if (!pts.length) pts.push([T.in, PW * 1.3, VH]);
    const clicks = [qAt ? T.c1 : null, pickAt ? T.pick : null].filter(x => x != null);
    const qMark = Mark(pn), pickMark = Mark(pn), clickM = Mark(pn);
    const tiltAmt = t => K(t, [[T.in, 0.9], [T.in + 0.7, 0.3], [T.c1 - 0.5, 0], [T.pick + 0.3, 0], [T.cardWh + 0.4, 0.25], [T.best - 0.2, 0], [T.best + 0.6, 0], [N1, 1.5], [N2 + 0.8, 1.2], [T.out, 0.9]]);
    return (t) => {
      pn.pose(t, T.in, T.out, tiltAmt(t));
      // the card lifts toward the camera on "No spreadsheets."
      const lift = seg(t, N1 - 0.1, N1 + 0.5, E.outB) * (1 - seg(t, T.out, T.out + 0.3));
      if (lift > 0) pn.tilt.style.transform += ` translateZ(${(lift * 90 * U).toFixed(1)}px)`;
      const c = camF(t);
      pn.setCam(c);
      pn.camBlur(camF, t);
      // states; while the card's rows are revealed the card is drawn from its gap crops + row crops
      const revealing = !!(sCard && band && t >= T.pick && t < revealDone);
      const bo = revealing ? 1 : 0;
      if (revealing) pn.mix({ __top: null });
      else pn.mix(mixAt(cuts, t));
      for (const bc of baseCrops) bc.w.style.opacity = bo.toFixed(3);
      for (const rc of rowCrops) {
        const p = seg(t, rc.t0, rc.t0 + 0.2, E.outC);
        const on = revealing && t >= rc.t0;
        rc.c.w.style.opacity = on ? 1 : 0;
        rc.c.w.style.clipPath = `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)`;
        tf(rc.c.w, { bright: on ? 1 + 0.7 * Math.exp(-(t - rc.t0) / 0.18) : 1 });
        rc.edge.style.opacity = on && p < 1 ? (1 - p * 0.6).toFixed(3) : 0;
        rc.edge.style.left = (rc.r[0] + rc.r[2] * p) + 'px';
      }
      // cursor
      const [px, py] = cursorPath(t, pts);
      const [sx, sy] = pn.scr(px, py);
      pn.cur.set(t, sx, sy, clicks, seg(t, T.in + 0.3, T.in + 0.5) * (1 - seg(t, T.cardWh + 0.3, T.cardWh + 0.6)));
      // search box glow while typing; the picked row
      const qr = qR ? pn.scrR(qR) : null;
      qMark.set(qr, seg(t, T.c1, T.c1 + 0.1) * (1 - seg(t, T.pop - 0.1, T.pop + 0.2)) * (0.8 + 0.2 * Math.sin(t * 12)), 1, 5 * U);
      // the picked suggestion: marked while the cursor comes in and presses, gone with the cut to the card
      const pr = pickV && t < T.pick ? pn.scrR(pickV) : null;
      pickMark.set(pr, seg(t, T.pick - 0.45, T.pick - 0.3), 1 + 0.04 * (1 - spring(t - T.pick + 0.45, 3, 0.5)) - 0.03 * seg(t, T.pick - 0.1, T.pick));
      const dc = t - T.c1;
      clickM.set(qr && dc > -0.02 && dc < 0.5 ? qr : null, dc < 0 ? 0 : 1 - seg(dc, 0.18, 0.5), 1.12 - 0.12 * E.outC(clamp(dc / 0.2)), 9 * U);
      // typed letters echo
      let n = 0; for (let i = 0; i < 7; i++) if (t >= keyAt(i)) n = i + 1;
      const wN = n ? cum[n - 1] : 0;
      const echoOn = seg(t, kStart - 0.06, kStart + 0.04) * (1 - seg(t, T.pop + 0.06, T.pop + 0.26));
      // centred in the room above the search card's heading (never over the heading, never above the panel)
      // (held where it was once the camera leaves the typing shot for the full list)
      const hy = qR ? pn.scr(0, headY, camF(Math.min(t, T.pop - 0.1)))[1] : BOX.y + BOX.h * 0.3;
      const ey = Math.max(BOX.y + 16 * U + pillH / 2, Math.min(hy - 14 * U - pillH / 2, (BOX.y + TOPFADE * 0.5 + hy) / 2));
      tf(echoA, { x: W / 2, y: ey, o: echoOn, s: 1 + 0.18 * seg(t, T.pop, T.pop + 0.3, E.inQ) });
      const caretW = Math.max(3, 0.075 * echoS) + 0.08 * echoS;
      const totW = wN + caretW;
      echoT.style.left = (-totW / 2) + 'px'; echoT.style.top = (-echoH / 2) + 'px';
      caret.style.left = (wN + 0.06 * echoS) + 'px';
      caret.style.opacity = n >= 7 ? (Math.floor(t * 3.2) % 2 ? 0.25 : 1) : 1;
      pill.style.left = (-totW / 2 - pillPad) + 'px'; pill.style.top = (-echoH / 2 - pillPad * 0.62) + 'px';
      pill.style.width = (totW + 2 * pillPad) + 'px'; pill.style.height = (echoH + pillPad * 1.24) + 'px';
      echoChars.forEach((ch, i) => {
        const d = t - keyAt(i), a = spring(d, 3.6, 0.45);
        tf(ch, { y: (1 - a) * -0.45 * echoS, s: 1 + 0.5 * (1 - clamp(a)), o: d >= 0 ? clamp(a * 2.5) : 0 });
      });
      // best price
      spotRun(bestSpot, pn, t, bestR && sCard ? [{ t0: T.best, t1: N1 - 0.1, r: bestR }] : []);
      const br = bestR && sCard ? pn.scrR(bestR) : null;
      if (br) { const [x, y] = place(bestCo, br); bestCo.set(t, T.best + 0.05, N1 - 0.15, x, y); } else off(bestCo);
      bestMark.set(br, seg(t, T.best - 0.05, T.best + 0.12) * (1 - seg(t, N1 - 0.35, N1 - 0.1)), 1 + 0.1 * (1 - spring(t - T.best, 3, 0.5)));
      bestG.set(t, T.best, br);
      // flourish
      const f1 = spring(t - N1, 3.2, 0.48), f2 = spring(t - N2, 3.2, 0.48), fo = seg(t, T.out - 0.1, T.out + 0.25);
      const yC = BOX.y + BOX.h * 0.5;
      dimFl.style.opacity = (seg(t, N1 - 0.1, N1 + 0.25) * (1 - fo)).toFixed(3);
      tf(no1.a, { x: W / 2 + (1 - clamp(f1)) * -W * 0.1, y: yC - nS * 0.66, s: 1 + 0.25 * (1 - clamp(f1)), o: t >= N1 ? clamp(f1 * 2) * (1 - fo) : 0, blur: (1 - clamp(f1)) * 6 });
      tf(strike1, { sx: Math.max(0.001, seg(t, N1 + 0.62, N1 + 0.86, E.outC)), o: 0.92 });
      tf(no2.a, { x: W / 2 + (1 - clamp(f2)) * W * 0.1, y: yC + nS * 0.66, s: 1 + 0.25 * (1 - clamp(f2)), o: t >= N2 ? clamp(f2 * 2) * (1 - fo) : 0, blur: (1 - clamp(f2)) * 6 });
      tf(ul2, { sx: Math.max(0.001, seg(t, N2 + 0.3, N2 + 0.55, E.outC)) });
      const sw = seg(t, N1 + 0.05, N1 + 0.95, E.ioQ), sw2 = seg(t, N2 + 0.05, N2 + 0.95, E.ioQ);
      const swp = t < N2 ? sw : sw2;
      sweepL.style.opacity = swp > 0 && swp < 1 ? 1 : 0; sweepL.style.backgroundPosition = `${(100 - 100 * swp).toFixed(1)}% 0`;
    };
  }, { z: 30 });
})();
