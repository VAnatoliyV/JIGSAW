// ENDING (88–120 s): the night city breathes ("the market never sleeps") → an odometer counts the base
// on the accelerating ticks → 6,985 lands → the number docks into the REAL stat tile, the real "⚡ seconds"
// tile is struck by lightning → "UPDATED IN SECONDS" → everything implodes into a core → the real anvil is
// struck on the final chorus with the real wordmark → stamped "STOP GUESSING. / START CRAFTING." → CTA with
// the real button / chips crops, the URL types on the key clicks, a cursor clicks "Open Crafting →" →
// final hit, final lockup with the real footer, fade to black.
(function () {
  const { W, H, U, E, K, seg, spring, clamp, lerp, hash, noise1, el, tf, show, scene, P, L, S, motionBlur, evs } = FX;
  const { Anvil, Cursor, cursorPath, stateInfo } = FX.lib;
  const HOME = stateInfo('home') || { pieces: {} };
  const piece = (k, i = 0) => ((HOME.pieces || {})[k] || [])[i];
  const CX = W / 2, CY = H / 2, TAU = Math.PI * 2;
  const NUM_TXT = '6,985', FINAL_N = 6985;
  const URL_TXT = 'vanatoliyv.github.io/albion-craft-profit', URL_HOST = 21;   // 'vanatoliyv.github.io/'
  const URL_CHUNKS = ['van', 'atol', 'iyv', '.git', 'hub', '.io', '/alb', 'ion-', 'cra', 'ft-', 'pro', 'fit'];

  // ---------------- helpers ----------------
  const anchor = (parent, z) => el('div', 'abs', parent, { width: '0px', height: '0px', zIndex: z == null ? 'auto' : String(z) });
  // a real UI crop centred on its anchor. k = screen px per page CSS px.
  function pieceA(parent, key, i, k, z) {
    const p = piece(key, i), a = anchor(parent, z);
    if (!p) { console.warn('missing piece', key, i); return { a, w: 1, h: 1, im: el('div', '', a), p: null }; }
    const w = p.rect[2] * k, h = p.rect[3] * k;
    const im = el('img', 'abs', a, { left: -w / 2 + 'px', top: -h / 2 + 'px', width: w + 'px', height: h + 'px' });
    im.src = p.img;
    return { a, im, w, h, p };
  }
  // text centred on its anchor (measured in the DOM)
  function textA(parent, html, size, cls, style, z) {
    const a = anchor(parent, z);
    const e = el('div', 'abs ' + cls, a, Object.assign({ fontSize: size + 'px', whiteSpace: 'nowrap', lineHeight: 1 }, style || {}));
    e.innerHTML = html;
    const w = e.offsetWidth, h = e.offsetHeight;
    e.style.left = -w / 2 + 'px'; e.style.top = -h / 2 + 'px';
    return { a, e, w, h, size };
  }
  // largest font size (<= max) at which html fits maxW, measured in the DOM (letter-spacing included)
  function fitDom(parent, html, cls, style, maxW, max) {
    const pr = el('div', 'abs ' + cls, parent, Object.assign({ fontSize: '100px', whiteSpace: 'nowrap', lineHeight: 1, visibility: 'hidden' }, style || {}));
    pr.innerHTML = html; const w = pr.offsetWidth; pr.remove();
    return Math.min(max, maxW * 100 / w);
  }
  // keyframed object states [[t, {x,y,s,o}, ease], ...]
  function KO(t, keys) { const o = {}; for (const k in keys[0][1]) o[k] = K(t, keys.map(([tt, v, e]) => [tt, v[k], e])); return o; }
  const mixO = (a, b, p) => { const o = {}; for (const k in a) o[k] = lerp(a[k], b[k], p); return o; };
  // vertical stack centred on cy: items [{h, gap}] -> centre y of each
  function stack(items, cy) {
    const tot = items.reduce((a, it, i) => a + it.h + (i ? it.gap : 0), 0);
    let y = cy - tot / 2; const out = [];
    items.forEach((it, i) => { if (i) y += it.gap; out.push(y + it.h / 2); y += it.h; });
    return out;
  }
  // light sweep across a real crop (masked by the crop's own alpha)
  function sheen(A, color = 'rgba(255,244,214,.75)') {
    if (!A.p) return null;
    return el('div', 'abs', A.a, { left: -A.w / 2 + 'px', top: -A.h / 2 + 'px', width: A.w + 'px', height: A.h + 'px', opacity: 0,
      background: `linear-gradient(100deg, rgba(255,255,255,0) 40%, ${color} 50%, rgba(255,255,255,0) 60%)`, backgroundSize: '300% 100%',
      WebkitMaskImage: `url(${A.p.img})`, maskImage: `url(${A.p.img})`, WebkitMaskSize: '100% 100%', maskSize: '100% 100%', mixBlendMode: 'screen' });
  }
  const sweep = (sh, t, t0, d = 0.6) => { if (!sh) return; const p = seg(t, t0, t0 + d, E.ioQ); sh.style.opacity = p > 0 && p < 1 ? 1 : 0; sh.style.backgroundPosition = `${(100 - 100 * p).toFixed(1)}% 0`; };

  // heartbeat: timpani + bass drum of the breakdown (audio-src/music/score.py, bars 45-48)
  const HB = [];
  for (const b of [88, 90, 92]) HB.push([b, 1], [b + 0.25, 0.68], [b + 1, 0.94], [b + 1.25, 0.62]);
  for (let k = 0; k < 8; k++) HB.push([94 + k * 0.25, 0.5 + 0.07 * k]);
  const heart = t => { let v = 0; for (const [bt, a] of HB) { const d = t - bt; if (d >= 0 && d < 0.7) v = Math.max(v, a * Math.exp(-d / 0.11)); } return v; };

  // ---------------- lightning (deterministic midpoint displacement) ----------------
  function boltPts(x0, y0, x1, y1, seed, rough = 0.32, depth = 5) {
    let pts = [[x0, y0], [x1, y1]];
    for (let d = 0; d < depth; d++) {
      const np = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const off = (hash(seed * 131 + d * 977 + i, 17) - 0.5) * len * rough;
        np.push([(ax + bx) / 2 - (by - ay) / len * off, (ay + by) / 2 + (bx - ax) / len * off], pts[i + 1]);
      }
      pts = np;
    }
    return pts;
  }
  function strokeBolt(ctx, pts, w, a) {
    if (a <= 0.01) return;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(106,165,224,${(a * 0.22).toFixed(3)})`; ctx.lineWidth = w * 7; ctx.stroke();
    ctx.strokeStyle = `rgba(170,210,255,${(a * 0.5).toFixed(3)})`; ctx.lineWidth = w * 2.6; ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`; ctx.lineWidth = w; ctx.stroke();
  }
  // point on a rect perimeter, u in [0,1)
  function perim(r, u) {
    const [cx, cy, w, h] = r, per = 2 * (w + h); let d = ((u % 1) + 1) % 1 * per;
    if (d < w) return [cx - w / 2 + d, cy - h / 2]; d -= w;
    if (d < h) return [cx + w / 2, cy - h / 2 + d]; d -= h;
    if (d < w) return [cx + w / 2 - d, cy + h / 2]; d -= w;
    return [cx - w / 2, cy + h / 2 - d];
  }

  // =====================================================================================
  // 1. BREAKDOWN 88–96: night Caerleon, moonlight grade, fog, "THE MARKET / NEVER SLEEPS"
  // =====================================================================================
  scene('end_night', 88.0, 96.0, (Lr) => {
    el('div', 'fill', Lr, { background: '#04060b' });
    const IW = 2200, IH = 620;
    const c0 = Math.max(W / IW, H / IH) * 1.06;
    const mkImg = (filter, blend) => { const im = el('img', 'abs', Lr, { left: '0px', top: '0px', width: IW + 'px', height: IH + 'px', transformOrigin: '0 0', filter, mixBlendMode: blend || 'normal' }); im.src = '../assets/cities/caerleon-hero.webp'; return im; };
    const city = mkImg('saturate(.62) brightness(1.18) contrast(1.06)');
    const tint = el('div', 'fill', Lr, { background: 'linear-gradient(180deg, rgba(160,184,240,1) 0%, rgba(132,156,226,1) 50%, rgba(84,100,170,1) 100%)', mixBlendMode: 'multiply' });
    // torches and windows keep their warm glow: a hard-contrast copy screened on top
    const lights = mkImg('brightness(.95) contrast(3.2) saturate(1.15) hue-rotate(14deg)', 'screen');
    const moon = el('div', 'fill', Lr, { background: 'radial-gradient(70% 45% at 76% 0%, rgba(160,190,255,.34) 0%, rgba(110,140,220,.12) 45%, rgba(0,0,0,0) 78%)', mixBlendMode: 'screen' });
    const fogs = [0, 1, 2, 3].map(i => el('div', 'abs', Lr, { width: W * 1.7 + 'px', height: H * (P ? 0.26 : 0.42) + 'px', left: -W * 0.35 + 'px', top: H * (P ? 0.16 + 0.2 * i : 0.05 + 0.24 * i) + 'px',
      background: 'radial-gradient(50% 50% at 50% 50%, rgba(150,172,222,.20) 0%, rgba(150,172,222,.07) 45%, rgba(150,172,222,0) 72%)', mixBlendMode: 'screen' }));
    const floor = el('div', 'fill', Lr, { background: 'linear-gradient(0deg, rgba(6,9,18,.92) 0%, rgba(6,9,18,0) 38%), linear-gradient(180deg, rgba(6,9,18,.7) 0%, rgba(6,9,18,0) 22%)' });
    const shade = el('div', 'fill', Lr, { background: '#03050a', opacity: 0 });
    const pulse = el('div', 'fill', Lr, { background: `radial-gradient(${P ? '75% 34%' : '55% 48%'} at 50% 50%, rgba(238,150,70,.34) 0%, rgba(238,120,60,.10) 45%, rgba(0,0,0,0) 75%)`, mixBlendMode: 'screen', opacity: 0 });
    const textBed = el('div', 'fill', Lr, { background: `radial-gradient(${P ? '62% 20%' : '46% 32%'} at 50% ${P ? 33 : 45}%, rgba(3,5,10,.62) 0%, rgba(3,5,10,0) 100%)` });
    const cold = el('div', 'fill', Lr, { background: 'rgba(190,212,255,1)', mixBlendMode: 'screen', opacity: 0 });
    // drifting moonlit motes
    const cv = el('canvas', 'fill', Lr); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');

    // ---- kinetic type ----
    const block = anchor(Lr, 10);
    const maxW = W * (L ? 0.66 : P ? 0.86 : 0.82), maxS = (P ? 200 : S ? 160 : 180) * U;
    const sz = Math.min(fitDom(Lr, 'THE MARKET', 'px', {}, maxW, maxS), fitDom(Lr, 'NEVER SLEEPS', 'px', {}, maxW, maxS));
    const gapL = sz * 0.16;
    const WORDS = [
      { s: 'THE', line: 0, t: 88.78, fx: 'rise' }, { s: 'MARKET', line: 0, t: 88.92, fx: 'drop' },
      { s: 'NEVER', line: 1, t: 89.52, fx: 'slide', gold: true }, { s: 'SLEEPS', line: 1, t: 90.0, fx: 'slam', gold: true },
    ];
    const space = sz * 0.3;
    for (const ln of [0, 1]) {
      const ws = WORDS.filter(w => w.line === ln);
      ws.forEach(w => {
        w.e = el('div', 'abs px', block, { fontSize: sz + 'px', lineHeight: 1, whiteSpace: 'nowrap', color: '#eef1f6', filter: 'drop-shadow(0 10px 30px rgba(0,0,0,.85))' });
        w.chars = [...w.s].map(c => { const sp = el('span', w.gold ? 'gold' : '', w.e, { display: 'inline-block' }); sp.textContent = c; return sp; });
        w.w = w.e.offsetWidth; w.h = w.e.offsetHeight;
      });
      const lw = ws.reduce((a, w) => a + w.w, 0) + space * (ws.length - 1);
      let x = -lw / 2;
      const cy = (ln ? 1 : -1) * (sz / 2 + gapL / 2);
      ws.forEach(w => { w.e.style.left = x + 'px'; w.e.style.top = (cy - w.h / 2) + 'px'; x += w.w + space; });
    }
    const andT = textA(block, 'AND', (P ? 36 : 40) * U, 'inter', { fontWeight: 700, letterSpacing: '.7em', paddingLeft: '.7em', color: '#eebc4e' });
    tf(andT.a, { y: -(sz + gapL / 2) - 0.36 * sz });
    const BY = H * (P ? 0.33 : 0.45);

    return (t) => {
      const dt0 = t - 88;
      // city: hard cut on the impact, settle, slow push-in, suck-in on the reverse cymbal
      const z = 1 + 0.12 * seg(t, 88, 96, E.ioQ) + 0.08 * Math.exp(-dt0 / 0.2) + 0.45 * seg(t, 95.45, 96.0, E.inE);
      const cs = c0 * z, fx = P ? 0.53 : 0.5, fy = 0.5;
      const tx = clamp(CX - fx * IW * cs - dt0 * 5 * U, W - IW * cs, 0), ty = clamp(CY - fy * IH * cs, H - IH * cs, 0);
      const tr = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale(${cs.toFixed(5)})`;
      city.style.transform = tr; lights.style.transform = tr;
      const hb = heart(t);
      lights.style.opacity = (0.5 + 0.12 * noise1(t * 7, 11) + 0.25 * hb).toFixed(3);
      cold.style.opacity = (0.55 * Math.exp(-dt0 / 0.12)).toFixed(3);
      shade.style.opacity = clamp(0.1 - 0.08 * hb + 0.42 * seg(t, 91.7, 92.3) + 0.4 * seg(t, 95.3, 96.0, E.inQ)).toFixed(3);
      pulse.style.opacity = (0.12 + 0.75 * hb).toFixed(3);
      fogs.forEach((f, i) => tf(f, { x: ((i % 2 ? -1 : 1) * (dt0 * (14 + 8 * i)) + 120 * Math.sin(i * 2.1)) * U, o: 0.75 + 0.25 * Math.sin(t * 0.7 + i) }));
      moon.style.opacity = (0.85 + 0.15 * Math.sin(t * 0.9)).toFixed(3);
      // motes
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 90; i++) {
        const sp = (8 + 22 * hash(i, 5)) * U;
        const x = hash(i, 1) * W + dt0 * (hash(i, 2) - 0.5) * 40 * U + noise1(t * 0.35 + i, 3) * 40 * U;
        const y = (((hash(i, 4) * H - dt0 * sp) % H) + H) % H;
        const r = (1.2 + 2.6 * hash(i, 6)) * U, a = (0.12 + 0.4 * hash(i, 7)) * (0.6 + 0.4 * Math.sin(t * 2.2 + i)) * (1 - 0.6 * seg(t, 91.8, 92.4));
        ctx.fillStyle = `rgba(190,210,255,${(a * 0.35).toFixed(3)})`; ctx.fillRect(x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
        ctx.fillStyle = `rgba(225,235,255,${a.toFixed(3)})`; ctx.fillRect(x - r / 2, y - r / 2, r, r);
      }
      ctx.globalCompositeOperation = 'source-over';
      // words, synced to the VO ("And the market never sleeps", 88.60-90.48)
      for (const w of WORDS) {
        const dt = t - w.t;
        if (dt < 0) { w.e.style.opacity = 0; continue; }
        w.e.style.opacity = 1;
        if (w.fx === 'rise') w.chars.forEach((c, j) => { const a = spring(dt - j * 0.035, 3, 0.62); tf(c, { y: (1 - a) * 0.65 * sz, o: clamp(a * 1.6) }); });
        if (w.fx === 'drop') w.chars.forEach((c, j) => { const a = spring(dt - j * 0.035, 3.2, 0.5); tf(c, { y: -(1 - a) * 0.8 * sz, r: (1 - a) * (j % 2 ? 9 : -9), o: clamp(a * 1.6) }); });
        if (w.fx === 'slide') { const p = seg(dt, 0, 0.34, E.outE); tf(w.e, { x: -(1 - p) * W * 0.45, o: p, blur: (1 - p) * 16 }); }
        if (w.fx === 'slam') { const p = seg(dt, 0, 0.24, E.outE); tf(w.e, { s: lerp(1.7, 1, p), o: clamp(dt / 0.05), blur: (1 - p) * 12, bright: 1 + 0.25 * hb }); }
      }
      const ap = seg(t, 88.6, 88.95, E.outC);
      andT.e.style.opacity = ap.toFixed(3);
      andT.e.style.clipPath = `inset(0 ${(50 - 50 * ap).toFixed(1)}% 0 ${(50 - 50 * ap).toFixed(1)}%)`;
      // heartbeat + slow push; zoom-through exit into the counter
      const ex = seg(t, 91.68, 92.0, E.inQ);
      tf(block, { x: CX, y: BY, s: (1 + 0.03 * hb) * (1 + 0.05 * seg(t, 89, 91.7, E.ioQ)) * (1 + 1.8 * ex), o: 1 - ex, blur: ex * 10 });
      textBed.style.opacity = (1 - ex).toFixed(3);
    };
  }, { z: 21 });

  // =====================================================================================
  // 2-4. COUNTER 92–96, METRIC 96–100, BUILD 100–104
  // =====================================================================================
  scene('end_metric', 91.7, 104.35, (Lr) => {
    // ---------- god rays (build) ----------
    const D = 2 * Math.hypot(W, H);
    const rays = el('div', 'abs', Lr, { left: CX - D / 2 + 'px', top: CY - D / 2 + 'px', width: D + 'px', height: D + 'px', opacity: 0,
      background: 'repeating-conic-gradient(from 0deg, rgba(255,214,140,0) 0deg, rgba(255,214,140,.16) 3deg, rgba(255,214,140,0) 6deg, rgba(255,214,140,0) 14deg)',
      WebkitMaskImage: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 2%, #000 9%, rgba(0,0,0,.6) 22%, rgba(0,0,0,0) 34%)', maskImage: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 2%, #000 9%, rgba(0,0,0,.6) 22%, rgba(0,0,0,0) 34%)' });
    const warm = el('div', 'fill', Lr, { background: `radial-gradient(${P ? '80% 40%' : '60% 55%'} at 50% 46%, rgba(238,188,78,.22) 0%, rgba(238,188,78,.06) 40%, rgba(238,188,78,0) 72%)`, opacity: 0 });

    // ---------- flood of real item names (counter backdrop) ----------
    const names = (window.ITEMS && ITEMS.names) || ['Item'];
    const pitch = (P ? 52 : 46) * U, fs = (P ? 26 : 23) * U;
    const flood = el('div', 'fill', Lr, { opacity: 0 });
    const rows = [];
    for (let r = 0; r < Math.ceil(H / pitch) + 1; r++) {
      const row = el('div', 'abs inter', flood, { top: (r * pitch) + 'px', left: '0px', fontSize: fs + 'px', fontWeight: 500, whiteSpace: 'nowrap', color: '#8b93a8' });
      let html = '';
      for (let k = 0; k < 14; k++) {
        const nm = names[Math.floor(hash(r * 37 + k, 211) * names.length)].replace(/&/g, '&amp;');
        const hc = hash(r * 37 + k, 212);
        html += `<span style="${hc > 0.88 ? 'color:#c9a24a' : ''}">${nm}</span><span style="color:#333c55;margin:0 .9em">◆</span>`;
      }
      row.innerHTML = html + html;
      rows.push({ row, w: row.offsetWidth / 2, dir: r % 2 ? 1 : -1, v: (120 + 160 * hash(r, 213)) * U, ph: hash(r, 214) });
    }
    const floodBed = el('div', 'fill', Lr, { background: `radial-gradient(${P ? '72% 24%' : '50% 36%'} at 50% ${P ? 42 : 45}%, rgba(8,9,13,.97) 0%, rgba(8,9,13,.8) 55%, rgba(8,9,13,0) 100%)`, opacity: 0 });
    // one real item name lights up on every tick
    const TICKS = evs('tick', 'counter').map(e => e.t);
    const pops = TICKS.map((tt, i) => {
      const T = textA(Lr, names[Math.floor(hash(i, 221) * names.length)].replace(/&/g, '&amp;'), (P ? 34 : 30) * U, 'inter', { fontWeight: 600, color: '#f5d47e', textShadow: '0 0 18px rgba(238,188,78,.7)' }, 3);
      const side = i % 2 ? 1 : -1;
      const x = CX + side * W * (0.18 + 0.14 * hash(i, 222)), y = H * (P ? (i % 4 < 2 ? 0.16 + 0.12 * hash(i, 223) : 0.68 + 0.14 * hash(i, 223)) : (i % 4 < 2 ? 0.12 + 0.12 * hash(i, 223) : 0.74 + 0.12 * hash(i, 223)));
      return { T, t: tt, x: clamp(x, T.w / 2 + W * 0.05, W - T.w / 2 - W * 0.05), y };
    });

    // ---------- the odometer ----------
    // fixed-width digit columns: size the odometer from the widest digit
    const pr = el('div', 'abs px', Lr, { fontSize: '100px', lineHeight: 1, visibility: 'hidden' });
    let w100 = 0; for (const d of '0123456789') { pr.textContent = d; w100 = Math.max(w100, pr.offsetWidth); }
    pr.textContent = ','; const c100 = pr.offsetWidth * 1.15;
    const numSize = Math.min((P ? 330 : S ? 280 : 300) * U, W * (L ? 0.5 : P ? 0.76 : 0.68) * 100 / (4 * w100 + c100));
    pr.style.fontSize = numSize + 'px';
    let colW = 0; for (const d of '0123456789') { pr.textContent = d; colW = Math.max(colW, pr.offsetWidth); }
    pr.textContent = ','; const commaW = pr.offsetWidth * 1.15; pr.textContent = '0'; const cellH = pr.offsetHeight; pr.remove();
    const numW = colW * 4 + commaW;
    const num = anchor(Lr, 8);
    const numBox = el('div', 'abs', num, { left: -numW / 2 + 'px', top: -cellH / 2 + 'px', width: numW + 'px', height: cellH + 'px' });
    const glowF = 'drop-shadow(0 0 34px rgba(238,188,78,.38)) drop-shadow(0 14px 30px rgba(0,0,0,.85))';
    numBox.style.filter = glowF;
    const drum = 'linear-gradient(180deg, rgba(0,0,0,0) 0%, #000 11%, #000 89%, rgba(0,0,0,0) 100%)';
    const cols = []; let comma = null, xx = 0;
    for (const k of [3, -1, 2, 1, 0]) {
      if (k < 0) { comma = el('div', 'abs px gold', numBox, { left: xx + 'px', top: '0px', width: commaW + 'px', height: cellH + 'px', fontSize: numSize + 'px', lineHeight: cellH + 'px', textAlign: 'center' }); comma.textContent = ','; xx += commaW; continue; }
      const box = el('div', 'abs', numBox, { left: xx + 'px', top: '0px', width: colW + 'px', height: cellH + 'px', overflow: 'hidden', WebkitMaskImage: drum, maskImage: drum });
      const strip = el('div', 'abs', box, { left: '0px', top: '0px', width: colW + 'px' });
      for (let d = 0; d < 11; d++) { const c = el('div', 'px gold', strip, { width: colW + 'px', height: cellH + 'px', fontSize: numSize + 'px', lineHeight: cellH + 'px', textAlign: 'center' }); c.textContent = String(d % 10); }
      const mb = motionBlur(); strip.style.filter = mb.url;
      cols.push({ k, box, strip, mb }); xx += colW;
    }
    // values on the 16 accelerating ticks, then 6,985 on the hit
    const STEPS = TICKS.map((tt, i) => ({ t: tt, v: Math.max(3 + i, Math.round(FINAL_N * Math.pow((i + 1) / (TICKS.length + 1), 1.75) + (hash(i, 231) - 0.5) * 70)) }));
    for (let i = 1; i < STEPS.length; i++) STEPS[i].v = Math.max(STEPS[i].v, STEPS[i - 1].v + 7);
    STEPS.push({ t: 96.0, v: FINAL_N, snap: true });
    function roll(t) {
      let i = -1; for (let j = 0; j < STEPS.length; j++) if (t >= STEPS[j].t) i = j;
      if (i < 0) return { from: 0, to: 0, x: 1 };
      const st = STEPS[i], from = i ? STEPS[i - 1].v : 0, next = i + 1 < STEPS.length ? STEPS[i + 1].t : st.t + 1;
      const d = st.snap ? 0 : Math.min(0.14, 0.82 * (next - st.t));
      return { from, to: st.v, x: d ? clamp((t - st.t) / d) : 1 };
    }
    const colPos = (t, k) => { const r = roll(t); const n1 = Math.floor(r.to / 10 ** k), n0 = Math.max(Math.floor(r.from / 10 ** k), n1 - 9); return lerp(n0, n1, E.outB(r.x)); };
    const valueAt = t => { const r = roll(t); return lerp(r.from, r.to, E.outC(r.x)); };
    // label (the site's own wording) + gold hairline progress
    const lblSize = (P ? 42 : S ? 34 : 36) * U;
    const label = textA(Lr, 'ITEMS IN THE BASE', lblSize, 'inter', { fontWeight: 600, letterSpacing: '.34em', paddingLeft: '.34em', color: '#b7bfcf' }, 8);
    const hair = anchor(Lr, 8);
    const hairBar = el('div', 'abs', hair, { left: -numW * 0.46 + 'px', top: -1.5 * U + 'px', width: numW * 0.92 + 'px', height: 3 * U + 'px', transformOrigin: '0 50%', background: 'linear-gradient(90deg, rgba(238,188,78,0), #f5d47e 15%, #eebc4e 85%, rgba(238,188,78,0))', boxShadow: '0 0 16px rgba(238,188,78,.7)' });
    const numY = H * (P ? 0.41 : 0.42);
    const hairY = numY + cellH * 0.5 + 10 * U, lblY = hairY + 26 * U + label.h / 2;
    const numSheen = el('div', 'abs', num, { left: -numW * 0.6 + 'px', top: -cellH * 0.6 + 'px', width: numW * 1.2 + 'px', height: cellH * 1.2 + 'px', opacity: 0, mixBlendMode: 'overlay',
      background: 'linear-gradient(100deg, rgba(255,255,255,0) 42%, rgba(255,255,255,1) 50%, rgba(255,255,255,0) 58%)', backgroundSize: '300% 100%' });
    // shock rings
    const rings = [0, 1].map(i => { const a = anchor(Lr, 7); el('div', 'abs', a, { left: -320 * U + 'px', top: -320 * U + 'px', width: 640 * U + 'px', height: 640 * U + 'px', borderRadius: '50%', border: `${(i ? 4 : 9) * U}px solid rgba(255,232,180,.95)`, boxShadow: '0 0 50px rgba(238,188,78,.75), inset 0 0 40px rgba(238,188,78,.45)' }); return a; });

    // ---------- the real stat tiles ----------
    const kT = P ? 3.3 : S ? 2.75 : 3.4;
    const tiles = [0, 1, 2].map(i => pieceA(Lr, 'stat', i, kT, 6));
    const sheens = tiles.map(T => sheen(T));
    const gT = (P ? 34 : S ? 22 : 34) * U;
    const th = tiles[1].h;
    const TRIO = P ? [[CX, CY - th - gT], [CX, CY], [CX, CY + th + gT]]
      : S ? [[CX - tiles[0].w / 2 - gT / 2, CY - th / 2 - gT / 2], [CX + tiles[1].w / 2 + gT / 2, CY - th / 2 - gT / 2], [CX, CY + th / 2 + gT / 2]]
      : [[CX - tiles[1].w / 2 - gT - tiles[0].w / 2, CY], [CX, CY], [CX + tiles[1].w / 2 + gT + tiles[2].w / 2, CY]];
    const heroS = P ? 1.4 : S ? 1.6 : 1.45;
    const OUT = P ? [[CX, CY - H * 0.55], null, [CX, CY + H * 0.55]] : S ? [[CX - W * 0.75, TRIO[0][1]], null, [CX, CY + H * 0.62]] : [[CX - W * 0.6, CY], null, [CX + W * 0.6, CY]];
    // kinetic "UPDATED / IN SECONDS" (VO 100.16 / 100.84)
    const kMax = W * (L ? 0.62 : P ? 0.86 : 0.82), kS = Math.min(fitDom(Lr, 'IN SECONDS', 'px', {}, kMax, (P ? 190 : S ? 120 : 150) * U), fitDom(Lr, 'UPDATED', 'px', {}, kMax, (P ? 190 : S ? 120 : 150) * U));
    const UPD = textA(Lr, 'UPDATED', kS, 'px', { color: '#eef1f6', filter: 'drop-shadow(0 10px 26px rgba(0,0,0,.85))' }, 9);
    const INS = textA(Lr, 'IN SECONDS', kS, 'px gold', { filter: 'drop-shadow(0 10px 26px rgba(0,0,0,.85))' }, 9);
    const heroH = tiles[1].h * heroS, gK = (P ? 44 : 30) * U;
    const UPD_Y = CY - heroH / 2 - gK - UPD.h / 2, INS_Y = CY + heroH / 2 + gK + INS.h / 2;
    const mbs = [motionBlur(), motionBlur()];
    // lightning + streaks (canvas), implosion core
    const lcv = el('canvas', 'fill', Lr, { zIndex: 10 }); lcv.width = W; lcv.height = H; const lc = lcv.getContext('2d');
    const core = anchor(Lr, 11);
    el('div', 'abs', core, { left: -400 * U + 'px', top: -400 * U + 'px', width: 800 * U + 'px', height: 800 * U + 'px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,252,240,1) 0%, rgba(255,232,170,.9) 14%, rgba(238,188,78,.45) 32%, rgba(238,188,78,.12) 50%, rgba(238,188,78,0) 70%)' });

    // bursts on the land
    FX.burst({ t: 96.0, x: CX, y: numY, n: 220, speed: 2300, angle: 0, spread: TAU, gravity: 1100, life: 1.15, size: 4, color: [255, 214, 140], streak: 0.03 });
    FX.burst({ t: 96.0, x: CX, y: numY, n: 80, speed: 1200, angle: 0, spread: TAU, gravity: 500, life: 0.6, size: 2.5, color: [255, 255, 255] });
    FX.burst({ t: 96.0, x: CX, y: numY, n: 26, speed: 1500, angle: -Math.PI / 2, spread: 2.4, gravity: 2600, life: 1.4, size: 8, color: [245, 200, 90], streak: 0.004 });   // pixel "coins"
        // the zap: lightning strikes the real "⚡ seconds" tile
    const tileTop1 = [TRIO[1][0], TRIO[1][1] - tiles[1].h / 2];
    FX.burst({ t: 98.0, x: tileTop1[0], y: tileTop1[1], n: 90, speed: 1500, angle: -Math.PI / 2, spread: 2.8, gravity: 1800, life: 0.8, size: 3, color: [200, 225, 255], streak: 0.03 });
    FX.flash(98.0, 0.22, 0.05);
    FX.burst({ t: 98.5, x: TRIO[2][0], y: TRIO[2][1], n: 40, speed: 900, angle: 0, spread: TAU, gravity: 600, life: 0.6, size: 2.5, color: [255, 220, 150] });

    // tile state over time (screen px): {x, y, s, o}
    function tileState(i, t) {
      const [tx, ty] = TRIO[i];
      let st = { x: tx, y: ty, s: 1, o: 0 };
      if (i === 0) st.o = seg(t, 97.82, 97.98);
      if (i === 1) { const a = spring(t - 98.0, 3.1, 0.42); st.s = t >= 98 ? 1.35 - 0.35 * a : 0; st.o = t >= 98 ? 1 : 0; }
      if (i === 2) { const a = spring(t - 98.5, 3, 0.5); st.y += (1 - a) * 70 * U; st.s = 0.8 + 0.2 * a; st.o = t >= 98.5 ? clamp(a * 2) : 0; }
      // idle float
      st.y += Math.sin((t - 98) * 2.2 + i * 1.7) * 4 * U * seg(t, 98.6, 99.2);
      // hero: the "⚡ seconds" tile takes the stage, the others leave
      const hp = seg(t, 100.0, 100.32, E.ioC);
      if (i === 1) { st.s *= lerp(1, heroS, hp); st.x = lerp(st.x, CX, hp); st.y = lerp(st.y, CY, hp); }
      else { const op = seg(t, 100.0, 100.36, E.inC); st.x = lerp(st.x, OUT[i][0], op); st.y = lerp(st.y, OUT[i][1], op); st.o *= 1 - op; }
      return st;
    }
    // the whole hero cluster gathers and implodes on the reverse cymbal
    const clusterS = t => (1 + 0.1 * seg(t, 101.6, 103.0, E.ioQ)) * (1 - 0.35 * E.inQ(seg(t, 103.0, 104.0)) - 0.65 * E.inE(seg(t, 103.0, 104.0)));
    const jit = (t, k) => noise1(t * 28, k) * (2 + 7 * seg(t, 101.6, 103.6)) * U * seg(t, 101.5, 101.8);

    return (t) => {
      // ----- backdrop -----
      const land = t >= 96.0;
      warm.style.opacity = (seg(t, 92.0, 92.6) * 0.5 + 0.5 * seg(t, 95.0, 96.0) + (land ? 0.3 * Math.exp(-(t - 96) / 0.5) : 0) - 0.4 * seg(t, 103.0, 104.0)).toFixed(3);
      const rp = seg(t, 100.3, 103.4);
      rays.style.opacity = (rp * 0.9 * (1 - seg(t, 103.9, 104.2))).toFixed(3);
      tf(rays, { r: (t - 100) * 14 + 90 * E.inC(seg(t, 102.5, 104)), s: 1 - 0.2 * seg(t, 103, 104, E.inC) });
      // flood (92-96): accelerating with the ticks, blown away by the hit
      const fdt = Math.max(0, t - 91.7);
      const blast = seg(t, 96.0, 96.18, E.outQ);
      flood.style.opacity = (seg(t, 91.8, 92.3) * 0.32 * (1 - blast)).toFixed(3);
      floodBed.style.opacity = (seg(t, 91.8, 92.3) * (1 - blast)).toFixed(3);
      if (t < 96.2) rows.forEach((R) => {
        let x = -R.ph * R.w + R.dir * R.v * (fdt + 3 * Math.pow(Math.min(fdt, 4.3), 3) / 48);
        x = ((x % R.w) + R.w) % R.w - R.w;
        R.row.style.transform = `translate(${x.toFixed(1)}px,0)`;
      });
      tf(flood, { s: 1 + 0.25 * blast });
      pops.forEach(pp => { const d = t - pp.t; const a = spring(d, 3.4, 0.55); tf(pp.T.a, { x: pp.x, y: pp.y - d * 30 * U, s: 0.7 + 0.3 * a, o: d >= 0 && t < 96.0 ? clamp(a * 2) * (1 - seg(d, 0.25, 0.55)) : 0 }); });

      // ----- odometer -----
      const v = valueAt(t);
      for (const c of cols) {
        const p = colPos(t, c.k), h = 0.004;
        const q = ((p % 10) + 10) % 10;
        c.strip.style.transform = `translate3d(0,${(-q * cellH).toFixed(2)}px,0)`;
        const vel = Math.abs(colPos(t + h, c.k) - colPos(t - h, c.k)) / (2 * h);
        c.mb.set(0, Math.min(cellH * 0.11, vel * cellH / 30 * 0.25));
        const lit = c.k === 0 ? 1 : clamp(p);
        c.box.style.opacity = (0.11 + 0.89 * lit).toFixed(3);
        if (c.k === 3) comma.style.opacity = (0.11 + 0.89 * lit).toFixed(3);
      }
      // group motion: appear from depth, grow with the riser, inhale on the reverse, SLAM on the hit
      const app = spring(t - 91.82, 2.4, 0.6);
      let s = (0.62 + 0.2 * app) + 0.16 * seg(t, 92.0, 95.5, E.ioQ);
      s *= (1 - 0.07 * seg(t, 95.5, 96.0, E.inQ)) * (1 + 0.025 * heart(t));
      let bright = 1;
      if (land) { const d = t - 96; s = (1 + 0.16 * (1 - spring(d, 3.0, 0.42))) * (1 + 0.035 * seg(t, 96.3, 97.5, E.ioQ)); bright = 1 + 1.4 * Math.exp(-d / 0.1); }
      const rj = seg(t, 94.0, 96.0, E.inQ) * (land ? 0 : 1);
      let nx = CX + noise1(t * 30, 31) * 6 * U * rj, ny = numY + noise1(t * 30, 32) * 6 * U * rj;
      let no = t < 91.82 ? 0 : clamp(app * 2);
      // dock into the real tile (97.55 -> 98.0)
      const T0 = tiles[0], dock = seg(t, 97.55, 98.0, E.ioC);
      const tScale = (0.23 * T0.h) / (0.62 * numSize);
      if (dock > 0) {
        nx = lerp(nx, TRIO[0][0], dock); ny = lerp(ny, TRIO[0][1] - 0.115 * T0.h, dock);
        s = lerp(s, tScale, dock); no *= 1 - seg(t, 97.8, 97.97);
      }
      tf(num, { x: nx, y: ny, s, o: no });
      numBox.style.filter = bright > 1.01 ? `brightness(${bright.toFixed(3)}) ${glowF}` : glowF;
      const shp = seg(t, 96.45, 97.1, E.ioQ);
      numSheen.style.opacity = shp > 0 && shp < 1 ? 0.9 : 0; numSheen.style.backgroundPosition = `${(100 - 100 * shp).toFixed(1)}% 0`;
      // hairline: progress of the count, then the underline of the label
      const prog = land ? 1 : v / FINAL_N;
      const lblScale = lerp(1, (0.135 * T0.h) / (0.72 * lblSize), dock);
      tf(hair, { x: lerp(CX, TRIO[0][0], dock), y: lerp(hairY, TRIO[0][1] + 0.08 * T0.h, dock), sx: prog, s: lerp(1, tScale, dock), o: (t < 91.85 ? 0 : 0.9) * (1 - seg(t, 97.7, 97.9)) });
      const lp = seg(t, 96.22, 96.6, E.outC);
      label.e.style.clipPath = `inset(0 ${(50 - 50 * lp).toFixed(1)}% 0 ${(50 - 50 * lp).toFixed(1)}%)`;
      tf(label.a, { x: lerp(CX, TRIO[0][0], dock), y: lerp(lblY, TRIO[0][1] + 0.235 * T0.h, dock), s: lblScale, o: (lp > 0 ? 1 : 0) * (1 - seg(t, 97.8, 97.97)) });
      rings.forEach((r, i) => { const d = t - 96 - i * 0.07; const p = seg(d, 0, 0.6, E.outC); tf(r, { x: CX, y: numY, s: 0.15 + 2.2 * p, o: d >= 0 ? (1 - p) * 0.95 : 0 }); });

      // ----- tiles -----
      const cl = clusterS(t);
      const rects = [];
      tiles.forEach((T, i) => {
        const st = tileState(i, t);
        let x = st.x, y = st.y, sc = st.s;
        if (i === 1) { x = CX + (x - CX) * cl + jit(t, 41); y = CY + (y - CY) * cl + jit(t, 42); sc *= cl; }
        let bright = 1, filt = '';
        if (i === 1 && t >= 98) { const d = t - 98; bright = 1 + 1.6 * Math.exp(-d / 0.14) + 0.5 * Math.exp(-Math.max(0, t - 100.16) / 0.12) * (t >= 100.16 ? 1 : 0) + 0.5 * (t >= 100.84 ? Math.exp(-(t - 100.84) / 0.12) : 0); filt = `drop-shadow(0 0 ${(30 * U).toFixed(1)}px rgba(106,165,224,${(0.25 + 0.55 * Math.exp(-d / 0.3)).toFixed(3)}))`; }
        tf(T.a, { x, y, s: sc, o: st.o * (t > 103.92 ? 1 - seg(t, 103.92, 104.0) : 1), bright, filter: filt });
        rects.push([x, y, T.w * sc, T.h * sc, st.o]);
      });
      sheens.forEach((sh, i) => sweep(sh, t, 99.0 + i * 0.12, 0.55));

      // ----- kinetic UPDATED / IN SECONDS -----
      [[UPD, 100.16, UPD_Y, 0], [INS, 100.84, INS_Y, 1]].forEach(([T, t0, y0, j]) => {
        const d = t - t0, p = seg(d, 0, 0.2, E.outE);
        const sh = d >= 0 && d < 0.3 ? 1 : 0;
        const x = CX + noise1(t * 40, 50 + j) * 10 * U * sh * (1 - d / 0.3) + jit(t, 43 + j), y = CY + (y0 - CY) * cl + jit(t, 45 + j);
        const coll = seg(t, 103.0, 104.0);
        tf(T.a, { x, y, s: lerp(1.55, 1, p) * cl, o: d >= 0 ? clamp(d / 0.04) * (1 - seg(t, 103.85, 104.0)) : 0, blur: (1 - p) * 10 + coll * 6, bright: 1 + (d >= 0 ? 1.2 * Math.exp(-d / 0.1) : 0) });
      });

      // ----- lightning + streaks -----
      lc.clearRect(0, 0, W, H);
      lc.globalCompositeOperation = 'lighter';
      const fi = Math.floor(t * 30);
      const r1 = rects[1];
      const R1 = [r1[0], r1[1], r1[2], r1[3]];
      if (t >= 98.0 && t < 98.32) {   // the strike from the sky
        const vis = hash(fi, 61) > 0.25 || t < 98.06;
        const a = (1 - seg(t, 98.0, 98.32)) * (vis ? 1 : 0.15);
        const sx = r1[0] + (hash(Math.floor(t * 12), 62) - 0.5) * r1[2] * 0.3;
        const pts = boltPts(sx + (hash(1, 63) - 0.5) * W * 0.2, -20 * U, r1[0], r1[1] - r1[3] / 2, Math.floor(t * 20), 0.36, 6);
        strokeBolt(lc, pts, 4.5 * U, a);
        for (let b = 0; b < 3; b++) { const m = pts[8 + b * 14] || pts[8]; const bp = boltPts(m[0], m[1], m[0] + (hash(b, 64) - 0.5) * 300 * U, m[1] + (90 + 120 * hash(b, 65)) * U, fi * 3 + b, 0.45, 4); strokeBolt(lc, bp, 2 * U, a * 0.7); }
      }
      // arcs crawling on the "⚡ seconds" tile
      let arc = 0;
      if (t >= 98.0) arc = Math.max(arc, 1 - seg(t, 98.0, 98.8));
      if (t >= 100.16) arc = Math.max(arc, 0.9 * (1 - seg(t, 100.16, 100.6)));
      if (t >= 100.84) arc = Math.max(arc, 0.9 * (1 - seg(t, 100.84, 101.3)));
      if (t >= 100.3 && t < 103.0 && hash(fi, 71) > 0.55) arc = Math.max(arc, 0.4);
      if (t >= 103.0 && t < 104.0) arc = Math.max(arc, 0.4 + 0.6 * seg(t, 103, 104));
      if (arc > 0.02 && r1[4] > 0.05) {
        const n = 2 + Math.round(3 * arc);
        for (let b = 0; b < n; b++) {
          const u0 = hash(fi * 7 + b, 72), u1 = u0 + 0.04 + 0.08 * hash(fi * 7 + b, 73);
          const [ax, ay] = perim(R1, u0), [bx, by] = perim(R1, u1);
          strokeBolt(lc, boltPts(ax, ay, bx, by, fi * 11 + b, 0.5, 4), 2.2 * U, arc * (0.6 + 0.4 * hash(fi, b + 74)));
        }
      }
      // arcs from the tile to the words as they land
      [[UPD, 100.16, UPD_Y], [INS, 100.84, INS_Y]].forEach(([T, t0, y0], j) => {
        const d = t - t0; if (d < 0 || d > 0.34) return;
        const a = (1 - d / 0.34) * (hash(fi, 80 + j) > 0.2 ? 1 : 0.2);
        for (let b = 0; b < 2; b++) {
          const sx = r1[0] + (hash(b + j * 5, 81) - 0.5) * r1[2] * 0.8, sy = r1[1] + (j ? 1 : -1) * r1[3] / 2;
          const ex = CX + (hash(b + j * 5, 82) - 0.5) * T.w * 0.9 * cl, ey = CY + (y0 - CY) * cl + (j ? -1 : 1) * T.h * 0.4 * cl;
          strokeBolt(lc, boltPts(sx, sy, ex, ey, fi * 13 + b + j * 50, 0.42, 5), 2.6 * U, a);
        }
      });
      // streaks converging on the centre (rising energy), arcs into the core on the reverse
      const en = seg(t, 100.4, 104.0, E.inQ);
      if (en > 0.01) {
        const dtb = Math.max(0, t - 100.4);
        const phase = 0.25 * dtb + 2.6 * Math.pow(dtb, 3) / (3 * 3.6 * 3.6);
        const Rm = Math.hypot(W, H) * 0.6;
        for (let i = 0; i < 110; i++) {
          const ang = hash(i, 91) * TAU, u = ((phase * (0.7 + 0.6 * hash(i, 92)) + hash(i, 93)) % 1);
          const r = Rm * Math.pow(1 - u, 1.4) + 30 * U, len = (40 + 260 * en) * U * (0.5 + hash(i, 94));
          const a = Math.sin(u * Math.PI) * en * (0.35 + 0.65 * hash(i, 95));
          const c = hash(i, 96) > 0.5 ? '255,226,160' : '255,250,235';
          lc.strokeStyle = `rgba(${c},${(a * 0.8).toFixed(3)})`; lc.lineWidth = (1.2 + 2.2 * hash(i, 97)) * U;
          lc.beginPath(); lc.moveTo(CX + Math.cos(ang) * r, CY + Math.sin(ang) * r); lc.lineTo(CX + Math.cos(ang) * (r + len), CY + Math.sin(ang) * (r + len)); lc.stroke();
        }
      }
      if (t >= 103.2 && t < 104.0) {
        const a = seg(t, 103.2, 103.9);
        for (let b = 0; b < 4; b++) {
          if (hash(fi * 5 + b, 98) < 0.4) continue;
          const ang = hash(fi * 5 + b, 99) * TAU, R = Math.hypot(W, H) * 0.55;
          strokeBolt(lc, boltPts(CX + Math.cos(ang) * R, CY + Math.sin(ang) * R, CX, CY, fi * 17 + b, 0.3, 5), 2.4 * U, a * 0.8);
        }
      }
      lc.globalCompositeOperation = 'source-over';
      // implosion core: grows on the reverse cymbal, becomes the light the anvil is struck in
      const cp = seg(t, 102.9, 104.0, E.inC), cf = seg(t, 104.0, 104.2, E.outQ);
      tf(core, { x: CX, y: CY, s: 0.02 + 1.5 * cp + 0.8 * cf + 0.04 * Math.sin(t * 40) * cp, o: t < 102.9 ? 0 : Math.min(1, cp * 1.4) * (1 - cf) });
    };
  }, { z: 24 });

  // =====================================================================================
  // 5-7. LOGO LOCKUP 104–108, CTA 108–116, FINAL 116–120
  // =====================================================================================
  scene('end_finale', 103.75, 121, (Lr) => {
    const world = el('div', 'fill', Lr, { transformOrigin: '50% 46%' });
    // background energy: slow rays + warm floor
    const D = 2 * Math.hypot(W, H);
    const rays = el('div', 'abs', world, { left: CX - D / 2 + 'px', top: CY - D / 2 + 'px', width: D + 'px', height: D + 'px', opacity: 0,
      background: 'repeating-conic-gradient(from 0deg, rgba(255,214,140,0) 0deg, rgba(255,214,140,.09) 4deg, rgba(255,214,140,0) 8deg, rgba(255,214,140,0) 18deg)',
      WebkitMaskImage: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 3%, #000 10%, rgba(0,0,0,.5) 22%, rgba(0,0,0,0) 36%)', maskImage: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 3%, #000 10%, rgba(0,0,0,.5) 22%, rgba(0,0,0,0) 36%)' });
    const glow = anchor(world, 1);
    el('div', 'abs', glow, { left: -700 * U + 'px', top: -700 * U + 'px', width: 1400 * U + 'px', height: 1400 * U + 'px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(238,188,78,.32) 0%, rgba(238,188,78,.11) 35%, rgba(238,188,78,0) 70%)' });
    const ring = anchor(world, 2);
    el('div', 'abs', ring, { left: -400 * U + 'px', top: -400 * U + 'px', width: 800 * U + 'px', height: 800 * U + 'px', borderRadius: '50%', border: `${10 * U}px solid rgba(255,236,190,.9)`, boxShadow: '0 0 60px rgba(238,188,78,.8)' });

    // ---- the real anvil (site code) ----
    const k = P ? 12 : 8;
    const anv = anchor(world, 6);
    const A = Anvil(anv, k).place(0, 0);
    A.cv.style.filter = 'drop-shadow(0 0 18px rgba(255,240,210,.35))';
    const AH = 36 * k;
    // ---- real crops ----
    const tp = piece('title'), sp = piece('sub');
    const title = pieceA(world, 'title', 0, (W * (P ? 0.84 : S ? 0.62 : 0.36)) / (tp ? tp.rect[2] : 320), 6);
    const titleSheen = sheen(title, 'rgba(255,248,225,.9)');
    const sub = pieceA(world, 'sub', 0, (W * (P ? 0.84 : S ? 0.8 : 0.45)) / (sp ? sp.rect[2] : 400), 6);
    const kB = P ? 2.6 : S ? 2.3 : 3.0;
    const go = pieceA(world, 'go', 0, kB, 7), all = pieceA(world, 'all', 0, kB, 7);
    const goSheen = sheen(go, 'rgba(255,255,255,.85)');
    const chips = [0, 1].map(i => pieceA(world, 'chip', i, kB, 7));
    const foot = pieceA(world, 'foot', 0, (W * (P ? 0.84 : S ? 0.74 : 0.42)) / (piece('foot') ? piece('foot').rect[2] : 400), 6);
    // ---- stamped lines ----
    const stMax = W * (L ? 0.66 : P ? 0.86 : 0.84), stS = Math.min(fitDom(world, 'START CRAFTING.', 'px', {}, stMax, (P ? 150 : 130) * U), fitDom(world, 'STOP GUESSING.', 'px', {}, stMax, (P ? 150 : 130) * U));
    const S1 = textA(world, 'STOP GUESSING.', stS, 'px', { color: '#eef1f6', filter: 'drop-shadow(0 10px 26px rgba(0,0,0,.85))' }, 8);
    const S2 = textA(world, 'START CRAFTING.', stS, 'px gold', { filter: 'drop-shadow(0 10px 26px rgba(0,0,0,.85)) drop-shadow(0 0 24px rgba(238,188,78,.35))' }, 8);
    const s2Sheen = (() => { const s = el('div', 'abs px', S2.e, { left: 0, top: 0, width: '100%', height: '100%', fontSize: 'inherit', lineHeight: 1, background: 'linear-gradient(100deg, rgba(255,255,255,0) 40%, rgba(255,255,255,.95) 50%, rgba(255,255,255,0) 60%)', backgroundSize: '300% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', opacity: 0 }); s.textContent = 'START CRAFTING.'; return s; })();
    // ---- kinetic line + URL ----
    const flHTML = '<span>FREE</span><span class="dot">·</span><span>IN YOUR BROWSER</span><span class="dot">·</span><span>9 LANGUAGES</span>';
    const flStyle = { fontWeight: 700, letterSpacing: '.16em', color: '#dde2ec' };
    const flS = fitDom(world, flHTML.replace(/class="dot"/g, 'style="margin:0 .55em"'), 'inter', flStyle, W * (L ? 0.46 : P ? 0.88 : 0.84), (P ? 42 : L ? 42 : 36) * U);
    const FL = textA(world, flHTML, flS, 'inter', flStyle, 8);
    const flParts = [...FL.e.children];
    flParts.forEach((c, i) => { c.style.display = 'inline-block'; if (c.className === 'dot') { c.style.margin = '0 .55em'; c.style.color = '#eebc4e'; } });
    flParts[0].className = 'gold';
    flParts[4].style.color = '#aab2c3';
    // re-measure with the margins and re-centre
    FL.w = FL.e.offsetWidth; FL.e.style.left = -FL.w / 2 + 'px';
    const urlS = fitDom(world, URL_TXT, 'inter', { fontWeight: 600, letterSpacing: '.01em' }, W * (L ? 0.46 : P ? 0.84 : 0.8), (P ? 46 : L ? 46 : 42) * U);
    const urlA = anchor(world, 8);
    const urlBox = el('div', 'abs inter', urlA, { fontSize: urlS + 'px', fontWeight: 600, letterSpacing: '.01em', whiteSpace: 'nowrap', lineHeight: 1.25, color: '#dde2ec' });
    urlBox.textContent = URL_TXT; const urlW = urlBox.offsetWidth, urlH = urlBox.offsetHeight; urlBox.textContent = '';
    urlBox.style.left = -urlW / 2 + 'px'; urlBox.style.top = -urlH / 2 + 'px'; urlBox.style.width = urlW + 'px';
    const uHost = el('span', '', urlBox), uPath = el('span', '', urlBox, { color: '#f5d47e' });
    const caret = el('span', '', urlBox, { display: 'inline-block', width: Math.max(2, 0.09 * urlS) + 'px', height: urlS * 1.05 + 'px', background: '#f5d47e', marginLeft: 0.06 * urlS + 'px', verticalAlign: '-0.16em', boxShadow: '0 0 10px rgba(238,188,78,.8)' });
    const uLine = el('div', 'abs', urlA, { left: -urlW / 2 + 'px', top: urlH / 2 + 6 * U + 'px', width: urlW + 'px', height: 2 * U + 'px', transformOrigin: '0 50%', background: 'linear-gradient(90deg, #eebc4e, rgba(238,188,78,.15))' });
    // exact width of the typed text after each key
    const prU = el('div', 'abs inter', world, { fontSize: urlS + 'px', fontWeight: 600, letterSpacing: '.01em', whiteSpace: 'nowrap', visibility: 'hidden' });
    const KEYS = evs('key', 'URL').map(e => e.t);
    let acc = ''; const keyW = URL_CHUNKS.map(c => { acc += c; prU.textContent = acc; return prU.offsetWidth; }); prU.remove();
    const typedN = t => { let n = 0; for (let i = 0; i < KEYS.length; i++) if (t >= KEYS[i]) n = i + 1; return n; };
    // ---- cursor ----
    const cur = Cursor(world, 58 * U);

    // ---------------- layouts per phase ----------------
    const hOf = { anv: AH, title: title.h, sub: sub.h, s1: S1.h, s2: S2.h, btn: Math.max(go.h, all.h), chips: chips[0].h, fl: FL.h, url: urlH };
    function col(list, cy, cx = CX) {
      const ys = stack(list.map(([n, s, g]) => ({ h: hOf[n] * s, gap: (g || 0) * U })), cy);
      const out = {}; list.forEach(([n, s], i) => { out[n] = { x: cx, y: ys[i], s, o: 1 }; }); return out;
    }
    const LOCK = P ? col([['anv', 1], ['title', 1, 84], ['sub', 1, 30]], H * 0.475)
      : col([['anv', 1], ['title', 1, 58], ['sub', 1, 24]], H * 0.52);
    const STAMP = P ? col([['anv', 0.78], ['title', 0.9, 62], ['sub', 0.9, 26], ['s1', 1, 130], ['s2', 1, 34]], H * 0.5)
      : S ? col([['anv', 0.56], ['title', 0.74, 36], ['sub', 0.74, 14], ['s1', 1, 66], ['s2', 1, 22]], H * 0.5)
      : col([['anv', 0.56], ['title', 0.72, 34], ['sub', 0.72, 14], ['s1', 1, 62], ['s2', 1, 20]], H * 0.5);
    const CTA = P ? col([['anv', 0.5], ['title', 0.72, 46], ['btn', 1, 118], ['chips', 1, 36], ['fl', 1, 84], ['url', 1, 58]], H * 0.5)
      : S ? col([['anv', 0.4], ['title', 0.6, 26], ['btn', 1, 60], ['chips', 1, 24], ['fl', 1, 48], ['url', 1, 34]], H * 0.5)
      : Object.assign(col([['anv', 0.9], ['title', 1, 44], ['sub', 0.75, 22]], H * 0.5, W * 0.26), col([['btn', 1], ['chips', 1, 34], ['fl', 1, 70], ['url', 1, 50]], H * 0.5, W * 0.69));
    const FINAL = P ? col([['anv', 0.85], ['title', 0.95, 72], ['url', 1.0, 74]], H * 0.45)
      : S ? col([['anv', 0.82], ['title', 0.92, 46], ['url', 1.05, 50]], H * 0.45)
      : col([['anv', 1.0], ['title', 1.08, 48], ['url', 1.15, 52]], H * 0.47);
    const hide = st => Object.assign({}, st, { o: 0 });
    // sub is not part of the CTA in the stacked formats, nor of the final lockup
    if (!CTA.sub) CTA.sub = hide(Object.assign({}, STAMP.sub, { y: CTA.title.y + 30 * U, s: CTA.title.s }));
    FINAL.sub = hide(Object.assign({}, FINAL.title, { y: FINAL.title.y + 40 * U }));
    // pre-hit pose for the final snap (gathered in, a touch smaller)
    const PRE = {}; for (const n of ['anv', 'title', 'url', 'sub']) PRE[n] = Object.assign({}, FINAL[n], { s: FINAL[n].s * 0.9, y: lerp(FINAL[n].y, H * 0.46, 0.1) });
    PRE.sub.o = 0;
    function lay(n, t) {
      const keys = [[105.5, LOCK[n]], [105.95, STAMP[n], E.ioC], [107.88, STAMP[n]], [108.36, CTA[n], E.outC], [115.0, CTA[n]], [115.96, PRE[n], E.ioQ]];
      if (n === 'url') { keys.splice(0, 4, [108.36, CTA.url]); }
      if (t < 116.0) return KO(t, keys);
      return mixO(PRE[n], FINAL[n], spring(t - 116.0, 2.6, 0.42));
    }
    const rowX = (cx, s, ws, gap) => { const tot = ws.reduce((a, w) => a + w, 0) * s + gap * s * (ws.length - 1); let x = cx - tot / 2; return ws.map(w => { const c = x + w * s / 2; x += w * s + gap * s; return c; }); };
    // positions used by bursts
    const strikePt = (st) => [st.x + (AJLogo.HIT_X + 0.5 - 22) * k * st.s, st.y + (AJLogo.ANVIL_TOP - 40) * k * st.s];
    const sp104 = strikePt(LOCK.anv), sp116 = strikePt(FINAL.anv);
    FX.burst({ t: 104.0, x: sp104[0], y: sp104[1], n: 190, speed: 2000, angle: -Math.PI / 2, spread: 2.7, gravity: 2600, life: 1.25, size: 4, color: [255, 214, 140], streak: 0.03 });
    FX.burst({ t: 104.0, x: sp104[0], y: sp104[1], n: 70, speed: 950, angle: -Math.PI / 2, spread: TAU, gravity: 900, life: 0.7, size: 3, color: [255, 255, 255] });
    FX.burst({ t: 116.0, x: sp116[0], y: sp116[1], n: 220, speed: 2100, angle: -Math.PI / 2, spread: 2.8, gravity: 2600, life: 1.4, size: 4, color: [255, 214, 140], streak: 0.03 });
    FX.burst({ t: 116.0, x: sp116[0], y: sp116[1], n: 80, speed: 1000, angle: -Math.PI / 2, spread: TAU, gravity: 900, life: 0.8, size: 3, color: [255, 255, 255] });
        FX.burst({ t: 106.0, x: STAMP.s1.x, y: STAMP.s1.y, n: 60, speed: 700, angle: 0, spread: TAU, gravity: 300, life: 0.6, size: 2.5, color: [215, 222, 236] });
    FX.burst({ t: 107.0, x: STAMP.s2.x, y: STAMP.s2.y, n: 90, speed: 1100, angle: 0, spread: TAU, gravity: 500, life: 0.75, size: 3, color: [255, 214, 140] });
    const goC = (() => { const xs = rowX(CTA.btn.x, CTA.btn.s, [go.w, all.w], 26 * U); return [xs[0], CTA.btn.y]; })();
    FX.burst({ t: 112.0, x: goC[0], y: goC[1], n: 90, speed: 1100, angle: 0, spread: TAU, gravity: 400, life: 0.8, size: 3, color: [255, 226, 160] });
    FX.burst({ t: 112.0, x: goC[0], y: goC[1], n: 30, speed: 600, angle: 0, spread: TAU, gravity: 0, life: 0.6, size: 2, color: [255, 255, 255] });
    FX.flash(112.0, 0.12, 0.06);
    // 4-point sparkles around the clicked button
    const stars = [0, 1, 2, 3, 4].map(i => el('div', 'abs', world, { width: 70 * U + 'px', height: 70 * U + 'px', zIndex: 9, opacity: 0 },
      `<svg viewBox="-10 -10 20 20" width="${70 * U}" height="${70 * U}"><path d="M0,-10 L1.4,-1.4 L10,0 L1.4,1.4 L0,10 L-1.4,1.4 L-10,0 L-1.4,-1.4 Z" fill="#fff6dc"/></svg>`));

    return (t) => {
      // background energy
      rays.style.opacity = (0.75 * seg(t, 104.0, 104.6) * (1 - 0.45 * seg(t, 108, 109)) + 0.25 * (t >= 116 ? Math.exp(-(t - 116) / 0.8) : 0)).toFixed(3);
      tf(rays, { r: (t - 104) * 6 });
      tf(world, { s: 1 + 0.022 * seg(t, 116.3, 120, E.ioQ) });

      // ---- anvil ----
      const a = lay('anv', t);
      const ain = seg(t, 103.82, 103.9);
      const pop = t >= 104 ? 1 + 0.06 * (1 - spring(t - 104, 3, 0.45)) : 1.06;
      tf(anv, { x: a.x, y: a.y, s: a.s * pop, o: ain });
      A.draw(t, [104.0, 116.0]);
      const gstrike = Math.max(t >= 104 ? Math.exp(-(t - 104) / 0.5) : 0, t >= 116 ? Math.exp(-(t - 116) / 0.6) : 0);
      tf(glow, { x: a.x, y: a.y - AH * 0.1 * a.s, s: (0.55 + 0.35 * a.s) * (1 + 0.15 * gstrike), o: (0.55 + 0.45 * gstrike) * ain });
      const rr = t >= 116 ? 116 : 104, rp = seg(t, rr, rr + 0.6, E.outC);
      const spn = strikePt(a);
      tf(ring, { x: spn[0], y: spn[1], s: 0.12 + 1.6 * rp, o: t >= 104 ? (1 - rp) : 0 });

      // ---- wordmark + subtitle ----
      const ti = lay('title', t), ta = spring(t - 104.12, 2.6, 0.55);
      tf(title.a, { x: ti.x, y: ti.y, s: ti.s * (1.28 - 0.28 * ta), o: t >= 104.12 ? clamp(ta * 3) : 0, blur: (1 - clamp(ta)) * 8 });
      sweep(titleSheen, t, 104.5, 0.7); if (t > 105.5) sweep(titleSheen, t, 108.6, 0.8); if (t > 110) sweep(titleSheen, t, 116.45, 0.9);
      const su = lay('sub', t), sa = spring(t - 104.45, 3, 0.6);
      tf(sub.a, { x: su.x, y: su.y + (1 - sa) * 30 * U, s: su.s, o: (t >= 104.45 ? clamp(sa * 2) : 0) * su.o });

      // ---- stamps ----
      [[S1, 106.0, -1.5, -1], [S2, 107.0, 1.5, 1]].forEach(([T, t0, rot, dir]) => {
        const st = STAMP[T === S1 ? 's1' : 's2'], d = t - t0;
        if (d < 0) { T.a.style.opacity = 0; return; }
        const land = d < 0.09 ? lerp(1.8, 1, E.inQ(d / 0.09)) : 1 + 0.03 * Math.exp(-(d - 0.09) * 16) * Math.sin((d - 0.09) * 55);
        const out = seg(t, 107.88, 108.22, E.inQ);
        // follow the lockup drift during the stamp phase; whoosh out sideways on the CTA
        tf(T.a, { x: st.x + dir * out * W * 0.9, y: st.y, s: land, r: rot, o: clamp(d / 0.035) * (1 - out), blur: out * 18 });
      });
      const s2p = seg(t, 107.25, 107.85, E.ioQ); s2Sheen.style.opacity = s2p > 0 && s2p < 1 ? 1 : 0; s2Sheen.style.backgroundPosition = `${(100 - 100 * s2p).toFixed(1)}% 0`;

      // ---- CTA elements (108-116) ----
      const ctaOut = seg(t, 115.0, 115.85, E.inQ);
      const suck = (st) => ({ x: lerp(st.x, CX, ctaOut * 0.6), y: lerp(st.y, H * 0.46, ctaOut * 0.6), s: st.s * (1 - 0.5 * ctaOut), o: 1 - ctaOut });
      const bx = rowX(CTA.btn.x, CTA.btn.s, [go.w, all.w], 26 * U);
      [[go, 108.12, bx[0]], [all, 108.3, bx[1]]].forEach(([T, t0, x0], j) => {
        const d = t - t0, sa2 = spring(d, 2.8, 0.5);
        const st = suck({ x: x0, y: CTA.btn.y, s: CTA.btn.s, o: 1 });
        let s = st.s * (0.75 + 0.25 * sa2), bright = 1;
        if (j === 0) {   // the click
          const c = t - 112.0;
          if (c > -0.08 && c < 0.1) s *= 1 - 0.07 * (1 - Math.abs(c + 0.0) / 0.1);
          if (c >= 0.1) s *= 1 + 0.05 * Math.exp(-(c - 0.1) / 0.25) * Math.sin((c - 0.1) * 22);
          bright = 1 + (c >= 0 ? 0.45 * Math.exp(-c / 0.25) : 0) + 0.12 * seg(t, 111.75, 111.95) * (1 - seg(t, 112.6, 113.2));
        }
        tf(T.a, { x: st.x, y: st.y + (1 - sa2) * 80 * U, s, o: d >= 0 ? clamp(sa2 * 2) * st.o : 0, bright });
      });
      sweep(goSheen, t, 112.05, 0.55); if (t > 113) sweep(goSheen, t, 113.5, 0.6);
      const cx2 = rowX(CTA.chips.x, CTA.chips.s, [chips[0].w, chips[1].w], 18 * U);
      chips.forEach((T, j) => {
        const t0 = 108.5 + j * 0.16, d = t - t0, ca = spring(d, 3, 0.45);
        const st = suck({ x: cx2[j], y: CTA.chips.y, s: CTA.chips.s, o: 1 });
        tf(T.a, { x: st.x, y: st.y, s: st.s * (0.4 + 0.6 * ca), r: (j ? 5 : -5) * (1 - ca), o: d >= 0 ? clamp(ca * 2) * st.o : 0 });
      });
      // kinetic line, word-synced to the VO ("Free" 109.84, "in your browser" 110.5) + "9 languages" after it
      const fst = suck(CTA.fl);
      tf(FL.a, { x: fst.x, y: fst.y, s: fst.s, o: t >= 109.8 ? fst.o : 0 });
      const FLT = [109.84, 110.4, 110.5, 111.42, 111.5];
      flParts.forEach((c, i) => { const d = t - FLT[i], pa = spring(d, 3.2, 0.5); tf(c, { y: (1 - pa) * 0.8 * FL.h, s: i === 0 ? 1 + 0.35 * (1 - clamp(pa)) : 1, o: d >= 0 ? clamp(pa * 2) : 0 }); });
      // URL: types on the 12 key clicks, then flies into the final lockup
      const n = typedN(t), str = URL_CHUNKS.slice(0, n).join('');
      uHost.textContent = str.slice(0, URL_HOST); uPath.textContent = str.slice(URL_HOST);
      const u = lay('url', t);
      const typing = t >= 109.95 && t < 111.6;
      caret.style.opacity = t < 109.95 || t >= 115.0 ? 0 : (typing || Math.floor((t - 111.6) * 2.6) % 2 === 0 ? 1 : 0);
      tf(urlA, { x: u.x, y: u.y, s: u.s, o: t >= 109.9 ? 1 : 0 });
      const lw = n ? keyW[n - 1] / urlW : 0;
      tf(uLine, { sx: Math.max(0.001, lw), o: 0.85 * (1 - seg(t, 115.0, 115.6)) });
      // cursor: flies in, clicks the real "Open Crafting →" at 112.0, drifts away
      const goTip = [goC[0] + go.w * CTA.btn.s * 0.18, goC[1] + go.h * CTA.btn.s * 0.12];
      const [kx, ky] = cursorPath(t, [[111.15, W * 1.08, H * (P ? 0.9 : 0.96)], [111.9, goTip[0], goTip[1]], [112.25, goTip[0], goTip[1]], [113.4, goTip[0] + W * 0.12, goTip[1] + H * 0.05]]);
      cur.set(t, kx, ky, [112.0], t >= 111.15 ? 1 - seg(t, 113.0, 113.5) : 0);
      stars.forEach((st, i) => {
        const t0 = 112.0 + i * 0.07, p = seg(t, t0, t0 + 0.5);
        const ang = -0.6 + i * 1.35, rx = go.w * CTA.btn.s * 0.62, ry = go.h * CTA.btn.s * 0.9;
        st.style.left = (goC[0] + Math.cos(ang) * rx - 35 * U) + 'px'; st.style.top = (goC[1] + Math.sin(ang) * ry - 35 * U) + 'px';
        tf(st, { s: Math.sin(p * Math.PI) * (0.7 + 0.5 * hash(i, 5)), r: p * 90, o: p > 0 && p < 1 ? 1 : 0 });
      });

      // ---- final: real footer ----
      const fa = spring(t - 116.35, 2.6, 0.6);
      tf(foot.a, { x: CX, y: H * 0.94 - foot.h / 2 + (1 - fa) * 24 * U, s: 1, o: t >= 116.35 ? clamp(fa * 1.5) : 0 });
    };
  }, { z: 26 });

  // ---------- fade to black (above every scene and the particles) ----------
  scene('end_fade', 118.9, 121, (Lr) => {
    const b = el('div', 'fill', Lr, { background: '#000', opacity: 0 });
    return (t) => { b.style.opacity = K(t, [[119.0, 0], [119.85, 1, E.ioQ]]).toFixed(3); };
  }, { z: 40, overlay: true });
})();
