// Shared film components: text blocks, the real pixel logos, cursor, UI page viewer.
(function () {
  const { W, H, U, E, K, seg, spring, clamp, lerp, hash, el, tf, PROFILE } = FX;

  // text block, measured from the DOM (fonts are loaded before build)
  function text(parent, str, size, cls = 'px', style = {}) {
    const e = el('div', 'abs ' + cls, parent, Object.assign({ fontSize: size + 'px' }, style));
    e.textContent = str;
    const w = e.offsetWidth, h = e.offsetHeight;
    return { e, w, h, size, place(cx, cy) { e.style.left = (cx - w / 2) + 'px'; e.style.top = (cy - h / 2) + 'px'; this.cx = cx; this.cy = cy; return this; } };
  }
  const mctx = document.createElement('canvas').getContext('2d');
  function measure(str, size, font = "'Pixelify Sans'", weight = 600) { mctx.font = `${weight} ${size}px ${font}`; return mctx.measureText(str).width; }
  // largest font size so that str fits maxW (and size <= maxSize)
  function fit(str, maxW, maxSize, font, weight) { return Math.min(maxSize, maxW * 100 / measure(str, 100, font, weight)); }

  // ---------- the real anvil mark (code from the site, see vendor/albion_logo.js) ----------
  AJLogo.setIdleHits([], 1e12);           // idle strikes off: the film strikes on the beat instead
  const ANV = AJLogo.anvilUnpack(AJLogo.ANVIL_BODY);
  function Anvil(parent, scale) {
    const cv = el('canvas', 'abs pixelated', parent);
    cv.width = ANV.w; cv.height = ANV.h;
    cv.style.width = ANV.w * scale + 'px'; cv.style.height = ANV.h * scale + 'px';
    const ctx = cv.getContext('2d');
    return {
      cv, scale, w: ANV.w * scale, h: ANV.h * scale, core: ANV.core,
      // body is 44x36 starting at row ANVIL_DY; centre of the body in canvas px:
      bodyCenter: [22, AJLogo.ANVIL_DY + 18],
      place(cx, cy) { // cx,cy = centre of the anvil BODY on screen
        this.x = cx - 22 * scale; this.y = cy - (AJLogo.ANVIL_DY + 18) * scale;
        cv.style.left = this.x + 'px'; cv.style.top = this.y + 'px'; return this;
      },
      draw(t, strikes = []) {
        let last = null;
        for (const s of strikes) if (t >= s - 0.16 && t < s + 1.3) last = s;
        AJLogo.setClick(last == null ? null : last * 1000 - 150);
        AJLogo.anvilDraw(t * 1000, ctx, ANV);
      },
      pixelScreen(i) { const [x, y] = ANV.core[i]; return [this.x + (x + 0.5) * scale, this.y + (y + 0.5) * scale]; },
    };
  }
  // ---------- the real hooded-hare mark (site header logo) ----------
  const HARE = AJLogo.logoUnpack(AJLogo.LOGO_BIG, 1);
  function Hare(parent, scale) {
    const cv = el('canvas', 'abs pixelated', parent);
    cv.width = HARE.w; cv.height = HARE.h;
    cv.style.width = HARE.w * scale + 'px'; cv.style.height = HARE.h * scale + 'px';
    const ctx = cv.getContext('2d');
    return { cv, w: HARE.w * scale, h: HARE.h * scale,
      place(cx, cy) { cv.style.left = (cx - HARE.w * scale / 2) + 'px'; cv.style.top = (cy - HARE.h * scale / 2) + 'px'; return this; },
      draw(t) { AJLogo.logoDraw(t * 1000, ctx, HARE); } };
  }

  // ---------- cursor ----------
  function Cursor(parent, size = 56 * U) {
    const wrap = el('div', 'abs', parent, { width: '0px', height: '0px', zIndex: 80 });
    const ring = el('div', 'abs', wrap, { width: 2 * size + 'px', height: 2 * size + 'px', left: -size + 'px', top: -size + 'px', borderRadius: '50%', border: `${3 * U}px solid #f5d47e`, boxShadow: '0 0 24px rgba(238,188,78,.6)' });
    const ring2 = el('div', 'abs', wrap, { width: 2 * size + 'px', height: 2 * size + 'px', left: -size + 'px', top: -size + 'px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(245,212,126,.45) 0%, rgba(245,212,126,0) 60%)' });
    const arrow = el('div', 'abs', wrap, { left: (-3 / 24 * size) + 'px', top: (-2 / 24 * size) + 'px', transformOrigin: `${3 / 24 * size}px ${2 / 24 * size}px`, filter: 'drop-shadow(0 6px 10px rgba(0,0,0,.55))' },
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="M3 2 L3 19.2 L7.6 15 L10.7 21.8 L13.8 20.4 L10.8 13.8 L17 13.8 Z" fill="#ffffff" stroke="#0b0d12" stroke-width="1.3" stroke-linejoin="round"/></svg>`);
    return {
      wrap,
      // clicks: array of film times; x,y = tip position on screen
      set(t, x, y, clicks = [], o = 1) {
        wrap.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
        wrap.style.opacity = o.toFixed(3);
        let press = 0, rp = -1;
        for (const c of clicks) {
          const dt = t - c;
          if (dt > -0.08 && dt < 0.12) press = Math.max(press, 1 - Math.abs(dt + 0.0) / 0.12);
          if (dt >= 0 && dt < 0.5) rp = dt / 0.5;
        }
        arrow.style.transform = `scale(${(1 - 0.18 * press).toFixed(3)})`;
        if (rp >= 0) { const s = 0.2 + 0.9 * E.outC(rp); ring.style.transform = `scale(${s})`; ring.style.opacity = (1 - rp).toFixed(3); ring2.style.transform = `scale(${s * 0.9})`; ring2.style.opacity = (1 - rp).toFixed(3); }
        else { ring.style.opacity = 0; ring2.style.opacity = 0; }
      },
    };
  }
  // smooth cursor path through waypoints [[t,x,y],...] (ease in-out between, slight arc)
  function cursorPath(t, pts) {
    if (t <= pts[0][0]) return [pts[0][1], pts[0][2]];
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i][0]) {
        const [t0, x0, y0] = pts[i - 1], [t1, x1, y1] = pts[i];
        const p = E.ioC(clamp((t - t0) / (t1 - t0)));
        const arc = Math.sin(p * Math.PI) * Math.min(80 * U, Math.hypot(x1 - x0, y1 - y0) * 0.12);
        return [lerp(x0, x1, p) + arc * 0.6, lerp(y0, y1, p) - arc];
      }
    }
    const l = pts[pts.length - 1]; return [l[1], l[2]];
  }

  // ---------- UI page viewer: real screenshots, camera in page (CSS px) coordinates ----------
  const MAN = (window.MANIFEST || {})[PROFILE] || { states: {}, viewport: { width: 1440, height: 900, dpr: 2 } };
  const VP = MAN.viewport;
  function stateInfo(name) { return MAN.states[name]; }
  function PageView(parent, box, opts = {}) {
    // box: {x,y,w,h} frame on screen
    const frame = el('div', 'abs', parent, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px', overflow: 'hidden', borderRadius: (opts.radius == null ? 28 * U : opts.radius) + 'px', background: '#0b0d12', boxShadow: '0 40px 120px rgba(0,0,0,.65), 0 0 0 1px rgba(51,60,85,.9)' });
    const inner = el('div', 'abs', frame, { transformOrigin: '0 0' });
    const imgs = {};
    const view = {
      frame, inner, box, cam: { cx: VP.width / 2, cy: VP.height / 2, z: box.w / VP.width },
      add(name) {
        if (imgs[name]) return imgs[name];
        const st = stateInfo(name); if (!st) { console.warn('missing state', name); return null; }
        const w = st.fullPage ? st.page[0] : VP.width, h = st.fullPage ? st.page[1] : VP.height;
        const im = el('img', 'ui', inner, { left: '0px', top: '0px', width: w + 'px', height: h + 'px', opacity: 0 });
        im.src = st.img; im.dataset.h = h;
        imgs[name] = im; return im;
      },
      // opacity per state: {name: o}
      show(map) { for (const k in imgs) imgs[k].style.opacity = (map[k] || 0).toFixed(3); },
      setCam(cx, cy, z) {
        this.cam = { cx, cy, z };
        inner.style.transform = `translate(${(box.w / 2 - cx * z).toFixed(2)}px,${(box.h / 2 - cy * z).toFixed(2)}px) scale(${z.toFixed(5)})`;
      },
      toScreen(px, py) { const c = this.cam; return [box.x + box.w / 2 + (px - c.cx) * c.z, box.y + box.h / 2 + (py - c.cy) * c.z]; },
      rect(name, key, i = 0) { const st = stateInfo(name); const r = st && st.rects && st.rects[key] && st.rects[key][i]; return r || null; },
      center(name, key, i = 0) { const r = this.rect(name, key, i); return r ? [r[0] + r[2] / 2, r[1] + r[3] / 2] : [VP.width / 2, VP.height / 2]; },
    };
    for (const n of (opts.states || [])) view.add(n);
    return view;
  }

  // gold kinetic label with underline (callouts over UI)
  function Callout(parent, str, size = 40 * U) {
    const wrap = el('div', 'abs', parent, { zIndex: 70 });
    const tag = el('div', 'px', wrap, { fontSize: size + 'px', color: '#0b0d12', background: '#eebc4e', padding: `${0.18 * size}px ${0.42 * size}px ${0.12 * size}px`, borderRadius: `${0.18 * size}px`, boxShadow: '0 10px 30px rgba(0,0,0,.5), 0 0 30px rgba(238,188,78,.35)', whiteSpace: 'nowrap' });
    tag.textContent = str;
    const w = tag.offsetWidth, h = tag.offsetHeight;
    return { wrap, w, h, set(t, t0, t1, x, y) {
      const a = spring(t - t0, 3.2, 0.5), b = seg(t, t1 - 0.2, t1, E.inC);
      wrap.style.left = (x - w / 2) + 'px'; wrap.style.top = (y - h / 2) + 'px';
      tf(wrap, { y: (1 - a) * 30 * U, s: 0.6 + 0.4 * a - 0.2 * b, o: (t < t0 ? 0 : 1) * (1 - b) });
    } };
  }

  FX.lib = { text, measure, fit, Anvil, Hare, Cursor, cursorPath, PageView, stateInfo, VP, Callout };
})();
