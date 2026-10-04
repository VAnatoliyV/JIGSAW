// ENDING (88–120 s): the night city breathes ("the market never sleeps") → an odometer counts the base
// on the accelerating ticks → "6 985" lands and holds while the VO reads it (lightning crackles across it on
// the 98.0 zap) → the number docks, registered, into the REAL stat tile, the real "⚡ seconds" tile is born in
// a lightning strike → "UPDATED IN SECONDS" → everything implodes into the anvil's strike point → the real
// anvil is struck on the final chorus with the real wordmark → "STOP GUESSING. / START CRAFTING." stamped on
// the voiced words → CTA with the real button / chips crops, the URL types on the key clicks, a cursor clicks
// "Open Crafting →" → final hit, final lockup with the real footer, fade to black.
(function () {
  const { W, H, U, E, K, seg, spring, clamp, lerp, hash, noise1, el, tf, show, scene, P, L, S, motionBlur, evs, TL, PROFILE } = FX;
  const { Anvil, Cursor, cursorPath, stateInfo } = FX.lib;
  const HOME = stateInfo('home') || { pieces: {} };
  const piece = (k, i = 0) => ((HOME.pieces || {})[k] || [])[i];
  const CX = W / 2, CY = H / 2, TAU = Math.PI * 2;
  const FINAL_N = 6985;
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

  // ---------------- shared lockup geometry (the implosion of end_metric collapses into the anvil's strike point) ----------------
  const ANV_K = P ? 12 : 8, AH = 36 * ANV_K;               // real anvil: 44x36 body, drawn at ANV_K screen px per logo px
  const TP = piece('title');
  const kTitle = (W * (P ? 0.84 : S ? 0.62 : 0.36)) / (TP ? TP.rect[2] : 320), TITLE_H = (TP ? TP.rect[3] : 66) * kTitle;
  const LOCK = (() => { const ys = stack([{ h: AH, gap: 0 }, { h: TITLE_H, gap: (P ? 84 : 58) * U }], H * (P ? 0.46 : 0.5));
    return { anv: { x: CX, y: ys[0], s: 1, o: 1 }, title: { x: CX, y: ys[1], s: 1, o: 1 } }; })();
  const strikePt = st => [st.x + (AJLogo.HIT_X + 0.5 - 22) * ANV_K * st.s, st.y + (AJLogo.ANVIL_TOP - 40) * ANV_K * st.s];
  const SP104 = strikePt(LOCK.anv);

  // ---------------- stamp timing: on the words as voiced ----------------
  // VO v18 "Stop guessing." starts at its line time, "Start crafting." ~1.03 s later (measured on the VO stem).
  // If the timeline's stamp hits sit on those words (VO moved to ~105.9, or the stamp SFX moved to the words),
  // the stamps take the exact hit times; otherwise they follow the voice and the stamp hits get accents.
  const V18 = ((TL.vo || []).find(v => v.id === 'v18') || { t: 104.6 }).t;
  const STE = evs('stamp').map(e => e.t).filter(x => x > 100 && x < 110);   // this stretch only (the hook has stamps too)
  const pickT = (ev, voice) => (ev != null && Math.abs(ev - voice) < 0.45 ? ev : voice);
  const TS1 = pickT(STE[0], V18 + 0.02), TS2 = pickT(STE[1], V18 + 1.03);
  const ACC = STE.filter(x => Math.abs(x - TS1) > 0.05 && Math.abs(x - TS2) > 0.05);
  const UL_T = ACC.length ? ACC[0] : TS2 + 0.3, SH_T = ACC.length > 1 ? ACC[1] : TS2 + 0.6;

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
    // 9:16: night sky above the plate (the type lives there)
    if (P) el('div', 'fill', Lr, { background: 'linear-gradient(180deg, #070b17 0%, #0a1122 26%, #070a14 40%, #04060b 100%)' });
    const IW = 2200, IH = 620;
    // 9:16 shows the wide plate as a band at ~1.9x (filling 1920 px of height would upscale it 3.5x+)
    const c0 = P ? H * 0.6 / IH : Math.max(W / IW, H / IH) * 1.06, bandCY = H * 0.655;
    const pmask = P ? 'linear-gradient(180deg, rgba(0,0,0,0) 0%, #000 17%, #000 70%, rgba(0,0,0,0) 100%)' : 'none';
    const mkImg = (filter, blend) => { const im = el('img', 'abs', Lr, { left: '0px', top: '0px', width: IW + 'px', height: IH + 'px', transformOrigin: '0 0', filter, mixBlendMode: blend || 'normal', WebkitMaskImage: pmask, maskImage: pmask }); im.src = '../assets/cities/caerleon-hero.webp'; return im; };
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
    const textBed = el('div', 'fill', Lr, { background: `radial-gradient(${P ? '62% 16%' : '46% 32%'} at 50% ${P ? 25 : 45}%, rgba(3,5,10,.62) 0%, rgba(3,5,10,0) 100%)` });
    const cold = el('div', 'fill', Lr, { background: 'rgba(190,212,255,1)', mixBlendMode: 'screen', opacity: 0 });
    // drifting moonlit motes
    const cv = el('canvas', 'fill', Lr); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');

    // ---- kinetic type ----
    const block = anchor(Lr, 10);
    const maxW = W * (L ? 0.66 : 0.78), maxS = (P ? 200 : S ? 160 : 180) * U;   // x1.08 of heartbeat + push stays inside 6%
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
    const BY = H * (P ? 0.25 : 0.45);

    return (t) => {
      const dt0 = t - 88;
      // city: hard cut on the impact, settle, slow push-in, suck-in on the reverse cymbal
      const z = 1 + 0.12 * seg(t, 88, 96, E.ioQ) + 0.08 * Math.exp(-dt0 / 0.2) + 0.45 * seg(t, 95.45, 96.0, E.inE);
      const cs = c0 * z;
      // 9:16: slow lateral pan along the band (bridge brazier -> stairs); else a gentle drift
      const tx = P ? clamp(CX - (0.5 + 0.06 * seg(t, 88, 96, E.ioQ)) * IW * cs, W - IW * cs, 0) : clamp(CX - 0.5 * IW * cs - dt0 * 5 * U, W - IW * cs, 0);
      const ty = P ? bandCY - 0.5 * IH * cs : clamp(CY - 0.5 * IH * cs, H - IH * cs, 0);
      const tr = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale(${cs.toFixed(5)})`;
      city.style.transform = tr; lights.style.transform = tr;
      const hb = heart(t);
      lights.style.opacity = (0.5 + 0.12 * noise1(t * 7, 11) + 0.25 * hb).toFixed(3);
      cold.style.opacity = (0.32 * Math.exp(-dt0 / 0.08)).toFixed(3);
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
        if (w.fx === 'drop') w.chars.forEach((c, j) => { const a = spring(dt - j * 0.035, 3.2, 0.5); tf(c, { y: -(1 - a) * 0.42 * sz, r: (1 - a) * (j % 2 ? 7 : -7), o: clamp(a * 1.6) }); });
        if (w.fx === 'slide') { const p = seg(dt, 0, 0.34, E.outE); tf(w.e, { x: -(1 - p) * W * 0.45, o: p, blur: (1 - p) * 16 }); }
        if (w.fx === 'slam') { const p = seg(dt, 0, 0.24, E.outE); tf(w.e, { s: lerp(1.4, 1, p), o: clamp(dt / 0.05), blur: (1 - p) * 12, bright: 1 + 0.25 * hb }); }
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
      return { T, t: tt, x: clamp(x, T.w / 2 + W * 0.06, W - T.w / 2 - W * 0.06), y };
    });

    // ---------- the odometer: Inter 800 tabular numerals, the site's "6 985" (space, no comma) ----------
    const NUM_ST = { fontWeight: 800, fontVariantNumeric: 'tabular-nums' };
    const pr = el('div', 'abs inter', Lr, Object.assign({ fontSize: '100px', lineHeight: 1, whiteSpace: 'pre', visibility: 'hidden' }, NUM_ST));
    pr.textContent = '0'; const w100 = pr.offsetWidth; pr.textContent = ' '; const s100 = pr.offsetWidth; pr.remove();
    const numSize = Math.min((P ? 300 : S ? 250 : 270) * U, W * (L ? 0.44 : P ? 0.74 : 0.64) * 100 / (4 * w100 + s100));
    const colW = w100 * numSize / 100, spW = s100 * numSize / 100, cellH = Math.round(numSize);
    const numW = colW * 4 + spW;
    // digit ink metrics (for the registered dock into the real tile)
    const mc = document.createElement('canvas').getContext('2d');
    mc.font = `800 ${numSize}px Inter`;
    const mD = ['0', '6', '9', '8'].map(c => mc.measureText(c));
    const dA = Math.max(...mD.map(m => m.actualBoundingBoxAscent)), dD = Math.max(...mD.map(m => m.actualBoundingBoxDescent));
    const inkH = dA + dD;
    const fA = mD[0].fontBoundingBoxAscent, fD = mD[0].fontBoundingBoxDescent;
    const inkDY = ((cellH - (fA + fD)) / 2 + fA) - (dA - dD) / 2 - cellH / 2;   // digit ink centre - cell centre
    const num = anchor(Lr, 8);
    const numBox = el('div', 'abs', num, { left: -numW / 2 + 'px', top: -cellH / 2 + 'px', width: numW + 'px', height: cellH + 'px' });
    const glowF = 'drop-shadow(0 0 34px rgba(238,188,78,.38)) drop-shadow(0 14px 30px rgba(0,0,0,.85))';
    numBox.style.filter = glowF;
    const drum = 'linear-gradient(180deg, rgba(0,0,0,0) 0%, #000 12%, #000 88%, rgba(0,0,0,0) 100%)';
    const cols = []; let xx = 0;
    for (const k of [3, -1, 2, 1, 0]) {
      if (k < 0) { xx += spW; continue; }
      const box = el('div', 'abs', numBox, { left: xx + 'px', top: '0px', width: colW + 'px', height: cellH + 'px', overflow: 'hidden', WebkitMaskImage: drum, maskImage: drum });
      const strip = el('div', 'abs', box, { left: '0px', top: '0px', width: colW + 'px' });
      for (let d = 0; d < 11; d++) { const c = el('div', 'inter gold', strip, Object.assign({ width: colW + 'px', height: cellH + 'px', fontSize: numSize + 'px', lineHeight: cellH + 'px', textAlign: 'center' }, NUM_ST)); c.textContent = String(d % 10); }
      const mb = motionBlur(); strip.style.filter = mb.url;
      cols.push({ k, box, strip, mb }); xx += colW;
    }
    // values on the 16 accelerating ticks, then 6 985 on the hit
    const STEPS = TICKS.map((tt, i) => ({ t: tt, v: Math.max(3 + i, Math.round(FINAL_N * Math.pow((i + 1) / (TICKS.length + 1), 1.75) + (hash(i, 231) - 0.5) * 70)) }));
    for (let i = 1; i < STEPS.length; i++) STEPS[i].v = Math.max(STEPS[i].v, STEPS[i - 1].v + 7);
    STEPS.push({ t: 96.0, v: FINAL_N, snap: true });
    function roll(t) {
      let i = -1; for (let j = 0; j < STEPS.length; j++) if (t >= STEPS[j].t) i = j;
      if (i < 0) return { from: 0, to: 0, x: 1 };
      const st = STEPS[i], from = i ? STEPS[i - 1].v : 0, next = i + 1 < STEPS.length ? STEPS[i + 1].t : st.t + 1;
      const d = st.snap ? 0 : Math.min(0.14, 0.82 * (next - st.t));
      return { from, to: st.v, d, x: d ? clamp((t - st.t) / d) : 1 };
    }
    // column k of the odometer: position (in digits) and speed (digits/s) within the current roll
    function colState(t, k) {
      const r = roll(t), n1 = Math.floor(r.to / 10 ** k), n0 = Math.max(Math.floor(r.from / 10 ** k), n1 - 9);
      const p = lerp(n0, n1, E.outB(r.x));
      let vel = 0;
      if (r.d > 0 && r.x < 1) { const a = Math.max(0, r.x - 0.03), b = Math.min(1, r.x + 0.03); vel = Math.abs((n1 - n0) * (E.outB(b) - E.outB(a)) / ((b - a) * r.d)); }
      return { p, vel };
    }
    const valueAt = t => { const r = roll(t); return lerp(r.from, r.to, E.outC(r.x)); };
    // label (the site's own wording) + gold hairline progress
    const lblSize = (P ? 40 : S ? 32 : 34) * U, LS = 0.34;
    const label = textA(Lr, 'ITEMS IN THE BASE', lblSize, 'inter', { fontWeight: 600, letterSpacing: LS + 'em', paddingLeft: LS + 'em', color: '#b7bfcf' }, 8);
    mc.font = `600 ${lblSize}px Inter`;
    const mI = mc.measureText('I'), lblCap = mI.actualBoundingBoxAscent;
    const lblDY = ((label.h - (mI.fontBoundingBoxAscent + mI.fontBoundingBoxDescent)) / 2 + mI.fontBoundingBoxAscent) - lblCap / 2 - label.h / 2;
    const lblInkW = label.w - 2 * LS * lblSize;
    const hair = anchor(Lr, 8);
    const hairBar = el('div', 'abs', hair, { left: -numW * 0.46 + 'px', top: -1.5 * U + 'px', width: numW * 0.92 + 'px', height: 3 * U + 'px', transformOrigin: '0 50%', background: 'linear-gradient(90deg, rgba(238,188,78,0), #f5d47e 15%, #eebc4e 85%, rgba(238,188,78,0))', boxShadow: '0 0 16px rgba(238,188,78,.7)' });
    const numY = H * (P ? 0.41 : 0.42);
    const hairY = numY + inkDY + inkH / 2 + 30 * U, lblY = hairY + 26 * U + label.h / 2;
    // 4-point glints on the landed number
    const GL = [[0.47, -0.36, 96.55], [-0.43, 0.3, 96.95], [0.12, -0.4, 97.3], [-0.2, -0.38, 98.55], [0.4, 0.28, 99.0]];
    const glints = GL.map(() => el('div', 'abs', num, { width: 110 * U + 'px', height: 110 * U + 'px', opacity: 0 },
      `<svg viewBox="-10 -10 20 20" width="${110 * U}" height="${110 * U}"><path d="M0,-10 L1.3,-1.3 L10,0 L1.3,1.3 L0,10 L-1.3,1.3 L-10,0 L-1.3,-1.3 Z" fill="#fff8e6"/></svg>`));
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
    // where "6 985" and "ITEMS IN THE BASE" sit inside the real tile crop (measured from the captures)
    const INK = PROFILE === 'mobile' ? { n: [0.497, 0.343, 0.2], l: [0.498, 0.714, 0.114, 0.607] } : { n: [0.497, 0.357, 0.2], l: [0.497, 0.714, 0.114, 0.73] };
    const T0 = tiles[0];
    const sDock = INK.n[2] * T0.h / inkH;
    const dockN = [TRIO[0][0] + (INK.n[0] - 0.5) * T0.w, TRIO[0][1] + (INK.n[1] - 0.5) * T0.h - inkDY * sDock];
    const dockLs = [INK.l[3] * T0.w / lblInkW, INK.l[2] * T0.h / lblCap];
    const dockL = [TRIO[0][0] + (INK.l[0] - 0.5) * T0.w, TRIO[0][1] + (INK.l[1] - 0.5) * T0.h - lblDY * dockLs[1]];
    // timing (VO v17: "...eighty-five items" until 99.78, "Updated" 100.16, "in seconds" 100.84)
    const DOCK0 = 99.28, DOCK1 = 99.6, XF = 99.6, T2IN = 99.68, STRIKE = 99.84, HERO0 = 99.98, HERO1 = 100.2;
    // kinetic "UPDATED / IN SECONDS"
    const kMax = W * (L ? 0.62 : 0.76), kS = Math.min(fitDom(Lr, 'IN SECONDS', 'px', {}, kMax, (P ? 190 : S ? 120 : 150) * U), fitDom(Lr, 'UPDATED', 'px', {}, kMax, (P ? 190 : S ? 120 : 150) * U));
    const UPD = textA(Lr, 'UPDATED', kS, 'px', { color: '#eef1f6', filter: 'drop-shadow(0 10px 26px rgba(0,0,0,.85))' }, 9);
    const INS = textA(Lr, 'IN SECONDS', kS, 'px gold', { filter: 'drop-shadow(0 10px 26px rgba(0,0,0,.85))' }, 9);
    const heroH = tiles[1].h * heroS, gK = (P ? 44 : 30) * U;
    const UPD_Y = CY - heroH / 2 - gK - UPD.h / 2, INS_Y = CY + heroH / 2 + gK + INS.h / 2;
    // lightning + streaks (canvas), implosion core at the anvil's strike point
    const lcv = el('canvas', 'fill', Lr, { zIndex: 10 }); lcv.width = W; lcv.height = H; const lc = lcv.getContext('2d');
    const core = anchor(Lr, 11);
    el('div', 'abs', core, { left: -400 * U + 'px', top: -400 * U + 'px', width: 800 * U + 'px', height: 800 * U + 'px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,252,240,1) 0%, rgba(255,232,170,.9) 14%, rgba(238,188,78,.45) 32%, rgba(238,188,78,.12) 50%, rgba(238,188,78,0) 70%)' });
    const CP = SP104;
    const ccen = t => { const p = E.inQ(seg(t, 103.0, 104.0)); return [lerp(CX, CP[0], p), lerp(CY, CP[1], p)]; };

    // bursts on the land
    FX.burst({ t: 96.0, x: CX, y: numY, n: 220, speed: 2300, angle: 0, spread: TAU, gravity: 1100, life: 1.15, size: 4, color: [255, 214, 140], streak: 0.03 });
    FX.burst({ t: 96.0, x: CX, y: numY, n: 80, speed: 1200, angle: 0, spread: TAU, gravity: 500, life: 0.6, size: 2.5, color: [255, 255, 255] });
    FX.burst({ t: 96.0, x: CX, y: numY, n: 26, speed: 1500, angle: -Math.PI / 2, spread: 2.4, gravity: 2600, life: 1.4, size: 8, color: [245, 200, 90], streak: 0.004 });   // pixel "coins"
    // the 98.0 zap crackles across the number itself
    const numTop = numY + inkDY - inkH * 0.55;
    FX.burst({ t: 98.0, x: CX, y: numTop, n: 90, speed: 1500, angle: -Math.PI / 2, spread: 2.8, gravity: 1800, life: 0.8, size: 3, color: [200, 225, 255], streak: 0.03 });
    FX.flash(98.0, 0.22, 0.05);
    // the "⚡ seconds" tile is born in a strike, just before "Updated"
    const tileTop1 = [TRIO[1][0], TRIO[1][1] - tiles[1].h / 2];
    FX.burst({ t: STRIKE, x: tileTop1[0], y: tileTop1[1], n: 70, speed: 1300, angle: -Math.PI / 2, spread: 2.8, gravity: 1800, life: 0.7, size: 3, color: [200, 225, 255], streak: 0.03 });
    FX.flash(STRIKE, 0.12, 0.04);
    FX.burst({ t: T2IN, x: TRIO[2][0], y: TRIO[2][1], n: 30, speed: 800, angle: 0, spread: TAU, gravity: 600, life: 0.5, size: 2.5, color: [255, 220, 150] });

    // tile state over time (screen px): {x, y, s, o}
    function tileState(i, t) {
      const [tx, ty] = TRIO[i];
      const st = { x: tx, y: ty, s: 1, o: 0 };
      if (i === 0) st.o = t >= XF + 0.03 ? 1 : 0;   // hard swap: the kinetic number is registered on the tile's own
      if (i === 1) { const a = spring(t - STRIKE, 3.1, 0.42); st.s = t >= STRIKE ? 1.35 - 0.35 * a : 0; st.o = t >= STRIKE ? 1 : 0; }
      if (i === 2) { const a = spring(t - T2IN, 3, 0.5); st.y += (1 - a) * 60 * U; st.s = 0.8 + 0.2 * a; st.o = t >= T2IN ? clamp(a * 2) : 0; }
      // hero: the "⚡ seconds" tile takes the stage, the others leave
      const hp = seg(t, HERO0, HERO1, E.ioC);
      if (i === 1) { st.s *= lerp(1, heroS, hp); st.x = lerp(st.x, CX, hp); st.y = lerp(st.y, CY, hp); }
      else { const op = seg(t, HERO0 - 0.04, HERO1 - 0.04, E.inC); st.x = lerp(st.x, OUT[i][0], op); st.y = lerp(st.y, OUT[i][1], op); st.o *= 1 - op; }
      return st;
    }
    // the whole hero cluster gathers, then implodes into the strike point on the reverse cymbal
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
        const { p, vel } = colState(t, c.k);
        const q = ((p % 10) + 10) % 10;
        c.strip.style.transform = `translate3d(0,${(-q * cellH).toFixed(2)}px,0)`;
        c.mb.set(0, Math.min(cellH * 0.045, vel * cellH / 30 * 0.12));
        const lit = c.k === 0 ? 1 : clamp(p);
        c.box.style.opacity = (0.11 + 0.89 * lit).toFixed(3);
      }
      // group motion: appear from depth, grow with the riser, inhale on the reverse, SLAM on the hit, hold under the VO
      const app = spring(t - 91.82, 2.4, 0.6);
      let s = (0.62 + 0.2 * app) + 0.16 * seg(t, 92.0, 95.5, E.ioQ);
      s *= (1 - 0.07 * seg(t, 95.5, 96.0, E.inQ)) * (1 + 0.025 * heart(t));
      let bright = 1;
      if (land) { const d = t - 96; s = (1 + 0.16 * (1 - spring(d, 3.0, 0.42))) * (1 + 0.05 * seg(t, 96.3, 99.2, E.ioQ)); bright = 1 + 1.4 * Math.exp(-d / 0.1); }
      // 98.0 zap: lightning crackles across the number (flash, blue rim, jolt)
      const zd = t - 98.0, zap = zd >= 0 ? Math.exp(-zd / 0.18) : 0;
      if (zd >= 0) bright += 0.9 * Math.exp(-zd / 0.06);
      const rj = seg(t, 94.0, 96.0, E.inQ) * (land ? 0 : 1) + (zd >= 0 && zd < 0.3 ? 1.6 * (1 - zd / 0.3) : 0);
      let nx = CX + noise1(t * 30, 31) * 6 * U * rj, ny = numY + noise1(t * 30, 32) * 6 * U * rj;
      let no = t < 91.82 ? 0 : clamp(app * 2);
      // dock, registered on the real tile's own "6 985", then a clean swap
      const dock = seg(t, DOCK0, DOCK1, E.ioC);
      if (dock > 0) { nx = lerp(nx, dockN[0], dock); ny = lerp(ny, dockN[1], dock); s = lerp(s, sDock, dock); if (t >= XF + 0.03) no = 0; }
      tf(num, { x: nx, y: ny, s, o: no });
      const blue = zap > 0.01 ? ` drop-shadow(0 0 ${(26 * U).toFixed(1)}px rgba(120,180,255,${(0.9 * zap).toFixed(3)}))` : '';
      numBox.style.filter = (bright > 1.01 ? `brightness(${bright.toFixed(3)}) ` : '') + glowF + blue;
      glints.forEach((g, i) => { const [gx, gy, t0] = GL[i], p = seg(t, t0, t0 + 0.45); g.style.left = (gx * numW - 55 * U) + 'px'; g.style.top = (gy * cellH - 55 * U) + 'px'; tf(g, { s: Math.sin(p * Math.PI) * 1.1, r: p * 120, o: p > 0 && p < 1 && t < DOCK0 ? 1 : 0 }); });
      // hairline: progress of the count, then the underline of the label
      const prog = land ? 1 : v / FINAL_N;
      tf(hair, { x: nx, y: lerp(hairY, dockN[1], dock), sx: prog, s: lerp(1, sDock, dock), o: (t < 91.85 ? 0 : 0.9) * (1 - seg(t, DOCK0, DOCK0 + 0.15)) });
      const lp = seg(t, 96.22, 96.6, E.outC);
      label.e.style.clipPath = `inset(0 ${(50 - 50 * lp).toFixed(1)}% 0 ${(50 - 50 * lp).toFixed(1)}%)`;
      tf(label.a, { x: lerp(CX, dockL[0], dock), y: lerp(lblY, dockL[1], dock), sx: lerp(1, dockLs[0], dock), sy: lerp(1, dockLs[1], dock), o: (lp > 0 ? 1 : 0) * (t >= XF + 0.03 ? 0 : 1) });
      rings.forEach((r, i) => { const d = t - 96 - i * 0.07; const p = seg(d, 0, 0.6, E.outC); tf(r, { x: CX, y: numY, s: 0.15 + 2.2 * p, o: d >= 0 ? (1 - p) * 0.95 : 0 }); });

      // ----- tiles -----
      const cl = clusterS(t), cc = ccen(t);
      const rects = [];
      tiles.forEach((T, i) => {
        const st = tileState(i, t);
        let x = st.x, y = st.y, sc = st.s;
        if (i === 1) { x = cc[0] + (x - CX) * cl + jit(t, 41); y = cc[1] + (y - CY) * cl + jit(t, 42); sc *= cl; }
        let bright = 1, filt = '';
        if (i === 0 && t >= XF + 0.03) bright = 1 + 0.55 * Math.exp(-(t - XF - 0.03) / 0.1);
        if (i === 1 && t >= STRIKE) { const d = t - STRIKE; bright = 1 + 1.6 * Math.exp(-d / 0.14) + 0.5 * Math.exp(-Math.max(0, t - 100.16) / 0.12) * (t >= 100.16 ? 1 : 0) + 0.5 * (t >= 100.84 ? Math.exp(-(t - 100.84) / 0.12) : 0); filt = `drop-shadow(0 0 ${(30 * U).toFixed(1)}px rgba(106,165,224,${(0.25 + 0.55 * Math.exp(-d / 0.3)).toFixed(3)}))`; }
        tf(T.a, { x, y, s: sc, o: st.o * (1 - seg(t, 103.68, 103.84)), bright, filter: filt });
        rects.push([x, y, T.w * sc, T.h * sc, st.o]);
      });
      sheens.forEach((sh, i) => sweep(sh, t, [XF + 0.06, STRIKE + 0.2, T2IN + 0.12][i], 0.5));

      // ----- kinetic UPDATED / IN SECONDS -----
      [[UPD, 100.16, UPD_Y, 0], [INS, 100.84, INS_Y, 1]].forEach(([T, t0, y0, j]) => {
        const d = t - t0, p = seg(d, 0, 0.2, E.outE);
        const sh = d >= 0 && d < 0.3 ? 1 : 0;
        const x = cc[0] + noise1(t * 40, 50 + j) * 10 * U * sh * (1 - d / 0.3) + jit(t, 43 + j), y = cc[1] + (y0 - CY) * cl + jit(t, 45 + j);
        const coll = seg(t, 103.0, 104.0);
        tf(T.a, { x, y, s: lerp(1.45, 1, p) * cl, o: d >= 0 ? clamp(d / 0.04) * (1 - seg(t, 103.66, 103.82)) : 0, blur: (1 - p) * 10 + coll * 6, bright: 1 + (d >= 0 ? 1.2 * Math.exp(-d / 0.1) : 0) });
      });

      // ----- lightning + streaks -----
      lc.clearRect(0, 0, W, H);
      lc.globalCompositeOperation = 'lighter';
      const fi = Math.floor(t * 30);
      // 98.0: the zap - a strike from the sky into the number, arcs crawling over and across the digits
      if (zd >= 0 && zd < 0.85) {
        const nw = numW * s, nh = inkH * s, ncy = ny + inkDY * s;
        const NR = [nx, ncy, nw * 1.04, nh * 1.18];
        if (zd < 0.3) {
          const vis = hash(fi, 61) > 0.25 || zd < 0.06;
          const a = (1 - zd / 0.3) * (vis ? 1 : 0.15);
          const pts = boltPts(nx + (hash(1, 63) - 0.5) * W * 0.25, -20 * U, nx + (hash(Math.floor(t * 12), 62) - 0.5) * nw * 0.4, ncy - nh * 0.55, Math.floor(t * 20), 0.36, 6);
          strokeBolt(lc, pts, 4.5 * U, a);
          for (let b = 0; b < 2; b++) { const m = pts[10 + b * 16] || pts[8]; strokeBolt(lc, boltPts(m[0], m[1], m[0] + (hash(b, 64) - 0.5) * 300 * U, m[1] + (90 + 120 * hash(b, 65)) * U, fi * 3 + b, 0.45, 4), 2 * U, a * 0.6); }
        }
        const arcA = 1 - seg(zd, 0, 0.85);
        const nArc = 2 + Math.round(4 * arcA);
        for (let b = 0; b < nArc; b++) {
          const u0 = hash(fi * 7 + b, 66), u1 = u0 + 0.03 + 0.07 * hash(fi * 7 + b, 67);
          const [ax, ay] = perim(NR, u0), [bx, by] = perim(NR, u1);
          strokeBolt(lc, boltPts(ax, ay, bx, by, fi * 11 + b, 0.5, 4), 2.4 * U, arcA * (0.6 + 0.4 * hash(fi, b + 68)));
        }
        if (zd < 0.5 && hash(fi, 69) > 0.3) {   // a crackle jumping digit to digit
          const k0 = Math.floor(hash(fi, 70) * 3), y0 = ncy + (hash(fi, 71) - 0.5) * nh * 0.6;
          const x0 = nx - nw / 2 + (k0 + 0.5 + (k0 > 0 ? spW / colW : 0)) * colW * s, x1 = x0 + colW * s * (1.1 + 0.5 * hash(fi, 72));
          strokeBolt(lc, boltPts(x0, y0, Math.min(x1, nx + nw / 2), y0 + (hash(fi, 73) - 0.5) * nh * 0.5, fi * 19, 0.5, 4), 2.2 * U, (1 - zd / 0.5));
        }
      }
      const r1 = rects[1];
      const R1 = [r1[0], r1[1], r1[2], r1[3]];
      if (t >= STRIKE && t < STRIKE + 0.28) {   // the strike from the sky that makes the "⚡ seconds" tile
        const vis = hash(fi, 61) > 0.25 || t < STRIKE + 0.06;
        const a = (1 - seg(t, STRIKE, STRIKE + 0.28)) * (vis ? 1 : 0.15);
        const sx = r1[0] + (hash(Math.floor(t * 12), 62) - 0.5) * r1[2] * 0.3;
        const pts = boltPts(sx + (hash(2, 63) - 0.5) * W * 0.2, -20 * U, r1[0], r1[1] - r1[3] / 2, Math.floor(t * 20) + 7, 0.36, 6);
        strokeBolt(lc, pts, 4 * U, a);
      }
      // arcs crawling on the "⚡ seconds" tile
      let arc = 0;
      if (t >= STRIKE) arc = Math.max(arc, 1 - seg(t, STRIKE, STRIKE + 0.7));
      if (t >= 100.16) arc = Math.max(arc, 0.9 * (1 - seg(t, 100.16, 100.6)));
      if (t >= 100.84) arc = Math.max(arc, 0.9 * (1 - seg(t, 100.84, 101.3)));
      if (t >= 100.3 && t < 103.0 && hash(fi, 71) > 0.55) arc = Math.max(arc, 0.4);
      if (t >= 103.0 && t < 103.7) arc = Math.max(arc, 0.4 + 0.5 * seg(t, 103, 103.7));
      if (arc > 0.02 && r1[4] > 0.05 && t < 103.7) {
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
          const ex = cc[0] + (hash(b + j * 5, 82) - 0.5) * T.w * 0.9 * cl, ey = cc[1] + (y0 - CY) * cl + (j ? -1 : 1) * T.h * 0.4 * cl;
          strokeBolt(lc, boltPts(sx, sy, ex, ey, fi * 13 + b + j * 50, 0.42, 5), 2.6 * U, a);
        }
      });
      // streaks converging (rising energy) - their focus slides to the anvil's strike point for the implosion
      const en = seg(t, 100.4, 104.0, E.inQ);
      if (en > 0.01) {
        const fp = seg(t, 102.4, 103.8, E.ioQ), fx0 = lerp(CX, CP[0], fp), fy0 = lerp(CY, CP[1], fp);
        const dtb = Math.max(0, t - 100.4);
        const phase = 0.25 * dtb + 2.6 * Math.pow(dtb, 3) / (3 * 3.6 * 3.6);
        const Rm = Math.hypot(W, H) * 0.6;
        for (let i = 0; i < 110; i++) {
          const ang = hash(i, 91) * TAU, u = ((phase * (0.7 + 0.6 * hash(i, 92)) + hash(i, 93)) % 1);
          const r = Rm * Math.pow(1 - u, 1.4) + 30 * U, len = (40 + 260 * en) * U * (0.5 + hash(i, 94));
          const a = Math.sin(u * Math.PI) * en * (0.35 + 0.65 * hash(i, 95));
          const c = hash(i, 96) > 0.5 ? '255,226,160' : '255,250,235';
          lc.strokeStyle = `rgba(${c},${(a * 0.8).toFixed(3)})`; lc.lineWidth = (1.2 + 2.2 * hash(i, 97)) * U;
          lc.beginPath(); lc.moveTo(fx0 + Math.cos(ang) * r, fy0 + Math.sin(ang) * r); lc.lineTo(fx0 + Math.cos(ang) * (r + len), fy0 + Math.sin(ang) * (r + len)); lc.stroke();
        }
      }
      if (t >= 103.2 && t < 103.85) {   // bolts into the core
        const a = seg(t, 103.2, 103.75) * (1 - seg(t, 103.75, 103.85));
        for (let b = 0; b < 4; b++) {
          if (hash(fi * 5 + b, 98) < 0.4) continue;
          const ang = hash(fi * 5 + b, 99) * TAU, R = Math.hypot(W, H) * 0.55;
          strokeBolt(lc, boltPts(CP[0] + Math.cos(ang) * R, CP[1] + Math.sin(ang) * R, CP[0], CP[1], fi * 17 + b, 0.3, 5), 2.4 * U, a * 0.8);
        }
      }
      lc.globalCompositeOperation = 'source-over';
      // implosion core at the strike point: grows on the reverse cymbal, becomes the light the anvil is struck in
      const cp = seg(t, 102.9, 104.0, E.inC), cf = seg(t, 104.0, 104.2, E.outQ);
      tf(core, { x: CP[0], y: CP[1], s: 0.02 + 1.5 * cp + 0.8 * cf + 0.04 * Math.sin(t * 40) * cp, o: t < 102.9 ? 0 : Math.min(1, cp * 1.4) * (1 - cf) });
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
    const k = ANV_K;
    const anv = anchor(world, 6);
    const A = Anvil(anv, k).place(0, 0);
    A.cv.style.filter = 'drop-shadow(0 0 18px rgba(255,240,210,.35))';
    // ---- real crops (the page subtitle is left out: page copy, unreadable at end-card size) ----
    const title = pieceA(world, 'title', 0, kTitle, 6);
    const titleSheen = sheen(title, 'rgba(255,248,225,.9)');
    const kB = P ? 2.6 : S ? 2.3 : 2.6;
    const go = pieceA(world, 'go', 0, kB, 7), all = pieceA(world, 'all', 0, kB, 7);
    const goSheen = sheen(go, 'rgba(255,255,255,.85)');
    const chips = [0, 1].map(i => pieceA(world, 'chip', i, kB, 7));
    const foot = pieceA(world, 'foot', 0, (W * (P ? 0.84 : S ? 0.88 : 0.42)) / (piece('foot') ? piece('foot').rect[2] : 400), 6);
    // ---- stamped lines ----
    const stMax = W * (L ? 0.66 : P ? 0.82 : 0.8), stS = Math.min(fitDom(world, 'START CRAFTING.', 'px', {}, stMax, (P ? 150 : 130) * U), fitDom(world, 'STOP GUESSING.', 'px', {}, stMax, (P ? 150 : 130) * U));
    const S1 = textA(world, 'STOP GUESSING.', stS, 'px', { color: '#eef1f6', filter: 'drop-shadow(0 10px 26px rgba(0,0,0,.85))' }, 8);
    const S2 = textA(world, 'START CRAFTING.', stS, 'px gold', { filter: 'drop-shadow(0 10px 26px rgba(0,0,0,.85)) drop-shadow(0 0 24px rgba(238,188,78,.35))' }, 8);
    const s2Sheen = (() => { const s = el('div', 'abs px', S2.e, { left: 0, top: 0, width: '100%', height: '100%', fontSize: 'inherit', lineHeight: 1, background: 'linear-gradient(100deg, rgba(255,255,255,0) 40%, rgba(255,255,255,.95) 50%, rgba(255,255,255,0) 60%)', backgroundSize: '300% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', opacity: 0 }); s.textContent = 'START CRAFTING.'; return s; })();
    // gold underline slammed under START CRAFTING. on the stamp hit
    const ulA = anchor(world, 8);
    const ulW = S2.w * 0.86, ulH = Math.max(3, 6 * U);
    const ulBar = el('div', 'abs', ulA, { left: -ulW / 2 + 'px', top: -ulH / 2 + 'px', width: ulW + 'px', height: ulH + 'px', transformOrigin: '0 50%', background: 'linear-gradient(90deg, rgba(238,188,78,0), #f5d47e 12%, #eebc4e 88%, rgba(238,188,78,0))', boxShadow: '0 0 18px rgba(238,188,78,.75)' });
    const S0 = Math.min(L ? 1.25 : 1.12, W * 0.92 / Math.max(S1.w, S2.w));   // stamp entry scale (fully visible on the hit): the line stays inside the frame
    // ---- kinetic line + URL ----
    const flHTML = P ? '<span>FREE</span><span class="dot">·</span><span>IN YOUR BROWSER</span><br><span>9 LANGUAGES</span>'
      : '<span>FREE</span><span class="dot">·</span><span>IN YOUR BROWSER</span><span class="dot">·</span><span>9 LANGUAGES</span>';
    const flStyle = { fontWeight: 700, letterSpacing: '.16em', color: '#dde2ec', textAlign: 'center', lineHeight: P ? 1.6 : 1 };
    const flS = fitDom(world, flHTML.replace(/class="dot"/g, 'style="margin:0 .55em"'), 'inter', flStyle, W * (L ? 0.42 : P ? 0.76 : 0.84), (P ? 44 : L ? 42 : 36) * U);
    const FL = textA(world, flHTML, flS, 'inter', flStyle, 8);
    const flParts = [...FL.e.children].filter(c => c.tagName === 'SPAN');
    flParts.forEach(c => { c.style.display = 'inline-block'; if (c.className === 'dot') { c.style.margin = '0 .55em'; c.style.color = '#eebc4e'; } });
    flParts[0].className = 'gold';
    flParts[flParts.length - 1].style.color = '#aab2c3';
    FL.w = FL.e.offsetWidth; FL.h = FL.e.offsetHeight; FL.e.style.left = -FL.w / 2 + 'px'; FL.e.style.top = -FL.h / 2 + 'px';
    const FLT = P ? [109.84, 110.4, 110.5, 111.42] : [109.84, 110.4, 110.5, 111.42, 111.5];
    // URL: one line, or two in 9:16 ("vanatoliyv.github.io/" + "albion-craft-profit", clear of the Reels/TikTok rail)
    const URL_LINES = P ? [[0, URL_HOST], [URL_HOST, URL_TXT.length]] : [[0, URL_TXT.length]];
    const urlFont = { fontWeight: 600, letterSpacing: '.01em' };
    const urlS = Math.min(...URL_LINES.map(([a, b]) => fitDom(world, URL_TXT.slice(a, b), 'inter', urlFont, W * (L ? 0.42 : P ? 0.74 : 0.8), (P ? 64 : L ? 46 : 42) * U)));
    const lineH = urlS * 1.25, lineGap = urlS * 0.1;
    const urlH = URL_LINES.length * lineH + (URL_LINES.length - 1) * lineGap;
    const urlA = anchor(world, 8);
    const prU = el('div', 'abs inter', world, Object.assign({ fontSize: urlS + 'px', whiteSpace: 'nowrap', visibility: 'hidden' }, urlFont));
    const wOf = str => { prU.textContent = str; return prU.offsetWidth; };
    const ULs = URL_LINES.map(([a, b], i) => {
      const w = wOf(URL_TXT.slice(a, b)), top = -urlH / 2 + i * (lineH + lineGap);
      const box = el('div', 'abs inter', urlA, Object.assign({ left: -w / 2 + 'px', top: top + 'px', width: w + 'px', fontSize: urlS + 'px', whiteSpace: 'nowrap', lineHeight: lineH + 'px', color: '#dde2ec' }, urlFont));
      const host = el('span', '', box), path = el('span', '', box, { color: '#f5d47e' });
      const line = el('div', 'abs', urlA, { left: -w / 2 + 'px', top: top + lineH + 3 * U + 'px', width: w + 'px', height: 2 * U + 'px', transformOrigin: '0 50%', background: 'linear-gradient(90deg, #eebc4e, rgba(238,188,78,.15))' });
      return { a, b, w, box, host, path, line, hs: null, ps: null };
    });
    const caret = el('span', '', ULs[0].box, { display: 'inline-block', width: Math.max(2, 0.09 * urlS) + 'px', height: urlS * 1.05 + 'px', background: '#f5d47e', marginLeft: 0.06 * urlS + 'px', verticalAlign: '-0.16em', boxShadow: '0 0 10px rgba(238,188,78,.8)' });
    const KEYS = evs('key', 'URL').map(e => e.t);
    const keyLen = []; { let n = 0; for (const c of URL_CHUNKS) { n += c.length; keyLen.push(n); } }
    const keyW = keyLen.map(n => ULs.map(Lx => { const e = Math.max(Lx.a, Math.min(n, Lx.b)); return e > Lx.a ? wOf(URL_TXT.slice(Lx.a, e)) : 0; }));
    prU.remove();
    const typedN = t => { let n = 0; for (let i = 0; i < KEYS.length; i++) if (t >= KEYS[i]) n = i + 1; return n; };
    // ---- cursor ----
    const cur = Cursor(world, 58 * U);

    // ---------------- layouts per phase ----------------
    const hOf = { anv: AH, title: title.h, s1: S1.h, s2: S2.h, btn: Math.max(go.h, all.h), chips: chips[0].h, fl: FL.h, url: urlH };
    function col(list, cy, cx = CX) {
      const ys = stack(list.map(([n, s, g]) => ({ h: hOf[n] * s, gap: (g || 0) * U })), cy);
      const out = {}; list.forEach(([n, s], i) => { out[n] = { x: cx, y: ys[i], s, o: 1 }; }); return out;
    }
    const STAMP = P ? col([['anv', 0.78], ['title', 0.9, 62], ['s1', 1, 120], ['s2', 1, 34]], H * 0.48)
      : S ? col([['anv', 0.62], ['title', 0.8, 38], ['s1', 1, 64], ['s2', 1, 22]], H * 0.5)
      : col([['anv', 0.66], ['title', 0.9, 36], ['s1', 1, 60], ['s2', 1, 20]], H * 0.5);
    const CTA = P ? col([['anv', 0.5], ['title', 0.72, 44], ['btn', 1, 100], ['chips', 1, 34], ['fl', 1, 70], ['url', 1, 54]], H * 0.44)
      : S ? col([['anv', 0.46], ['title', 0.7, 28], ['btn', 1, 60], ['chips', 1, 24], ['fl', 1, 48], ['url', 1, 34]], H * 0.5)
      : Object.assign(col([['anv', 0.9], ['title', 0.95, 46]], H * 0.5, W * 0.265), col([['btn', 1], ['chips', 1, 34], ['fl', 1, 64], ['url', 1, 48]], H * 0.5, W * 0.71));   // two columns, >= 0.06W apart
    const FINAL = P ? col([['anv', 0.85], ['title', 0.95, 72], ['url', 1.0, 70]], H * 0.46)
      : S ? col([['anv', 0.82], ['title', 0.92, 46], ['url', 1.05, 50]], H * 0.45)
      : col([['anv', 1.0], ['title', 1.08, 48], ['url', 1.25, 52]], H * 0.47);
    // pre-hit pose for the final snap (gathered in, a touch smaller), then a last inhale on the reverse cymbal
    const PRE = {}, PRE2 = {};
    for (const n of ['anv', 'title', 'url']) { PRE[n] = Object.assign({}, FINAL[n], { s: FINAL[n].s * 0.9, y: lerp(FINAL[n].y, H * 0.46, 0.1) }); PRE2[n] = Object.assign({}, PRE[n], { s: PRE[n].s * 0.95 }); }
    const XS0 = TS1 - 0.42;   // lockup -> stamp layout, landing just as STOP GUESSING. lands
    function lay(n, t) {
      const keys = n === 'url' ? [[108.42, CTA.url]]
        : [[XS0, LOCK[n]], [TS1 - 0.02, STAMP[n], E.ioC], [107.9, STAMP[n]], [108.42, CTA[n], E.outC]];
      keys.push([115.0, CTA[n]]);
      // 16:9: the URL dips under the wordmark's path first, so the two never cross on the way to the lockup
      if (L && n === 'url') keys.push([115.22, { x: lerp(CTA.url.x, PRE.url.x, 0.25), y: PRE.url.y + 30 * U, s: lerp(CTA.url.s, PRE.url.s, 0.4), o: 1 }, E.outQ], [115.55, PRE.url, E.ioQ]);
      else keys.push([115.5, PRE[n], E.ioQ]);
      keys.push([116.0, PRE2[n], E.inQ]);
      if (t < 116.0) return KO(t, keys);
      return mixO(PRE2[n], FINAL[n], spring(t - 116.0, 2.6, 0.42));
    }
    const rowX = (cx, s, ws, gap) => { const tot = ws.reduce((a, w) => a + w, 0) * s + gap * s * (ws.length - 1); let x = cx - tot / 2; return ws.map(w => { const c = x + w * s / 2; x += w * s + gap * s; return c; }); };
    // positions used by bursts
    const sp104 = strikePt(LOCK.anv), sp116 = strikePt(FINAL.anv);
    FX.burst({ t: 104.0, x: sp104[0], y: sp104[1], n: 190, speed: 2000, angle: -Math.PI / 2, spread: 2.7, gravity: 2600, life: 1.25, size: 4, color: [255, 214, 140], streak: 0.03 });
    FX.burst({ t: 104.0, x: sp104[0], y: sp104[1], n: 70, speed: 950, angle: -Math.PI / 2, spread: TAU, gravity: 900, life: 0.7, size: 3, color: [255, 255, 255] });
    FX.burst({ t: 116.0, x: sp116[0], y: sp116[1], n: 220, speed: 2100, angle: -Math.PI / 2, spread: 2.8, gravity: 2600, life: 1.4, size: 4, color: [255, 214, 140], streak: 0.03 });
    FX.burst({ t: 116.0, x: sp116[0], y: sp116[1], n: 80, speed: 1000, angle: -Math.PI / 2, spread: TAU, gravity: 900, life: 0.8, size: 3, color: [255, 255, 255] });
    // stamp dust kicks out from the ends of each line (never over the words)
    for (const sd of [-1, 1]) {
      FX.burst({ t: TS1 + 0.06, x: STAMP.s1.x + sd * S1.w * 0.5, y: STAMP.s1.y + S1.h * 0.3, n: 30, speed: 700, angle: sd > 0 ? -0.3 : Math.PI + 0.3, spread: 1.8, gravity: 400, life: 0.6, size: 2.5, color: [215, 222, 236] });
      FX.burst({ t: TS2 + 0.06, x: STAMP.s2.x + sd * S2.w * 0.5, y: STAMP.s2.y + S2.h * 0.3, n: 45, speed: 1000, angle: sd > 0 ? -0.3 : Math.PI + 0.3, spread: 1.8, gravity: 500, life: 0.7, size: 3, color: [255, 214, 140] });
    }
    const ulY = STAMP.s2.y + S2.h / 2 + 16 * U;
    FX.burst({ t: UL_T + 0.1, x: CX + ulW / 2, y: ulY, n: 40, speed: 800, angle: 0, spread: 1.6, gravity: 500, life: 0.55, size: 2.5, color: [255, 224, 150] });
    for (const sd of [-1, 1]) FX.burst({ t: SH_T, x: CX + sd * S2.w * 0.5, y: STAMP.s2.y, n: 30, speed: 850, angle: sd > 0 ? 0 : Math.PI, spread: 2.2, gravity: 600, life: 0.55, size: 2.5, color: [255, 224, 150] });   // from the line's ends, not over the word
    const goC = (() => { const xs = rowX(CTA.btn.x, CTA.btn.s, [go.w, all.w], 26 * U); return [xs[0], CTA.btn.y]; })();
    // the cursor lands on the arrow end of "Open Crafting →" (never over the word)
    const goTip = [goC[0] + go.w * CTA.btn.s * 0.32, goC[1] + go.h * CTA.btn.s * 0.28];
    FX.burst({ t: 112.0, x: goTip[0], y: goTip[1], n: 90, speed: 1100, angle: 0, spread: TAU, gravity: 400, life: 0.8, size: 3, color: [255, 226, 160] });
    FX.burst({ t: 112.0, x: goTip[0], y: goTip[1], n: 30, speed: 600, angle: 0, spread: TAU, gravity: 0, life: 0.6, size: 2, color: [255, 255, 255] });
    // 4-point sparkles around the clicked button
    const stars = [0, 1, 2, 3, 4].map(i => el('div', 'abs', world, { width: 70 * U + 'px', height: 70 * U + 'px', zIndex: 9, opacity: 0 },
      `<svg viewBox="-10 -10 20 20" width="${70 * U}" height="${70 * U}"><path d="M0,-10 L1.4,-1.4 L10,0 L1.4,1.4 L0,10 L-1.4,1.4 L-10,0 L-1.4,-1.4 Z" fill="#fff6dc"/></svg>`));

    return (t) => {
      // background energy
      rays.style.opacity = (0.75 * seg(t, 104.0, 104.6) * (1 - 0.45 * seg(t, 108, 109)) + 0.25 * (t >= 116 ? Math.exp(-(t - 116) / 0.8) : 0)).toFixed(3);
      tf(rays, { r: (t - 104) * 6 });
      tf(world, { s: (1 + 0.018 * seg(t, 108.4, 115.0, E.ioQ) * (1 - seg(t, 115.0, 115.9, E.ioQ))) * (1 + 0.022 * seg(t, 116.3, 120, E.ioQ)) });

      // ---- anvil: born in the core's glare exactly on the hit ----
      const a = lay('anv', t);
      const ain = seg(t, 103.98, 104.0);
      const pop = t >= 104 ? 1 + 0.06 * (1 - spring(t - 104, 3, 0.45)) : 1.06;
      tf(anv, { x: a.x, y: a.y, s: a.s * pop, o: ain });
      A.draw(t, [104.0, 116.0]);
      const gstrike = Math.max(t >= 104 ? Math.exp(-(t - 104) / 0.5) : 0, t >= 116 ? Math.exp(-(t - 116) / 0.6) : 0);
      tf(glow, { x: a.x, y: a.y - AH * 0.1 * a.s, s: (0.55 + 0.35 * a.s) * (1 + 0.15 * gstrike), o: (0.55 + 0.45 * gstrike) * ain });
      const rr = t >= 116 ? 116 : 104, rp = seg(t, rr, rr + 0.6, E.outC);
      const spn = strikePt(a);
      tf(ring, { x: spn[0], y: spn[1], s: 0.12 + 1.6 * rp, o: t >= 104 ? (1 - rp) : 0 });

      // ---- wordmark ----
      const ti = lay('title', t), ta = spring(t - 104.04, 2.8, 0.6);
      tf(title.a, { x: ti.x, y: ti.y, s: ti.s * (1 + (P ? 0.12 : 0.2) * (1 - ta)), o: t >= 104.04 ? clamp(ta * 3) : 0, blur: (1 - clamp(ta)) * 8 });
      sweep(titleSheen, t, 104.45, 0.7); if (t > 105.5) sweep(titleSheen, t, 108.6, 0.8); if (t > 110) sweep(titleSheen, t, 116.45, 0.9);

      // ---- stamps (on the voiced words), accents on the stamp hits ----
      const out = seg(t, 107.84, 108.02, E.inQ);
      const punch = t >= SH_T ? 1 + 0.035 * Math.exp(-(t - SH_T) / 0.12) : 1;
      [[S1, TS1, -1.5, -1, 's1'], [S2, TS2, 1.5, 1, 's2']].forEach(([T, t0, rot, dir, key]) => {
        const st = STAMP[key], d = t - t0;
        if (d < 0) { T.a.style.opacity = 0; return; }
        // fully inked ON the stamp hit (d = 0): a touch large + bright, settling with a little wobble
        const LAND = 0.07;
        const land = d < LAND ? lerp(S0, 1, E.outQ(d / LAND)) : 1 + 0.03 * Math.exp(-(d - LAND) * 16) * Math.sin((d - LAND) * 55);
        // whoosh: the stamps blow past the camera as the CTA comes in
        tf(T.a, { x: st.x + dir * out * W * 0.12, y: st.y, s: land * punch * (1 + 0.3 * out), r: rot, o: 1 - out, blur: (d < LAND ? (1 - d / LAND) * 2 : 0) + out * 16, bright: 1 + 0.7 * Math.exp(-d / 0.08) });
      });
      const s2p = seg(t, SH_T, SH_T + 0.6, E.ioQ); s2Sheen.style.opacity = s2p > 0 && s2p < 1 ? 1 : 0; s2Sheen.style.backgroundPosition = `${(100 - 100 * s2p).toFixed(1)}% 0`;
      const ulp = seg(t, UL_T, UL_T + 0.12, E.outE);
      tf(ulA, { x: STAMP.s2.x + out * W * 0.12, y: ulY, s: punch * (1 + 0.3 * out), r: 1.5, o: t >= UL_T ? 1 - out : 0, blur: out * 16 });
      tf(ulBar, { sx: Math.max(0.001, ulp), bright: 1 + 1.2 * (t >= UL_T ? Math.exp(-(t - UL_T) / 0.12) : 0) });

      // ---- CTA elements (108-116) ----
      const ctaOut = seg(t, 114.9, 115.2, E.outQ);
      const suck = (st) => ({ x: st.x, y: st.y + 18 * U * ctaOut, s: st.s * (1 - 0.15 * ctaOut), o: 1 - ctaOut });
      const bx = rowX(CTA.btn.x, CTA.btn.s, [go.w, all.w], 26 * U);
      [[go, 107.94, bx[0]], [all, 107.98, bx[1]]].forEach(([T, t0, x0], j) => {
        const d = t - t0, sa2 = spring(d, 2.8, 0.55);
        const st = suck({ x: lerp(CTA.btn.x, x0, clamp(sa2, 0, 1.1)), y: CTA.btn.y, s: CTA.btn.s, o: 1 });
        let s = st.s * (0.75 + 0.25 * sa2), bright = 1, filt = '';
        if (j === 0) {   // the click: a gold glow, no colour shift
          const c = t - 112.0;
          if (c > -0.08 && c < 0.1) s *= 1 - 0.07 * (1 - Math.abs(c) / 0.1);
          if (c >= 0.1) s *= 1 + 0.05 * Math.exp(-(c - 0.1) / 0.25) * Math.sin((c - 0.1) * 22);
          const hov = seg(t, 111.75, 111.95) * (1 - seg(t, 112.6, 113.2)), hit = c >= 0 ? Math.exp(-c / 0.3) : 0;
          bright = 1 + 0.15 * hit + 0.05 * hov;
          const g = Math.min(1, 0.45 * hov + hit);
          if (g > 0.01) filt = `drop-shadow(0 0 ${(30 * U * g).toFixed(1)}px rgba(238,188,78,${(0.85 * g).toFixed(3)}))`;
        }
        tf(T.a, { x: st.x, y: st.y + (1 - sa2) * 50 * U, s, o: d >= 0 ? clamp(sa2 * 2.5) * st.o : 0, bright, filter: filt });
      });
      sweep(goSheen, t, 112.05, 0.55); if (t > 113) sweep(goSheen, t, 113.5, 0.6);
      const cx2 = rowX(CTA.chips.x, CTA.chips.s, [chips[0].w, chips[1].w], 18 * U);
      chips.forEach((T, j) => {
        const t0 = 108.3 + j * 0.12, d = t - t0, ca = spring(d, 3, 0.45);
        const st = suck({ x: cx2[j], y: CTA.chips.y, s: CTA.chips.s, o: 1 });
        tf(T.a, { x: st.x, y: st.y, s: st.s * (0.4 + 0.6 * ca), r: (j ? 5 : -5) * (1 - ca), o: d >= 0 ? clamp(ca * 2) * st.o : 0 });
      });
      // kinetic line, word-synced to the VO ("Free" 109.84, "in your browser" 110.5) + "9 languages" after it
      const fst = suck(CTA.fl);
      tf(FL.a, { x: fst.x, y: fst.y, s: fst.s, o: t >= 109.8 ? fst.o : 0 });
      flParts.forEach((c, i) => { const d = t - FLT[i], pa = spring(d, 3.2, 0.5); tf(c, { y: (1 - pa) * 0.8 * flS, s: i === 0 ? 1 + 0.35 * (1 - clamp(pa)) : 1, o: d >= 0 ? clamp(pa * 2) : 0 }); });
      // URL: types on the 12 key clicks, then gathers with the lockup
      const n = typedN(t), len = n ? keyLen[n - 1] : 0;
      let ci = ULs.findIndex(Lx => len < Lx.b); if (ci < 0) ci = ULs.length - 1;
      ULs.forEach((Lx, i) => {
        const e = Math.max(Lx.a, Math.min(len, Lx.b)), hEnd = Math.min(e, Math.max(Lx.a, URL_HOST));
        const hs = URL_TXT.slice(Lx.a, hEnd), ps = URL_TXT.slice(Math.max(Lx.a, hEnd), e);
        if (hs !== Lx.hs) { Lx.host.textContent = hs; Lx.hs = hs; }
        if (ps !== Lx.ps) { Lx.path.textContent = ps; Lx.ps = ps; }
        tf(Lx.line, { sx: Math.max(0.001, n ? keyW[n - 1][i] / Lx.w : 0), o: 0.85 * (1 - seg(t, 115.0, 115.5)) });
      });
      if (caret.parentNode !== ULs[ci].box) ULs[ci].box.appendChild(caret);
      const u = lay('url', t);
      const typing = t >= 109.95 && t < 111.6;
      caret.style.opacity = t < 109.95 || t >= 115.0 ? 0 : (typing || Math.floor((t - 111.6) * 2.6) % 2 === 0 ? 1 : 0);
      tf(urlA, { x: u.x, y: u.y, s: u.s, o: t >= 109.9 ? 1 : 0 });
      // cursor: flies in, clicks the real "Open Crafting →" at 112.0, drifts away
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
