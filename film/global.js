// Global layers: background, particles (embers + spark bursts), camera shake/punch, flashes, grain, vignette.
(function () {
  const { W, H, U, E, K, seg, clamp, lerp, hash, noise1, el, tf, TL, evs, scene, always } = FX;

  // ---------- background (whole film) ----------
  scene('bg', 0, 999, (L) => {
    const base = el('div', 'fill', L, { background: '#0b0d12' });
    const glowA = el('div', 'fill', L, { background: 'radial-gradient(70% 45% at 70% -5%, rgba(23,29,46,.8) 0%, rgba(11,13,18,0) 75%)' });
    const glowB = el('div', 'fill', L, { background: 'radial-gradient(50% 35% at 50% 55%, rgba(238,188,78,0.10) 0%, rgba(238,188,78,0) 70%)' });
    // the faint pixel grid that echoes the brand's pixel logo
    const grid = el('div', 'fill', L, {
      backgroundImage: `linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)`,
      backgroundSize: `${24 * U}px ${24 * U}px`,
      maskImage: 'radial-gradient(70% 60% at 50% 50%, #000 0%, transparent 100%)',
      WebkitMaskImage: 'radial-gradient(70% 60% at 50% 50%, #000 0%, transparent 100%)',
    });
    return (t) => {
      glowB.style.opacity = (0.6 + 0.4 * Math.sin(t * Math.PI)).toFixed(3);   // breathes at 1 cycle / 2 beats
      grid.style.opacity = K(t, [[0, 0], [0.5, 0.9], [16, 0.6], [104, 0.6], [120, 0.3]]).toFixed(3);
      grid.style.backgroundPosition = `0px ${(-t * 12 * U).toFixed(1)}px`;
    };
  }, { z: -100 });

  // ---------- particles ----------
  const bursts = [];
  FX.burst = (b) => bursts.push(Object.assign({ n: 70, speed: 900, spread: Math.PI * 2, angle: -Math.PI / 2, gravity: 1500, life: 0.9, size: 3, color: [255, 200, 110], seed: bursts.length * 97 + 11, streak: 0.022 }, b));
  // ember intensity over the film (0..1)
  const emberLevel = t => K(t, [[0, 0], [2.4, 0], [2.6, 1], [3.5, 0.6], [6, 0.15], [11, 0.3], [14, 1], [16, 0.9], [20, 0.35], [32, 0.35], [80, 0.3], [88, 0.15], [96, 0.6], [104, 0.9], [116, 1], [120, 0.4]]);
  FX.emberLevel = emberLevel;

  scene('particles', 0, 999, (L) => {
    const cv = el('canvas', 'fill', L); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const N = 140;
    return (t) => {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const lvl = emberLevel(t);
      if (lvl > 0.01) {
        for (let i = 0; i < N; i++) {
          if (hash(i, 5) > lvl) continue;
          const P = 3.5 + hash(i, 1) * 5;
          const ph = ((t + hash(i, 2) * P) % P) / P;
          const x = hash(i, 3) * W + 40 * U * Math.sin((t + i) * (0.6 + hash(i, 4))) + noise1(t * 0.7 + i, 9) * 30 * U;
          const y = H * 1.05 - ph * H * (1.15 + hash(i, 6) * 0.3);
          const r = (1.2 + hash(i, 7) * 3.2) * U;
          const a = Math.sin(ph * Math.PI) * (0.35 + 0.65 * hash(i, 8)) * (0.75 + 0.25 * Math.sin(t * 13 + i));
          const hot = hash(i, 10);
          ctx.fillStyle = `rgba(255,${(150 + hot * 90) | 0},${(60 + hot * 60) | 0},${(a * 0.9).toFixed(3)})`;
          ctx.fillRect(x - r / 2, y - r / 2, r, r);   // square embers: pixel-art friendly
        }
      }
      for (const b of bursts) {
        const dt = t - b.t;
        if (dt < 0 || dt > b.life * 1.6) continue;
        const ox = typeof b.x === 'function' ? b.x() : b.x, oy = typeof b.y === 'function' ? b.y() : b.y;
        for (let i = 0; i < b.n; i++) {
          const life = b.life * (0.5 + hash(i, b.seed + 1) * 0.8);
          if (dt > life) continue;
          const a = b.angle + (hash(i, b.seed + 2) - 0.5) * b.spread;
          const sp = b.speed * U * (0.35 + hash(i, b.seed + 3) * 0.9);
          const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp;
          const drag = Math.exp(-dt * 1.4);
          const x = ox + vx * (1 - drag) / 1.4, y = oy + vy * (1 - drag) / 1.4 + 0.5 * b.gravity * U * dt * dt;
          const vxx = vx * drag, vyy = vy * drag + b.gravity * U * dt;
          const fade = 1 - dt / life;
          const c = b.color;
          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(fade * 0.95).toFixed(3)})`;
          ctx.lineWidth = b.size * U * (0.6 + hash(i, b.seed + 4));
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - vxx * b.streak, y - vyy * b.streak); ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    };
  }, { z: 60 });

  // ---------- camera: shake + zoom punch on impacts ----------
  // The whole cam layer (every scene and its full-frame backgrounds) moves together, so a shaken cam must
  // always still cover the canvas: the stage behind it must never show as a bar at the frame edge.
  // Zoom is a smooth envelope of the impacts (punch + a share of the shake amplitude, no per-frame
  // zoom jitter); the per-frame shake (translate + rotate) is then scaled down on the frames where it
  // would not fit inside that zoom, so the cam edge always overhangs the canvas.
  const impacts = TL.events.filter(e => e.type === 'impact' || e.type === 'hit' || e.type === 'stamp')
    .map(e => ({ t: e.t, s: e.type === 'impact' ? e.strength : (e.type === 'hit' ? 1 : 0.7) }));
  FX.shakeScale = 1;  // scenes may damp it
  const HW = W / 2, HH = H / 2, HMIN = Math.min(HW, HH);
  const PAD = 2;          // px the cam edge must overhang the canvas (no anti-aliased seam)
  const ZOOM_SHAKE = 0.004;   // extra zoom per unit of shake amplitude (strength^2 envelope)
  // smallest zoom of the cam (about its centre, then rotated, then translated) that covers the canvas + pad
  function coverZoom(tx, ty, rotDeg, pad) {
    const r = rotDeg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    let z = 0;
    for (const [px, py] of [[-HW - pad, -HH - pad], [HW + pad, -HH - pad], [HW + pad, HH + pad], [-HW - pad, HH + pad]]) {
      const dx = px - tx, dy = py - ty;
      z = Math.max(z, Math.abs(c * dx + s * dy) / HW, Math.abs(-s * dx + c * dy) / HH);
    }
    return z;
  }
  // camera state at time t (pure function of t; k = FX.shakeScale): {x, y (px), r (deg), z}
  function camAt(t, k = 1) {
    let sx = 0, sy = 0, rot = 0, punch = 0, amp = 0;
    for (const im of impacts) {
      const dt = t - im.t;
      if (dt < 0 || dt > 0.8) continue;
      const a = im.s * im.s * Math.exp(-dt / 0.16);
      sx += noise1(dt * 38 + im.t, 1) * 7 * U * a;
      sy += noise1(dt * 38 + im.t, 2) * 7 * U * a;
      rot += noise1(dt * 30 + im.t, 3) * 0.25 * a;
      punch += 0.012 * im.s * Math.exp(-dt / 0.11);
      amp += a;
    }
    const z = 1 + k * (punch + ZOOM_SHAKE * amp);
    sx *= k; sy *= k; rot *= k;
    // overhang required: PAD, or less in the decaying tail (a centred zoom alone always satisfies it)
    const pad = Math.min(PAD, 0.5 * (z - 1) * HMIN);
    let q = 1;
    if (coverZoom(sx, sy, rot, pad) > z) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (coverZoom(sx * m, sy * m, rot * m, pad) <= z) lo = m; else hi = m; }
      q = lo;
    }
    return { x: sx * q, y: sy * q, r: rot * q, z };
  }
  FX.camAt = camAt;   // scenes use it e.g. to keep a word whole on screen on its (shaken) hit frame
  always.push((t) => {
    const c = camAt(t, FX.shakeScale);
    document.querySelector('.cam').style.transform = `translate(${c.x.toFixed(2)}px,${c.y.toFixed(2)}px) rotate(${c.r.toFixed(3)}deg) scale(${c.z.toFixed(5)})`;
  });

  // ---------- flash ----------
  const flashes = TL.events.filter(e => e.type === 'impact' && e.strength === 3).map(e => ({ t: e.t, a: 0.3, d: 0.07 }));
  FX.flash = (t, a = 0.5, d = 0.1, color) => flashes.push({ t, a, d, color });
  scene('flash', 0, 999, (L) => {
    L.style.mixBlendMode = 'screen';
    const f = el('div', 'fill', L, { background: '#fff7e0' });
    return (t) => {
      let a = 0;
      for (const fl of flashes) { const dt = t - fl.t; if (dt >= 0 && dt < 0.6) a = Math.max(a, fl.a * Math.exp(-dt / fl.d)); }
      f.style.opacity = a.toFixed(3);
    };
  }, { z: 900, overlay: true });

  // ---------- vignette + grain ----------
  scene('vignette', 0, 999, (L) => {
    el('div', 'fill', L, { background: 'radial-gradient(120% 90% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)' });
    return () => {};
  }, { z: 940, overlay: true });
  scene('grain', 0, 999, (L) => {
    L.style.mixBlendMode = 'overlay';   // blend the whole layer (it is its own stacking context)
    const cv = el('canvas', 'fill', L, { opacity: 0.6 });
    const gw = Math.ceil(W / 2), gh = Math.ceil(H / 2);
    cv.width = gw; cv.height = gh;
    const ctx = cv.getContext('2d');
    const tiles = [];
    for (let k = 0; k < 6; k++) {
      const img = ctx.createImageData(gw, gh);
      for (let i = 0; i < gw * gh; i++) { const v = (128 + (hash(i, k + 50) - 0.5) * 70) | 0; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
      tiles.push(img);
    }
    return (t) => { ctx.putImageData(tiles[Math.floor(t * 24) % 6], 0, 0); };
  }, { z: 950, overlay: true });
})();
