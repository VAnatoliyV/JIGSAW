// HOOK (0–16 s): "CRAFTING BLIND BURNS YOUR SILVER." → seven cities → one Black Market →
// thousands of moving prices → tax / station fee / resource return burn your profit into embers.
(function () {
  const { W, H, U, E, K, seg, spring, clamp, lerp, hash, noise1, el, tf, show, scene, P, L, S, motionBlur } = FX;
  const { text, fit, measure } = FX.lib;

  // ======================= 1. five kinetic words =======================
  scene('hookWords', 0, 6.05, (Lr) => {
    const WORDS = [
      { w: 'CRAFTING', t: 0.5, cls: 'gold', max: 260 },
      { w: 'BLIND', t: 1.5, cls: '', max: 300, color: '#eef1f6' },
      { w: 'BURNS', t: 2.5, cls: 'fire', max: 300 },
      { w: 'YOUR', t: 3.5, cls: '', max: P ? 170 : 200, heroMax: 420, color: '#eef1f6' },
      { w: 'SILVER.', t: 4.0, cls: 'silver', max: 320 },
    ];
    const LINES = P ? [[0], [1], [2], [3], [4]] : S ? [[0], [1], [2], [3, 4]] : [[0, 1], [2], [3, 4]];
    const maxW = W * (L ? 0.84 : 0.88), gapEm = 0.32;
    const capH = P ? 1e9 : (S ? 230 : 300);
    // stack layout
    const lineSizes = LINES.map(line => {
      const str = line.map(i => WORDS[i].w).join(' ');
      return Math.min(fit(str, maxW, 1000), ...line.map(i => WORDS[i].max), capH);
    });
    let totalH = lineSizes.reduce((a, s) => a + s * 0.92, 0) + (LINES.length - 1) * 18 * U;
    const k = Math.min(1, (H * (P ? 0.78 : 0.8)) / totalH);
    let y = H / 2 - totalH * k / 2;
    const stack = el('div', 'fill', Lr, { transformOrigin: '50% 50%' });
    const flashLine = el('div', 'abs', Lr, { left: W * 0.2 + 'px', top: H / 2 - 2 + 'px', width: W * 0.6 + 'px', height: 4 * U + 'px', background: 'linear-gradient(90deg, transparent, #f5d47e, transparent)', boxShadow: '0 0 30px #eebc4e' });
    LINES.forEach((line, li) => {
      const size = lineSizes[li] * k;
      // DOM-measured widths (canvas measureText can disagree with the laid-out font)
      const widths = line.map(i => { const probe = text(stack, WORDS[i].w, size, 'px'); const w = probe.w; probe.e.remove(); return w; });
      const lineW = widths.reduce((a, b) => a + b, 0) + (line.length - 1) * gapEm * size;
      let x = W / 2 - lineW / 2;
      const cy = y + size * 0.46;
      line.forEach((i, j) => {
        const wd = WORDS[i];
        const T = text(stack, wd.w, size, 'px ' + wd.cls, wd.color ? { color: wd.color } : {});
        T.place(x + widths[j] / 2, cy);
        wd.T = T; wd.stackSize = size; wd.dir = (li + j) % 2 ? 1 : -1;
        // hero (single word, centred, big)
        wd.heroScale = Math.min(fit(wd.w, W * 0.9, 1000), (P ? 0.36 : 0.62) * H, wd.heroMax || wd.max * 1.25) / size;
        x += widths[j] + gapEm * size;
      });
      y += size * 0.92 + 18 * U;
    });
    // shine sweep overlays for the gold/silver words
    const shines = [WORDS[0], WORDS[4]].map(wd => {
      const s = el('div', 'abs px', wd.T.e, { left: 0, top: 0, width: '100%', height: '100%', background: 'linear-gradient(100deg, rgba(255,255,255,0) 40%, rgba(255,255,255,.95) 50%, rgba(255,255,255,0) 60%)', backgroundSize: '300% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', fontSize: 'inherit' });
      s.textContent = wd.w; return s;
    });
    // BURNS heat shimmer
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('width', 0); svg.setAttribute('height', 0); svg.style.position = 'absolute';
    svg.innerHTML = `<filter id="heat" x="-20%" y="-30%" width="140%" height="160%"><feTurbulence id="heatT" type="fractalNoise" baseFrequency="0.012 0.05" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="0" id="heatD" xChannelSelector="R" yChannelSelector="G"/></filter>`;
    Lr.appendChild(svg);
    const heatT = svg.querySelector('#heatT'), heatD = svg.querySelector('#heatD');
    // BURNS letters split for the rising stagger
    const burns = WORDS[2].T.e; burns.textContent = ''; burns.classList.remove('fire');
    const chars = [...'BURNS'].map(c => { const s = el('span', 'fire', burns, { display: 'inline-block' }); s.textContent = c; return s; });
    burns.style.filter = 'url(#heat)';
    // eyelids for BLIND
    const lidT = el('div', 'abs', Lr, { left: 0, top: 0, width: W + 'px', height: H / 2 + 2 + 'px', background: '#050608', zIndex: 20 });
    const lidB = el('div', 'abs', Lr, { left: 0, top: H / 2 - 2 + 'px', width: W + 'px', height: H / 2 + 2 + 'px', background: '#050608', zIndex: 20 });
    // shock rings
    const rings = WORDS.map(() => el('div', 'abs', Lr, { left: W / 2 - 300 * U + 'px', top: H / 2 - 300 * U + 'px', width: 600 * U + 'px', height: 600 * U + 'px', borderRadius: '50%', border: `${6 * U}px solid rgba(245,212,126,.8)`, opacity: 0 }));
    // stars for SILVER
    const stars = [0, 1, 2, 3].map(i => el('div', 'abs', Lr, { width: 90 * U + 'px', height: 90 * U + 'px', opacity: 0 },
      `<svg viewBox="-10 -10 20 20" width="${90 * U}" height="${90 * U}"><path d="M0,-10 L1.4,-1.4 L10,0 L1.4,1.4 L0,10 L-1.4,1.4 L-10,0 L-1.4,-1.4 Z" fill="#fff"/></svg>`));
    // sparks / embers
    FX.burst({ t: 2.5, x: W / 2, y: H / 2 + 80 * U, n: 90, speed: 700, angle: -Math.PI / 2, spread: 1.6, gravity: -250, life: 1.2, size: 3, color: [255, 150, 60], streak: 0.03 });
    FX.burst({ t: 4.0, x: W / 2, y: H / 2, n: 80, speed: 1500, spread: Math.PI * 2, gravity: 400, life: 0.8, size: 2.5, color: [235, 240, 255] });
    FX.burst({ t: 0.5, x: W / 2, y: H / 2, n: 50, speed: 1300, spread: Math.PI * 2, gravity: 600, life: 0.6, size: 2.5, color: [255, 214, 130] });
    const STACK_T = 4.5, OUT_T = 5.75;
    const mb = motionBlur();
    return (t) => {
      // pre-roll gold line
      const pl = seg(t, 0.0, 0.5, E.inC);
      tf(flashLine, { sx: 0.05 + pl, o: t < 0.5 ? 0.25 + 0.75 * pl : 0 });
      // lids
      const lid = seg(t, 2.22, 2.5, E.inQ);
      show(lidT, t >= 2.2 && t < 2.5); show(lidB, t >= 2.2 && t < 2.5);
      tf(lidT, { y: -H / 2 * (1 - lid) }); tf(lidB, { y: H / 2 * (1 - lid) });
      // words
      WORDS.forEach((wd, i) => {
        const T = wd.T, e = T.e;
        const next = i < 4 ? WORDS[i + 1].t : STACK_T;
        const heroOn = t >= wd.t && t < next;
        const stackOn = t >= STACK_T;
        if (!heroOn && !stackOn) { e.style.opacity = 0; return; }
        const dx = W / 2 - T.cx, dy = H / 2 - T.cy;
        let o = { x: dx, y: dy, s: wd.heroScale, o: 1, blur: 0 };
        const dt = t - wd.t;
        if (heroOn) {
          if (i === 0) { const p = seg(dt, 0, 0.2, E.outE); o.s *= lerp(2.3, 1, p) * (1 + 0.05 * dt); o.blur = (1 - p) * 16; o.o = seg(dt, 0, 0.04); }
          if (i === 1) { const p = seg(dt, 0, 0.22, E.outE); e.style.letterSpacing = lerp(0.5, 0.02, p) + 'em'; o.o = p; o.blur = lerp(10, 0, p) + seg(t, 1.9, 2.45, E.inQ) * 30; o.o *= 1 - 0.6 * seg(t, 2.0, 2.45); o.s *= 1 + 0.08 * dt; }
          if (i === 2) {
            chars.forEach((c, j) => { const a = spring(dt - j * 0.035, 3.0, 0.55); c.style.transform = `translateY(${((1 - a) * 0.9 * T.h).toFixed(1)}px)`; c.style.opacity = clamp(a * 1.5).toFixed(2); });
            heatD.setAttribute('scale', (14 + 8 * Math.sin(t * 40)).toFixed(1)); heatT.setAttribute('seed', String(Math.floor(t * 24)));
            o.s *= 1 + 0.06 * dt; o.bright = 1 + 0.25 * noise1(t * 20, 4);
          }
          if (i === 3) { const p = spring(dt, 3.5, 0.45); o.y = dy - (1 - p) * H * 0.4; }
          if (i === 4) { const p = seg(dt, 0, 0.18, E.outE); o.s *= lerp(1.6, 1, p); o.o = seg(dt, 0, 0.03); o.blur = (1 - p) * 10; }
        } else {
          // stack phase: slide into the composed sentence
          e.style.letterSpacing = '0.02em';
          chars.forEach(c => { c.style.transform = 'none'; c.style.opacity = 1; });
          const st = t - STACK_T - i * 0.045;
          if (i === 4) { const p = seg(t, STACK_T, STACK_T + 0.28, E.outE); o = { x: dx * (1 - p), y: dy * (1 - p), s: lerp(wd.heroScale, 1, p), o: 1 }; }
          else { const p = seg(st, 0, 0.3, E.outE); o = { x: wd.dir * (1 - p) * W, y: 0, s: 1, o: st > 0 ? 1 : 0, blur: (1 - p) * 6 }; }
          o.s *= 1 + 0.02 * seg(t, 4.8, 5.75);
          if (i === 2) { heatD.setAttribute('scale', (5 + 3 * Math.sin(t * 40)).toFixed(1)); heatT.setAttribute('seed', String(Math.floor(t * 24))); }
        }
        tf(e, o);
      });
      // shines
      shines.forEach((s, j) => { const t0 = j ? 4.05 : 0.6; const p = seg(t, t0, t0 + 0.6, E.ioQ); const p2 = seg(t, 4.9 + j * 0.15, 5.5 + j * 0.15, E.ioQ); s.style.backgroundPosition = `${(100 - 100 * Math.max(t < 4.5 ? p : p2, 0)).toFixed(1)}% 0`; s.style.opacity = (t < 4.5 ? (p > 0 && p < 1 ? 1 : 0) : (p2 > 0 && p2 < 1 ? 1 : 0)); });
      // rings
      rings.forEach((r, i) => { const dt = t - WORDS[i].t; const p = seg(dt, 0, 0.45, E.outC); tf(r, { s: 0.3 + 1.6 * p, o: dt >= 0 && dt < 0.45 && i !== 1 ? (1 - p) * 0.9 : 0 }); });
      // silver stars
      stars.forEach((st, i) => {
        const T = WORDS[4].T; const t0 = 4.0 + i * 0.12;
        const p = seg(t, t0, t0 + 0.5);
        const sx = T.cx - T.w / 2 + T.w * [0.12, 0.4, 0.7, 0.95][i], sy = T.cy + T.h * [-0.35, 0.3, -0.4, 0.2][i];
        const hero = t < STACK_T;
        const cx = hero ? W / 2 + (sx - T.cx) * WORDS[4].heroScale : sx, cy = hero ? H / 2 + (sy - T.cy) * WORDS[4].heroScale : sy;
        st.style.left = (cx - 45 * U) + 'px'; st.style.top = (cy - 45 * U) + 'px';
        tf(st, { s: Math.sin(p * Math.PI) * 1.2, r: p * 90, o: p > 0 && p < 1 ? 1 : 0 });
      });
      // zoom-through exit
      const z = seg(t, OUT_T, 6.05, E.inE);
      tf(stack, { s: 1 + 5 * z, o: 1 - seg(t, 5.9, 6.05) });
      stack.style.filter = z > 0.01 ? `blur(${(z * 14).toFixed(1)}px)` : 'none';
    };
  }, { z: 10 });

  // ======================= 2. seven cities → one Black Market =======================
  const CITIES = [['fortsterling', 'Fort Sterling'], ['lymhurst', 'Lymhurst'], ['bridgewatch', 'Bridgewatch'], ['martlock', 'Martlock'], ['thetford', 'Thetford'], ['caerleon', 'Caerleon'], ['brecilien', 'Brecilien']];
  FX.CITIES = CITIES;
  scene('cities', 5.98, 8.75, (Lr) => {
    const n = 7, horiz = !L;  // horizontal bands (portrait/square) or vertical slices (landscape)
    const bands = CITIES.map(([slug, name], i) => {
      const b = el('div', 'abs', Lr, { overflow: 'hidden', background: '#000' });
      const img = el('img', 'abs', b, { transformOrigin: '0 0' }); img.src = `../assets/cities/${slug}-hero.webp`;
      const shade = el('div', 'fill', b, { background: horiz ? 'linear-gradient(90deg, rgba(5,6,10,.75) 0%, rgba(5,6,10,0) 55%)' : 'linear-gradient(0deg, rgba(5,6,10,.85) 0%, rgba(5,6,10,0) 45%)' });
      const tint = el('div', 'fill', b, { background: 'rgba(5,6,10,1)', opacity: 0 });
      const red = el('div', 'fill', b, { background: 'linear-gradient(180deg, rgba(120,12,18,.55), rgba(20,0,4,.75))', mixBlendMode: 'multiply', opacity: 0 });
      const lblSize = horiz ? (P ? 56 : 38) * U : Math.min(34 * U, fit(name.toUpperCase(), W / n - 30 * U, 40 * U));
      const lbl = el('div', 'abs px', b, { fontSize: lblSize + 'px', color: '#fff', textShadow: '0 3px 12px rgba(0,0,0,.8)' });
      lbl.innerHTML = `<span style="color:#eebc4e;font-size:.62em;margin-right:.5em">0${i + 1}</span>${name.toUpperCase()}`;
      return { b, img, tint, red, lbl, i };
    });
    const dark = el('div', 'fill', Lr, { background: 'radial-gradient(55% 40% at 50% 50%, rgba(5,6,10,.82) 0%, rgba(5,6,10,.25) 100%)' });
    const seven = text(Lr, '7', (P ? 520 : 440) * U, 'px gold', { filter: 'drop-shadow(0 12px 30px rgba(0,0,0,.8))' });
    const citiesT = text(Lr, 'CITIES', (P ? 170 : 150) * U, 'px', { color: '#fff', filter: 'drop-shadow(0 8px 20px rgba(0,0,0,.9))' });
    const lay7 = P ? [W / 2, H * 0.43, W / 2, H * 0.6] : S ? [W * 0.5, H * 0.4, W / 2, H * 0.68] : [W * 0.36, H * 0.5, W * 0.6, H * 0.5];
    seven.place(lay7[0], lay7[1]); citiesT.place(lay7[2] + (L ? citiesT.w / 2 - 60 * U : 0), lay7[3]);
    const one = text(Lr, '1', (P ? 460 : 380) * U, 'px gold', { filter: 'drop-shadow(0 12px 30px rgba(0,0,0,.8))' });
    const bmSize = fit('BLACK MARKET', W * (L ? 0.5 : 0.86), 170 * U);
    const bm = text(Lr, 'BLACK MARKET', bmSize, 'px', { color: '#fff', filter: 'drop-shadow(0 8px 20px rgba(0,0,0,.9))' });
    const inC = text(Lr, 'in Caerleon', 44 * U, 'inter', { color: '#e46f61', fontWeight: 600, letterSpacing: '.04em' });
    if (L) { one.place(W * 0.24, H * 0.5); bm.place(W * 0.6, H * 0.46); inC.place(W * 0.6, H * 0.46 + bmSize * 0.75); }
    else { one.place(W / 2, H * (P ? 0.4 : 0.36)); bm.place(W / 2, H * (P ? 0.56 : 0.64)); inC.place(W / 2, H * (P ? 0.56 : 0.64) + bmSize * 0.8); }
    const mbs = bands.map(() => motionBlur());
    const BM_T = 7.25;
    return (t) => {
      const bmP = seg(t, BM_T, BM_T + 0.32, E.outE);
      bands.forEach((B, i) => {
        // slot
        let x, y, w, h;
        if (horiz) { w = W; h = H / n; x = 0; y = i * h; } else { w = W / n; h = H; x = i * w; y = 0; }
        if (i === 5) { x = lerp(x, 0, bmP); y = lerp(y, 0, bmP); w = lerp(w, W, bmP); h = lerp(h, H, bmP); }
        const t0 = 6.0 + i * 0.125;
        const p = seg(t, t0, t0 + 0.32, E.outE);
        const dir = i % 2 ? 1 : -1;
        let ox = horiz ? dir * (1 - p) * W : 0, oy = horiz ? 0 : dir * (1 - p) * H;
        let o = t >= t0 ? 1 : 0;
        if (i !== 5) { const q = seg(t, BM_T + Math.abs(i - 5) * 0.03, BM_T + 0.3 + Math.abs(i - 5) * 0.03, E.inC); if (horiz) ox += (i < 5 ? -1 : 1) * q * W; else oy += (i < 5 ? -1 : 1) * q * H; o *= 1 - q; }
        B.b.style.left = x + 'px'; B.b.style.top = y + 'px'; B.b.style.width = w + 'px'; B.b.style.height = h + 'px';
        tf(B.b, { x: ox, y: oy, o, filter: (1 - p) > 0.02 ? mbs[i].url : 'none' });
        mbs[i].set(horiz ? (1 - p) * 40 : 0, horiz ? 0 : (1 - p) * 40);
        // cover-fit image with slow drift
        const cs = Math.max(w / 2200, h / 620) * 1.18 * (1 + 0.04 * (t - 6) + (i === 5 ? 0.12 * seg(t, BM_T, 8.75) : 0));
        const iw = 2200 * cs, ih = 620 * cs;
        const drift = (hash(i, 3) - 0.5) * 0.1 + dir * 0.03 * (t - 6);
        B.img.style.transform = `translate(${((w - iw) / 2 + drift * iw * 0.3).toFixed(1)}px,${((h - ih) / 2).toFixed(1)}px) scale(${cs.toFixed(5)})`;
        B.lbl.style.left = (horiz ? 44 * U : (w - B.lbl.offsetWidth) / 2) + 'px';
        B.lbl.style.top = (horiz ? (h - B.lbl.offsetHeight) / 2 : h - 90 * U) + 'px';
        B.lbl.style.opacity = (i === 5 ? 1 - bmP : 1).toFixed(2);
        if (i === 5) { B.red.style.opacity = bmP.toFixed(3); B.tint.style.opacity = (0.15 * bmP + 0.75 * seg(t, 8.2, 8.75, E.inQ)).toFixed(3); }
      });
      // 7 CITIES
      const a7 = spring(t - 6.0, 2.6, 0.5), out7 = seg(t, BM_T - 0.08, BM_T + 0.12, E.inC);
      tf(seven.e, { s: (1.5 - 0.5 * a7) * (1 - 0.3 * out7), o: (t >= 6.0 ? 1 : 0) * (1 - out7), y: -out7 * 200 * U });
      const ac = spring(t - 6.25, 3, 0.5);
      tf(citiesT.e, { y: (1 - ac) * 80 * U - out7 * 200 * U, o: (t >= 6.25 ? clamp(ac) : 0) * (1 - out7) });
      dark.style.opacity = (seg(t, 6.0, 6.3) * (1 - 0.4 * bmP)).toFixed(3);
      // 1 BLACK MARKET
      const a1 = spring(t - BM_T, 2.8, 0.45);
      tf(one.e, { s: 1.8 - 0.8 * a1, o: t >= BM_T ? 1 - seg(t, 8.4, 8.7) : 0 });
      const ab = spring(t - BM_T - 0.1, 3, 0.5);
      tf(bm.e, { y: (1 - ab) * 60 * U, o: t >= BM_T + 0.1 ? clamp(ab) * (1 - seg(t, 8.4, 8.7)) : 0 });
      tf(inC.e, { o: seg(t, 7.6, 7.8) * (1 - seg(t, 8.4, 8.7)) });
    };
  }, { z: 12 });

  // ======================= 3. thousands of prices, all moving =======================
  scene('flood', 8.45, 10.95, (Lr) => {
    const names = ITEMS.names;
    const pitch = (P ? 50 : 46) * U, fs = (P ? 28 : 26) * U;
    const rowsN = Math.ceil(H / pitch) + 1;
    const field = el('div', 'fill', Lr);
    const mb = motionBlur();
    const rows = [];
    for (let r = 0; r < rowsN; r++) {
      const row = el('div', 'abs inter', field, { top: (r * pitch) + 'px', left: '0px', fontSize: fs + 'px', fontWeight: 500, whiteSpace: 'nowrap', color: '#8b93a8' });
      let html = '';
      for (let k = 0; k < 16; k++) {
        const idx = Math.floor(hash(r * 31 + k, 7) * names.length);
        const nm = names[idx].replace(/&/g, '&amp;');
        const hcol = hash(r * 31 + k, 8);
        const mark = hcol < 0.16 ? '<span style="color:#62c96f">▲</span> ' : hcol < 0.30 ? '<span style="color:#e46f61">▼</span> ' : '';
        const col = hcol > 0.9 ? 'color:#eebc4e' : '';
        html += `<span style="${col}">${mark}${nm}</span><span style="color:#333c55;margin:0 .9em">◆</span>`;
      }
      row.innerHTML = html + html;
      const w = row.offsetWidth / 2;
      rows.push({ row, w, dir: r % 2 ? 1 : -1, v: (160 + hash(r, 9) * 260) * U, ph: hash(r, 10) * w, dist: Math.abs(r * pitch - H / 2) / (H / 2) });
    }
    const vign = el('div', 'fill', Lr, { background: `radial-gradient(${P ? '70% 22%' : '45% 30%'} at 50% 50%, rgba(8,9,13,.96) 0%, rgba(8,9,13,.75) 55%, rgba(8,9,13,0) 100%)` });
    const L1 = text(Lr, 'THOUSANDS', fit('THOUSANDS', W * (L ? 0.5 : 0.84), 230 * U), 'px gold', { filter: 'drop-shadow(0 8px 24px rgba(0,0,0,.9))' });
    const L2 = text(Lr, 'OF PRICES', fit('OF PRICES', W * (L ? 0.5 : 0.84), 200 * U) * 0.8, 'px', { color: '#fff' });
    const L3 = text(Lr, 'ALL MOVING', fit('ALL MOVING', W * (L ? 0.5 : 0.84), 200 * U) * 0.8, 'px', { color: '#fff' });
    const gap = 16 * U, tot = L1.h + L2.h + L3.h + 2 * gap;
    let yy = H / 2 - tot / 2;
    for (const T of [L1, L2, L3]) { T.place(W / 2, yy + T.h / 2); yy += T.h + gap; }
    return (t) => {
      const dt = t - 8.45;
      const out = seg(t, 10.72, 10.95, E.inQ);
      rows.forEach((R, i) => {
        const appear = seg(t, 8.45 + R.dist * 0.35, 8.75 + R.dist * 0.35, E.outC);
        let x = -R.ph + R.dir * (R.v * dt + 220 * U * dt * dt);
        x = ((x % R.w) + R.w) % R.w - R.w;
        R.row.style.transform = `translate(${(x + R.dir * out * W * 0.8).toFixed(1)}px,0)`;
        R.row.style.opacity = (appear * (0.35 + 0.65 * (1 - R.dist) * 0.8)).toFixed(3);
      });
      field.style.filter = out > 0.01 ? mb.url : 'none'; mb.set(out * 80, 0);
      field.style.opacity = (1 - out).toFixed(3);
      vign.style.opacity = seg(t, 8.8, 9.0).toFixed(3);
      const a1 = spring(t - 9.0, 3, 0.5), a2 = spring(t - 9.5, 3, 0.5), a3 = spring(t - 10.5, 3.4, 0.4);
      const z = 1 + 2.5 * out;
      tf(L1.e, { s: (0.6 + 0.4 * a1) * z, o: (t >= 9.0 ? clamp(a1 * 2) : 0) * (1 - out), y: (L1.cy - H / 2) * (z - 1) });
      tf(L2.e, { y: (1 - a2) * 50 * U + (L2.cy - H / 2) * (z - 1), s: z, o: (t >= 9.5 ? clamp(a2 * 2) : 0) * (1 - out) });
      const jit = t >= 10.5 ? 1 : 0;
      tf(L3.e, { x: jit * noise1(t * 30, 5) * 10 * U, y: (1 - a3) * 50 * U + jit * noise1(t * 30, 6) * 8 * U + (L3.cy - H / 2) * (z - 1), s: z, o: jit * clamp(a3 * 2) * (1 - out) });
    };
  }, { z: 14 });

  // ======================= 4. costs stamp in, then burn your profit =======================
  scene('costs', 10.72, 16.1, (Lr) => {
    // journal page
    const page = el('div', 'fill', Lr, {
      background: `repeating-linear-gradient(180deg, rgba(238,188,78,0) 0px, rgba(238,188,78,0) ${62 * U}px, rgba(238,188,78,.07) ${62 * U}px, rgba(238,188,78,.07) ${64 * U}px), linear-gradient(90deg, rgba(0,0,0,0) ${W * 0.1}px, rgba(228,111,97,.18) ${W * 0.1}px, rgba(228,111,97,.18) ${W * 0.1 + 3 * U}px, rgba(0,0,0,0) ${W * 0.1 + 3 * U}px), radial-gradient(80% 70% at 50% 45%, #161b28 0%, #0b0d12 100%)`,
    });
    const cv = el('canvas', 'fill', Lr); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    // stamps
    const STAMPS = [
      { s: 'TAX', t: 11.0, col: '#e46f61', rot: -7, pos: P ? [0.5, 0.25] : S ? [0.3, 0.26] : [0.24, 0.33], max: P ? 0.5 : 0.36 },
      { s: 'STATION FEE', t: 11.75, col: '#e46f61', rot: 4, pos: P ? [0.5, 0.41] : S ? [0.6, 0.45] : [0.66, 0.3], max: 0.8 },
      { s: 'RESOURCE RETURN', t: 12.75, col: '#e46f61', rot: -3, pos: P ? [0.5, 0.56] : S ? [0.5, 0.63] : [0.5, 0.58], max: 0.86 },
    ];
    const PROFIT = { s: 'PROFIT', t: 13.5, pos: P ? [0.5, 0.75] : S ? [0.5, 0.85] : [0.5, 0.82] };
    const maxS = L ? 150 * U : 135 * U;
    for (const st of STAMPS) {
      const size = fit(st.s, W * st.max * (L ? 0.6 : 0.82), st.s.length < 4 ? 230 * U : maxS);
      const pad = size * 0.32;
      ctx.font = `600 ${size}px 'Pixelify Sans'`;
      const tw = ctx.measureText(st.s).width;
      const oc = document.createElement('canvas'); oc.width = Math.ceil(tw + pad * 2 + 20); oc.height = Math.ceil(size * 1.2 + pad * 2);
      const o = oc.getContext('2d');
      o.strokeStyle = st.col; o.fillStyle = st.col; o.lineWidth = size * 0.07;
      const r = size * 0.16, bx = o.lineWidth, by = o.lineWidth, bw = oc.width - 2 * o.lineWidth, bh = oc.height - 2 * o.lineWidth;
      o.beginPath(); o.roundRect(bx, by, bw, bh, r); o.stroke();
      o.lineWidth = size * 0.025; o.beginPath(); o.roundRect(bx + size * 0.11, by + size * 0.11, bw - size * 0.22, bh - size * 0.22, r * 0.6); o.stroke();
      o.font = `600 ${size}px 'Pixelify Sans'`; o.textAlign = 'center'; o.textBaseline = 'middle';
      o.fillText(st.s, oc.width / 2, oc.height / 2 + size * 0.06);
      // worn ink
      o.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < oc.width * oc.height / 90; i++) { const x = hash(i, 21) * oc.width, y = hash(i, 22) * oc.height, rr = hash(i, 23) * 2.2 * U + 0.4; o.globalAlpha = 0.3 + hash(i, 24) * 0.7; o.fillRect(x, y, rr, rr); }
      o.globalAlpha = 1; o.globalCompositeOperation = 'source-over';
      st.oc = oc; st.size = size;
    }
    const profitSize = fit('PROFIT', W * (L ? 0.42 : 0.74), 230 * U);
    // static composition (for ember/content sampling)
    function drawStatic(c, t, opts = {}) {
      for (const st of STAMPS) {
        const dt = t - st.t; if (dt < 0) continue;
        const land = dt < 0.09 ? lerp(1.75, 1, E.inQ(dt / 0.09)) : 1 + 0.025 * Math.exp(-(dt - 0.09) * 18) * Math.sin((dt - 0.09) * 60);
        c.save(); c.translate(st.pos[0] * W, st.pos[1] * H); c.rotate(st.rot * Math.PI / 180); c.scale(land, land);
        c.globalAlpha = clamp(dt / 0.04) * (opts.alpha == null ? 1 : opts.alpha);
        c.drawImage(st.oc, -st.oc.width / 2, -st.oc.height / 2); c.restore();
      }
      const dp = t - PROFIT.t;
      if (dp >= 0) {
        const a = spring(dp, 2.6, 0.5);
        c.save(); c.translate(PROFIT.pos[0] * W, PROFIT.pos[1] * H); c.scale(0.7 + 0.3 * a, 0.7 + 0.3 * a);
        c.globalAlpha = clamp(dp / 0.08);
        const g = c.createLinearGradient(0, -profitSize / 2, 0, profitSize / 2);
        g.addColorStop(0, '#fbe39a'); g.addColorStop(0.5, '#eebc4e'); g.addColorStop(1, '#b9852a');
        c.fillStyle = g; c.font = `600 ${profitSize}px 'Pixelify Sans'`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.shadowColor = 'rgba(238,188,78,.55)'; c.shadowBlur = 40 * U;
        c.fillText('PROFIT', 0, 0); c.restore();
      }
    }
    // burn field
    const CELL = Math.round(12 * U), GX = Math.ceil(W / CELL), GY = Math.ceil(H / CELL);
    const vn = (x, y, s) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const h = (a, b) => hash(a * 7919 + b, s); return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v); };
    const TH = new Float32Array(GX * GY);
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) TH[gy * GX + gx] = 0.55 * vn(gx * 0.11, gy * 0.11, 31) + 0.25 * vn(gx * 0.35, gy * 0.35, 32) + 0.35 * (gy / GY);
    // invert so the burn climbs from the bottom: low threshold burns first
    for (let i = 0; i < TH.length; i++) TH[i] = 1.15 - TH[i];
    const B0 = 13.85, B1 = 15.3;
    let thMin = 1e9, thMax = -1e9;   // filled from the content cells below
    const burnP = t => lerp(thMin - 0.04, thMax + 0.1, seg(t, B0, B1, E.ioQ));
    const burnTime = th => { // invert burnP (ioQ) numerically
      let lo = B0, hi = B1; for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (burnP(m) < th) lo = m; else hi = m; } return hi; };
    // content cells from the final composition
    const sc = document.createElement('canvas'); sc.width = W; sc.height = H; const sctx = sc.getContext('2d');
    drawStatic(sctx, 13.85);
    const sd = sctx.getImageData(0, 0, W, H).data;
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const px = Math.min(W - 1, gx * CELL + (CELL >> 1)), py = Math.min(H - 1, gy * CELL + (CELL >> 1));
      if (sd[(py * W + px) * 4 + 3] > 60) { const v = TH[gy * GX + gx]; thMin = Math.min(thMin, v); thMax = Math.max(thMax, v); }
    }
    const content = [];
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const px = Math.min(W - 1, gx * CELL + (CELL >> 1)), py = Math.min(H - 1, gy * CELL + (CELL >> 1));
      if (sd[(py * W + px) * 4 + 3] > 60) content.push({ gx, gy, th: TH[gy * GX + gx], tb: burnTime(TH[gy * GX + gx]), seed: content.length });
    }
    // embers: a subset rises; FX.forgeEmbers are handed to the forge scene to become the anvil
    const embers = content.filter(c => hash(c.seed, 41) < 0.35);
    FX.costEmbers = embers.map(c => ({ x0: c.gx * CELL + CELL / 2, y0: c.gy * CELL + CELL / 2, tb: c.tb, seed: c.seed }));
    FX.costCell = CELL;
    return (t) => {
      const enter = seg(t, 10.72, 10.95, E.outE);
      tf(page, { y: (1 - enter) * H * 0.4, o: enter * (1 - seg(t, 15.4, 16.0)) });
      ctx.clearRect(0, 0, W, H);
      tf(cv, { y: (1 - enter) * H * 0.4 });
      drawStatic(ctx, t);
      const p = burnP(t);
      if (p > 0) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        for (let i = 0; i < TH.length; i++) if (TH[i] < p) ctx.fillRect((i % GX) * CELL, Math.floor(i / GX) * CELL, CELL, CELL);
        ctx.globalCompositeOperation = 'source-atop';
        for (let i = 0; i < TH.length; i++) {
          const d = TH[i] - p;
          if (d >= 0 && d < 0.09) { const k = 1 - d / 0.09; ctx.fillStyle = `rgba(255,${(120 + 110 * k) | 0},${(40 + 60 * k) | 0},${(0.55 + 0.45 * k).toFixed(2)})`; ctx.fillRect((i % GX) * CELL, Math.floor(i / GX) * CELL, CELL, CELL); }
          else if (d >= 0.09 && d < 0.16) { ctx.fillStyle = 'rgba(40,20,10,0.55)'; ctx.fillRect((i % GX) * CELL, Math.floor(i / GX) * CELL, CELL, CELL); }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }, { z: 16 });
})();
