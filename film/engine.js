// Albion Journal film — deterministic motion engine.
// Every visual is a pure function of time t (seconds), so any frame can be rendered
// independently (parallel chunks, contact sheets) and all three formats share one timeline.
(function () {
  const Q = new URLSearchParams(location.search);
  const W = +(Q.get('w') || 1080), H = +(Q.get('h') || 1920);
  const FMT = H / W > 1.3 ? 'portrait' : (W / H > 1.3 ? 'landscape' : 'square');
  const U = Math.min(W, H) / 1080;
  const PROFILE = FMT === 'portrait' ? 'mobile' : (FMT === 'square' ? 'square' : 'desktop');

  // ---------- math ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    lin: x => x,
    inQ: x => x * x, outQ: x => 1 - (1 - x) * (1 - x),
    ioQ: x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2,
    inC: x => x * x * x, outC: x => 1 - Math.pow(1 - x, 3),
    ioC: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
    inE: x => x <= 0 ? 0 : Math.pow(2, 10 * x - 10),
    outE: x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x),
    ioE: x => x <= 0 ? 0 : x >= 1 ? 1 : x < .5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
    outB: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    outB2: x => { const c1 = 2.6, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    inB: x => { const c1 = 1.70158, c3 = c1 + 1; return c3 * x * x * x - c1 * x * x; },
    outEl: x => x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - .75) * (2 * Math.PI) / 3) + 1,
    outQuint: x => 1 - Math.pow(1 - x, 5),
  };
  // progress of t through [t0,t1] with easing
  const seg = (t, t0, t1, e = E.lin) => e(clamp((t - t0) / (t1 - t0)));
  // keyframes: [[t, v], [t, v, ease], ...] ease = easing of the segment that ENDS at that key
  function K(t, keys) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1], [t1, v1, e] = keys[i];
        const p = (e || E.ioC)(clamp((t - t0) / (t1 - t0)));
        return Array.isArray(v0) ? v0.map((x, j) => lerp(x, v1[j], p)) : lerp(v0, v1, p);
      }
    }
    return keys[keys.length - 1][1];
  }
  // damped spring step response, 0 -> 1 with overshoot. dt = seconds since start.
  function spring(dt, f = 2.4, z = 0.42) {
    if (dt <= 0) return 0;
    const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * dt) * (Math.cos(wd * dt) + (z * w / wd) * Math.sin(wd * dt));
  }
  // deterministic hash noise in [0,1)
  function hash(i, k = 0) {
    let n = (Math.imul(i | 0, 374761393) + Math.imul(k | 0, 668265263)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  // smooth value noise 1D
  function noise1(x, seed = 0) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lerp(hash(i, seed), hash(i + 1, seed), u) * 2 - 1;
  }

  // ---------- DOM ----------
  function el(tag, cls, parent, style, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) Object.assign(e.style, style);
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  // set transform/opacity/filter in one call. Coordinates in px.
  function tf(e, o) {
    const x = o.x || 0, y = o.y || 0, s = o.s == null ? 1 : o.s;
    let t = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`;
    if (o.rx || o.ry) t = `perspective(${o.persp || 1600}px) ` + t + ` rotateX(${(o.rx || 0).toFixed(3)}deg) rotateY(${(o.ry || 0).toFixed(3)}deg)`;
    if (o.r) t += ` rotate(${o.r.toFixed(3)}deg)`;
    if (o.sx != null || o.sy != null) t += ` scale(${((o.sx == null ? 1 : o.sx) * s).toFixed(4)},${((o.sy == null ? 1 : o.sy) * s).toFixed(4)})`;
    else if (s !== 1) t += ` scale(${s.toFixed(4)})`;
    e.style.transform = t;
    if (o.o != null) e.style.opacity = clamp(o.o).toFixed(3);
    if (o.blur != null || o.bright != null || o.filter != null) {
      let f = '';
      if (o.blur) f += `blur(${o.blur.toFixed(2)}px) `;
      if (o.bright != null && o.bright !== 1) f += `brightness(${o.bright.toFixed(3)}) `;
      if (o.filter) f += o.filter;
      e.style.filter = f || 'none';
    }
  }
  const show = (e, v) => { e.style.visibility = v ? 'visible' : 'hidden'; };

  // directional motion-blur SVG filters (created on demand, driven per frame)
  const svgNS = 'http://www.w3.org/2000/svg';
  let svgDefs = null, mbCount = 0;
  function motionBlur() {
    if (!svgDefs) {
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('width', 0); svg.setAttribute('height', 0);
      svg.style.position = 'absolute';
      svgDefs = document.createElementNS(svgNS, 'defs');
      svg.appendChild(svgDefs); document.body.appendChild(svg);
    }
    const id = 'mb' + (mbCount++);
    const f = document.createElementNS(svgNS, 'filter');
    f.setAttribute('id', id); f.setAttribute('x', '-50%'); f.setAttribute('y', '-50%');
    f.setAttribute('width', '200%'); f.setAttribute('height', '200%');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    const g = document.createElementNS(svgNS, 'feGaussianBlur');
    g.setAttribute('stdDeviation', '0 0');
    f.appendChild(g); svgDefs.appendChild(f);
    return { url: `url(#${id})`, set(bx, by) { g.setAttribute('stdDeviation', `${Math.max(0, bx).toFixed(2)} ${Math.max(0, by).toFixed(2)}`); } };
  }

  // ---------- timeline data ----------
  const TL = window.TIMELINE;
  const BEAT = TL.beat, BAR = TL.bar;
  const evs = (type, note) => TL.events.filter(e => e.type === type && (!note || (e.note || '').includes(note)));

  // ---------- scene registry ----------
  const scenes = [];
  let stage, cam, overlay;
  function scene(id, t0, t1, build, opts = {}) { scenes.push({ id, t0, t1, build, layer: null, update: null, z: opts.z || 0, overlay: !!opts.overlay }); }
  const always = [];   // per-frame updaters active the whole film (camera, flashes, grain...)

  function init() {
    stage = document.getElementById('stage');
    stage.style.width = W + 'px'; stage.style.height = H + 'px';
    cam = el('div', 'cam', stage);
    overlay = el('div', 'overlay', stage);
    scenes.sort((a, b) => a.z - b.z);
    for (const s of scenes) {
      s.layer = el('div', 'layer', s.overlay ? overlay : cam, { zIndex: s.z });
      s.layer.dataset.scene = s.id;
      s.update = s.build(s.layer, s) || (() => {});
      s.layer.style.display = 'none';
    }
  }

  let curT = -1;
  function renderFrame(t) {
    curT = t;
    for (const s of scenes) {
      const on = t >= s.t0 && t < s.t1;
      s.layer.style.display = on ? '' : 'none';
      if (on) s.update(t, t - s.t0, (t - s.t0) / (s.t1 - s.t0));
    }
    for (const f of always) f(t);
  }

  window.FX = { W, H, FMT, U, PROFILE, E, K, seg, spring, clamp, lerp, hash, noise1, el, tf, show, motionBlur,
    TL, BEAT, BAR, evs, scene, always, init, renderFrame, get t() { return curT; },
    P: FMT === 'portrait', L: FMT === 'landscape', S: FMT === 'square' };
})();
