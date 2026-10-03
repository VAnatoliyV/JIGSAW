// REVEAL (16–32 s): embers forge the real anvil mark on the drop, the wordmark lands,
// then the real homepage assembles itself piece by piece on the beat.
(function () {
  const { W, H, U, E, K, seg, spring, clamp, lerp, hash, noise1, el, tf, show, scene, P, L, S, PROFILE } = FX;
  const { text, fit, Anvil, PageView, stateInfo, VP } = FX.lib;
  const STRIKE = 16.0;
  const HOME = stateInfo('home') || { pieces: {} };
  const PIECES = HOME.pieces || {};
  const piece = (k, i = 0) => (PIECES[k] || [])[i];

  // ---------- page layout used by the assembly (and the forge hand-off) ----------
  const FULL = stateInfo('home_full');
  const pageW = VP.width, pageH = FULL ? FULL.page[1] : 2000;
  const box = P ? { x: W * 0.07, y: H * 0.05, w: W * 0.86, h: H * 0.9 } : S ? { x: W * 0.06, y: H * 0.06, w: W * 0.88, h: H * 0.88 } : { x: W * 0.08, y: H * 0.06, w: W * 0.84, h: H * 0.88 };
  const z0 = box.w / pageW;
  // camera keys (page css px): [t, cy, z]
  const pr = (k, i = 0) => { const p = piece(k, i); return p ? p.rect : [0, 0, pageW, 100]; };
  const yOf = (k, i = 0, f = 0.5) => { const r = pr(k, i); return r[1] + r[3] * f; };
  const visH = box.h / z0;
  const camTop = Math.max(visH / 2, yOf('title') - visH * 0.32);
  const fitAllZ = Math.min(box.h * 0.96 / pageH, box.w * 0.92 / pageW);
  const pullZ = Math.max(fitAllZ, z0 * (P ? 0.55 : 0.62));
  const CAM = [
    [19.9, camTop, z0],
    [22.2, Math.max(camTop, yOf('stat', 0) - visH * 0.12), z0],
    [24.0, Math.max(camTop, yOf('chip', 0) - visH * 0.1), z0],
    [25.0, Math.max(camTop, yOf('card', 0) - visH * 0.05), z0],
    [27.4, Math.min(pageH - visH / 2, yOf('card', 9) - visH * 0.25), z0],
    [28.4, Math.min(pageH / 2, yOf('card', 2)), pullZ],
    [31.6, Math.min(pageH / 2, yOf('card', 2)) - 40, pullZ * 1.06],
  ];
  function camAt(t) {
    const cy = K(t, CAM.map(([tt, cy]) => [tt, cy, E.ioC]));
    const z = K(t, CAM.map(([tt, , zz]) => [tt, zz, E.ioC]));
    return { cx: pageW / 2, cy, z };
  }
  // page → screen at time t (no tilt)
  function toScreen(t, px, py) { const c = camAt(t); return [box.x + box.w / 2 + (px - c.cx) * c.z, box.y + box.h / 2 + (py - c.cy) * c.z]; }
  FX.assembly = { camAt, toScreen, box, piece };

  // ======================= forge =======================
  scene('forge', 15.2, 20.05, (Lr) => {
    const scale = P ? 16 : 12;
    const center = [W / 2, H * (P ? 0.36 : 0.37)];
    const glow = el('div', 'abs', Lr, { left: center[0] - 600 * U + 'px', top: center[1] - 600 * U + 'px', width: 1200 * U + 'px', height: 1200 * U + 'px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(238,188,78,.38) 0%, rgba(238,188,78,.12) 35%, rgba(238,188,78,0) 70%)' });
    const ring = el('div', 'abs', Lr, { left: center[0] - 400 * U + 'px', top: center[1] - 400 * U + 'px', width: 800 * U + 'px', height: 800 * U + 'px', borderRadius: '50%', border: `${10 * U}px solid rgba(255,236,190,.9)`, boxShadow: '0 0 60px rgba(238,188,78,.8)' });
    const A = Anvil(Lr, scale).place(center[0], center[1]);
    A.cv.style.filter = 'drop-shadow(0 0 18px rgba(255,240,210,.35))';
    // embers that become the anvil
    const cv = el('canvas', 'fill', Lr); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
    const src = FX.costEmbers || [];
    const core = A.core;
    const targets = core.map((_, i) => A.pixelScreen(i));
    // pick, for each anvil pixel, an ember (cycling if fewer)
    const order = src.map((e, i) => i).sort((a, b) => hash(a, 77) - hash(b, 77));
    const forgeE = targets.map((tg, i) => { const s = src.length ? src[order[i % order.length]] : { x0: W / 2, y0: H, tb: 15.0, seed: i }; return { s, tg, ts: 15.3 + hash(i, 78) * 0.35, jitter: i >= order.length }; });
    const freePos = (e, t) => { const dt = Math.max(0, t - e.tb); return [e.x0 + noise1(dt * 2 + e.seed, 3) * 40 * U, e.y0 - dt * (90 + 60 * hash(e.seed, 5)) * U - dt * dt * 40 * U]; };
    // wordmark + subtitle: the real crops
    const tp = piece('title'), sp = piece('sub');
    const titleW = Math.min(W * (L ? 0.5 : 0.84), 1000 * U);
    const tScale = tp ? titleW / tp.rect[2] : 1;
    const title = el('img', 'abs', Lr); if (tp) { title.src = tp.img; title.style.width = tp.rect[2] * tScale + 'px'; title.style.height = tp.rect[3] * tScale + 'px'; }
    const titleY = center[1] + 22 * scale + (P ? 150 : 110) * U;
    title.style.left = (W / 2 - (tp ? tp.rect[2] * tScale : 0) / 2) + 'px'; title.style.top = (titleY - (tp ? tp.rect[3] * tScale : 0) / 2) + 'px';
    const sub = el('img', 'abs', Lr); const sScale = tScale * 0.95;
    if (sp) { sub.src = sp.img; sub.style.width = sp.rect[2] * sScale + 'px'; sub.style.height = sp.rect[3] * sScale + 'px'; sub.style.left = (W / 2 - sp.rect[2] * sScale / 2) + 'px'; sub.style.top = (titleY + (tp ? tp.rect[3] * tScale : 0) * 0.62) + 'px'; }
    // sparks from the strike point
    const strikePt = [A.x + (AJLogo.HIT_X + 0.5) * scale, A.y + (AJLogo.ANVIL_TOP) * scale];
    FX.burst({ t: STRIKE, x: strikePt[0], y: strikePt[1], n: 160, speed: 1900, angle: -Math.PI / 2, spread: 2.6, gravity: 2600, life: 1.2, size: 4, color: [255, 214, 140], streak: 0.03 });
    FX.burst({ t: STRIKE, x: strikePt[0], y: strikePt[1], n: 60, speed: 900, angle: -Math.PI / 2, spread: Math.PI * 2, gravity: 900, life: 0.7, size: 3, color: [255, 255, 255] });
    FX.burst({ t: 18.0, x: W / 2, y: titleY, n: 60, speed: 1200, angle: 0, spread: Math.PI * 2, gravity: 300, life: 0.6, size: 2.5, color: [255, 220, 150] });
    FX.flash(STRIKE, 0.35, 0.07);
    return (t) => {
      // embers → anvil pixels
      ctx.clearRect(0, 0, W, H);
      const pre = t < STRIKE;
      if (pre) {
        ctx.globalCompositeOperation = 'lighter';
        for (const e of src) {
          if (t < e.tb) continue;
          const [x, y] = freePos(e, t);
          const life = 1 - seg(t, e.tb + 0.4, e.tb + 1.6);
          const a = life * (0.6 + 0.4 * Math.sin(t * 20 + e.seed));
          if (a <= 0.02) continue;
          const sz = FX.costCell * 0.7;
          ctx.fillStyle = `rgba(255,${(140 + 80 * hash(e.seed, 6)) | 0},60,${(a * 0.22).toFixed(3)})`;
          ctx.fillRect(x - sz * 1.5, y - sz * 1.5, sz * 3, sz * 3);
          ctx.fillStyle = `rgba(255,${(150 + 80 * hash(e.seed, 6)) | 0},70,${a.toFixed(3)})`;
          ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        }
        for (const f of forgeE) {
          const e = f.s;
          const born = Math.min(e.tb, f.ts);
          if (t < born) continue;
          const [fx, fy] = t > e.tb ? freePos(e, t) : [e.x0, e.y0];
          const p = E.inC(seg(t, f.ts, STRIKE));
          const x = lerp(fx, f.tg[0], p), y = lerp(fy, f.tg[1], p);
          const sz = lerp(FX.costCell * 0.55, scale, p);
          const c = [lerp(255, 242, p), lerp(160, 239, p), lerp(60, 233, p)];
          ctx.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(0.55 + 0.45 * p).toFixed(3)})`;
          ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      cv.style.display = pre ? '' : 'none';
      // the anvil itself, struck on the drop
      show(A.cv, t >= STRIKE);
      if (t >= STRIKE) A.draw(t, [STRIKE]);
      // hand-off to the assembled page (19.7 → 20.0): fly to the logo rect
      const hand = seg(t, 19.68, 20.0, E.ioC);
      const lr = piece('logo') ? piece('logo').rect : null;
      if (lr) {
        const [sx, sy] = toScreen(20.0, lr[0] + lr[2] / 2, lr[1] + lr[3] / 2);
        const targetScale = (lr[3] * camAt(20.0).z) / (58 * scale);
        const cx = A.x + 22 * scale, cy = A.y + 29 * scale;   // canvas centre
        tf(A.cv, { x: (sx - cx) * hand, y: (sy - cy) * hand, s: lerp(1 + 0.02 * Math.sin(t * Math.PI * 2), targetScale, hand) });
      }
      const g = 0.75 + 0.25 * Math.cos((t - STRIKE) * Math.PI * 2);
      tf(glow, { s: 0.6 + 0.5 * seg(t, 15.6, 16.1, E.outC), o: seg(t, 15.4, 16.0) * g * (1 - hand) });
      const rp = seg(t, STRIKE, STRIKE + 0.55, E.outC);
      tf(ring, { s: 0.15 + 1.5 * rp, o: t >= STRIKE ? (1 - rp) : 0 });
      // wordmark
      if (tp) {
        const a = spring(t - 18.0, 2.6, 0.55);
        let o = { s: (1.25 - 0.25 * a), o: t >= 18.0 ? clamp(a * 3) : 0, blur: (1 - clamp(a)) * 8 };
        const tr = piece('title').rect;
        const [sx, sy] = toScreen(20.0, tr[0] + tr[2] / 2, tr[1] + tr[3] / 2);
        const ts = (tr[2] * camAt(20.0).z) / (tr[2] * tScale);
        o.x = (sx - W / 2) * hand; o.y = (sy - titleY) * hand; o.s = lerp(o.s, ts, hand);
        tf(title, o);
      }
      if (sp) {
        const a = spring(t - 18.5, 3, 0.6);
        tf(sub, { y: (1 - a) * 30 * U, o: (t >= 18.5 ? clamp(a * 2) : 0) * (1 - hand) });
      }
    };
  }, { z: 18 });

  // ======================= homepage assembles =======================
  scene('assembly', 19.98, 32.05, (Lr) => {
    const tilt = el('div', 'fill', Lr, { transformOrigin: '50% 50%' });
    const view = PageView(tilt, box, { radius: 30 * U });
    view.inner.style.width = pageW + 'px'; view.inner.style.height = pageH + 'px';
    view.inner.style.background = 'radial-gradient(1200px 600px at 70% -10%, #171d2e 0%, #0b0d12 55%)';
    const full = view.add('home_full');
    const hasFull = !!full;
    // schedule: [key, index, time]
    const S0 = [['title', 0, 20.0], ['sub', 0, 20.5], ['lead', 0, 21.0], ['go', 0, 21.5], ['all', 0, 22.0], ['stat', 0, 22.5], ['stat', 1, 22.75], ['stat', 2, 23.0], ['view', 0, 23.25],
      ['chip', 0, 24.0], ['chip', 1, 24.25], ['chip', 2, 24.5], ['chip', 3, 24.75]];
    for (let i = 0; i < 10; i++) S0.push(['card', i, 25.0 + i * 0.25]);
    S0.push(['dl', 0, 27.5], ['status', 0, 27.6], ['foot', 0, 27.7]);
    const items = [];
    for (const [k, i, t0] of S0) {
      const p = piece(k, i); if (!p) continue;
      const im = el('img', 'ui', view.inner, { left: p.rect[0] + 'px', top: p.rect[1] + 'px', width: p.rect[2] + 'px', height: p.rect[3] + 'px', transformOrigin: '50% 50%' });
      im.src = p.img;
      const a = hash(items.length, 61) * Math.PI * 2;
      const still = k === 'title';   // arrives via the forge hand-off
      items.push({ im, t0: still ? 19.98 : t0, k, dx: still ? 0 : Math.cos(a) * (60 + 80 * hash(items.length, 62)), dy: still ? 0 : 70 + 60 * hash(items.length, 63), rot: still ? 0 : (hash(items.length, 64) - 0.5) * 10, still });
    }
    // live anvil in the logo slot
    const lr = piece('logo') ? piece('logo').rect : [pageW / 2 - 70, 40, 140, 190];
    const anv = Anvil(view.inner, lr[3] / 58);
    anv.cv.style.left = (lr[0] + lr[2] / 2 - 22 * lr[3] / 58) + 'px'; anv.cv.style.top = lr[1] + 'px';
    // "FREE." kinetic word + popped chips for the VO "Free. No sign-up. No ads."
    const dim = el('div', 'fill', Lr, { background: 'rgba(5,6,10,.55)', zIndex: 39, opacity: 0 });
    const free = text(Lr, 'FREE.', fit('FREE.', W * 0.6, (P ? 260 : 220) * U), 'px gold', { filter: 'drop-shadow(0 14px 40px rgba(0,0,0,.85))', zIndex: 40 });
    free.place(W / 2, H * (P ? 0.3 : 0.32));
    const popChips = [[0, 29.25], [1, 30.1]].map(([i, t0]) => {
      const p = piece('chip', i); if (!p) return null;
      const im = el('img', 'abs', Lr, { zIndex: 41 }); im.src = p.img;
      const sc = (P ? 2.6 : 2.2) * (pageW > 1000 ? 0.85 : 1.6) * U;
      const w = p.rect[2] * sc, h = p.rect[3] * sc;
      im.style.width = w + 'px'; im.style.height = h + 'px';
      return { im, p, t0, w, h, sc, i };
    }).filter(Boolean);
    return (t) => {
      const c = camAt(t);
      view.setCam(c.cx, c.cy, c.z);
      // pieces
      for (const it of items) {
        const dt = t - it.t0;
        const a = it.still ? 1 : spring(dt, 2.7, 0.52);
        const vis = dt >= 0;
        it.im.style.opacity = vis ? clamp(dt / 0.06).toFixed(3) : 0;
        if (vis) it.im.style.transform = `translate(${((1 - a) * it.dx).toFixed(1)}px,${((1 - a) * it.dy).toFixed(1)}px) rotate(${((1 - a) * it.rot).toFixed(2)}deg) scale(${(0.86 + 0.14 * a).toFixed(4)})`;
        it.im.style.filter = vis && !it.still && dt < 0.12 ? `blur(${((1 - dt / 0.12) * 4).toFixed(1)}px)` : 'none';
      }
      anv.draw(t, [STRIKE]);
      // swap to the exact full-page capture once everything has landed
      if (hasFull) { const f = seg(t, 27.9, 28.3); full.style.opacity = f; for (const it of items) if (f >= 1) it.im.style.opacity = 0; }
      // tilt + whoosh out
      const tl = seg(t, 27.6, 28.6, E.ioC), out = seg(t, 31.55, 32.05, E.inE);
      tf(tilt, { rx: 14 * tl + 4 * Math.sin((t - 28) * 0.8) * tl, ry: (L ? -16 : -10) * tl + 3 * Math.sin((t - 28) * 0.6) * tl, persp: 2400 * U, y: -out * H * 1.1, s: 1 - 0.1 * tl + 0.2 * out, o: 1 - out * 0.6 });
      // FREE + chips
      const af = spring(t - 28.6, 3, 0.45);
      const fo = seg(t, 30.9, 31.3);
      dim.style.opacity = (seg(t, 28.5, 28.7) * (1 - fo)).toFixed(3);
      tf(free.e, { s: (1.6 - 0.6 * af) * (1 - 0.3 * fo), o: (t >= 28.6 ? clamp(af * 2) : 0) * (1 - fo), y: -fo * 80 * U });
      popChips.forEach((pc, j) => {
        const a = spring(t - pc.t0, 2.8, 0.5);
        const [sx, sy] = [W / 2 + (j ? 1 : -1) * W * (L ? 0.16 : 0.2), H * (P ? 0.44 : 0.5)];
        pc.im.style.left = (sx - pc.w / 2) + 'px'; pc.im.style.top = (sy - pc.h / 2) + 'px';
        tf(pc.im, { s: 0.4 + 0.6 * a, r: (j ? 4 : -4) * (1 - a) + (j ? 3 : -3), o: (t >= pc.t0 ? clamp(a * 2) : 0) * (1 - fo), y: -fo * 80 * U });
      });
    };
  }, { z: 20 });
})();
