/* EyeScore tests. Every test follows the same rules:
     - nothing flashes and nothing is timed: the target stays until you answer
     - one thing changes with your answers (a staircase) until it finds your limit
     - single, simple targets (a tumbling E, four tiles), so there's nothing to remember
   size     : tumbling E that shrinks/grows (two interleaved staircases, for a built-in retest)
   contrast : tumbling E that fades/darkens at reading size, spatially dithered for fine steps
   color    : four tiles, one differs only in color, along the protan / deutan / tritan lines
   dim      : pick a comfortable page brightness (preference, used by the night check) */
(function (ES) {
  "use strict";
  const { h, keys, sleep, shuffle, choice, clamp, Staircase, geomean } = ES;

  /* ---------- shared ---------- */
  const DIRS = ["up", "down", "left", "right"];
  const ARROWS = { up: "↑", down: "↓", left: "←", right: "→" };
  const KEYMAP = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  // E made of 5×5 units; the arms point in the named direction.
  const E_RECTS = {
    right: [[0, 0, 1, 5], [0, 0, 5, 1], [0, 2, 5, 1], [0, 4, 5, 1]],
    left: [[4, 0, 1, 5], [0, 0, 5, 1], [0, 2, 5, 1], [0, 4, 5, 1]],
    up: [[0, 4, 5, 1], [0, 0, 1, 5], [2, 0, 1, 5], [4, 0, 1, 5]],
    down: [[0, 0, 5, 1], [0, 0, 1, 5], [2, 0, 1, 5], [4, 0, 1, 5]]
  };
  const srgbEncode = (y) => (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
  const srgbDecode = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const dec8 = (g) => srgbDecode(g / 255);

  function shell(root, { eyebrow, title, hint, extraClass }) {
    const count = h("span", { class: "trial-count" });
    const feedback = h("div", { class: "feedback", "aria-live": "polite" });
    const stage = h("div", { class: "stage " + (extraClass || "") }, feedback);
    const controls = h("div", { class: "row center", style: { marginTop: "16px" } });
    root.replaceChildren(h("div", { class: "card" },
      h("div", { class: "eyebrow" }, eyebrow),
      h("div", { class: "test-head" }, h("h2", null, title), count),
      stage,
      hint ? h("p", { class: "small muted center", style: { margin: "12px 0 0" } }, hint) : null,
      controls));
    const flash = async (ok, text) => {
      feedback.className = "feedback " + (ok ? "ok" : "no");
      feedback.textContent = text || (ok ? "✓" : "✗");
      await sleep(320);
      feedback.textContent = "";
    };
    return { stage, count, feedback, controls, flash };
  }

  function arrowPad(onAnswer, cantLabel) {
    const pad = h("div", { class: "arrow-pad" }, DIRS.map((d) => h("button", { class: "btn " + d, "aria-label": d, onclick: () => onAnswer(d) }, ARROWS[d])));
    const cant = h("button", { class: "btn btn-ghost", onclick: () => onAnswer(null) }, cantLabel || "I can't see it", ES.isTouch ? null : [" ", h("span", { class: "kbd" }, "N")]);
    return h("div", { class: "stack center-stack" }, pad, cant);
  }

  /* Canvas sized in CSS px, drawn in device pixels. */
  function makeCanvas(cssSize) {
    const dpr = window.devicePixelRatio || 1;
    const c = h("canvas", { "aria-label": "Letter E" });
    const W = Math.round(cssSize * dpr);
    c.width = W; c.height = W;
    c.style.width = cssSize + "px"; c.style.height = cssSize + "px";
    return { c, W, dpr };
  }

  /* ---------- size: tumbling E, anti-aliased, down to half a device pixel per stroke ---------- */
  function drawSizeE(cv, heightDev, dir) {
    const g = cv.c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, cv.W, cv.W);
    if (!dir) return;
    const u = heightDev / 5, x0 = (cv.W - heightDev) / 2, y0 = (cv.W - heightDev) / 2;
    g.fillStyle = "#000000";
    for (const [rx, ry, rw, rh] of E_RECTS[dir]) g.fillRect(x0 + rx * u, y0 + ry * u, rw * u, rh * u);
  }

  /* Two interleaved staircases (one starting large, one starting near a typical limit). Their
     agreement is a built-in retest: if they differ by more than 0.2 log units the result is flagged.
     Resolves { thresholdCss, thresholdsCss:[a,b], spreadLog, floorHit, trials }. */
  function sizeTest(root, ctx, opts = {}) {
    return new Promise((resolve) => {
      const ui = shell(root, {
        eyebrow: opts.eyebrow || "Text size",
        title: opts.title || "Which way is the E pointing?",
        hint: ES.isTouch ? "Tap the arrow that matches the E's arms. Guess if you're not sure." : "Arrow keys or buttons. Take your time; it waits for you. Guess if you're not sure."
      });
      const cv = makeCanvas(240);
      ui.stage.appendChild(cv.c);
      const dpr = cv.dpr;
      const MIN_DEV = 2.5;                    // half a device pixel per stroke
      const MAX_DEV = 200 * dpr;
      const mk = (startCss) => new Staircase({ start: clamp(startCss * dpr, MIN_DEV, MAX_DEV), min: MIN_DEV, max: MAX_DEV, stepFast: 0.6, step: 0.79, maxTrials: 16, maxReversals: 7 });
      const sc = [mk(opts.startCss || 30), mk(opts.startLowCss || 5)];
      let cur = null, busy = false, n = 0;
      const total = 32;
      function next() {
        const live = sc.map((s, i) => i).filter((i) => !sc[i].done);
        if (!live.length) {
          keys.clear();
          drawSizeE(cv, 0, null);
          const th = sc.map((s) => s.threshold() / dpr);
          const floorHit = sc.some((s) => s.floorRun >= 4) || th.some((t) => t * dpr <= MIN_DEV * 1.05);
          resolve({ thresholdCss: geomean(th), thresholdsCss: th, spreadLog: Math.abs(Math.log10(th[0] / th[1])), floorHit, trials: n });
          return;
        }
        const i = choice(live);
        const dir = choice(DIRS);
        cur = { i, dir, level: sc[i].level };
        drawSizeE(cv, cur.level, dir);
        ui.count.textContent = `${n + 1}`;
        ctx.progress(Math.min(0.97, n / total));
        busy = false;
      }
      async function answer(d) {
        if (busy || !cur) return;
        busy = true;
        const ok = d === cur.dir;
        sc[cur.i].record(ok, cur.level);
        n++;
        drawSizeE(cv, 0, null);
        await ui.flash(ok);
        await sleep(120);
        next();
      }
      ui.controls.appendChild(arrowPad(answer));
      keys.set((e) => {
        if (KEYMAP[e.key]) { answer(KEYMAP[e.key]); return true; }
        if (e.key === "n" || e.key === "N") { answer(null); return true; }
        return false;
      });
      next();
    });
  }

  /* ---------- contrast: dithered fading E ----------
     An 8-bit screen has only a few gray levels where good eyes work (about 0.9%, 1.8%, 2.7%, 3.5%
     contrast on white), so the E mixes two neighboring gray levels in a 4×4 pattern for 16× finer
     steps (FrACT does the same with a 3×3 pattern). Weber contrast is recorded as actually drawn.
     polarity "light": dark E on white. "dark": light E on #1a1a1a (the dark-mode background). */
  const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const DARK_BG = 26;                          // #1a1a1a, what the extension's dark mode makes of white
  function contrastLevels(c, polarity) {
    if (polarity === "dark") {
      const Yb = dec8(DARK_BG), Yt = Yb * (1 + c);
      let lo = Math.max(DARK_BG, Math.floor(srgbEncode(Yt) * 255));
      while (lo < 254 && dec8(lo + 1) <= Yt) lo++;
      const hi = Math.min(255, lo + 1);
      const f = clamp((Yt - dec8(lo)) / (dec8(hi) - dec8(lo)), 0, 1);
      const n = Math.round(f * 16);
      const Yavg = dec8(lo) + (n / 16) * (dec8(hi) - dec8(lo));
      return { bg: DARK_BG, base: lo, alt: hi, n, actual: (Yavg - Yb) / Yb };
    }
    const Yt = 1 - c;
    let hi = Math.min(255, Math.ceil(srgbEncode(Yt) * 255));
    while (hi > 1 && dec8(hi - 1) >= Yt) hi--;
    const lo = Math.max(0, hi - 1);
    const f = hi === lo ? 0 : clamp((dec8(hi) - Yt) / (dec8(hi) - dec8(lo)), 0, 1);
    const n = Math.round(f * 16);
    const Yavg = dec8(hi) - (n / 16) * (dec8(hi) - dec8(lo));
    return { bg: 255, base: hi, alt: lo, n, actual: 1 - Yavg };
  }
  function drawContrastE(cv, unitDev, dir, lv) {
    const g = cv.c.getContext("2d");
    const img = g.createImageData(cv.W, cv.W);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = lv.bg; d[i + 3] = 255; }
    if (dir) {
      const s = 5 * unitDev, x0 = Math.round((cv.W - s) / 2), y0 = Math.round((cv.W - s) / 2);
      for (const [rx, ry, rw, rh] of E_RECTS[dir]) {
        for (let y = y0 + ry * unitDev; y < y0 + (ry + rh) * unitDev; y++) {
          for (let x = x0 + rx * unitDev; x < x0 + (rx + rw) * unitDev; x++) {
            const v = BAYER4[y & 3][x & 3] < lv.n ? lv.alt : lv.base;
            const k = (y * cv.W + x) * 4;
            d[k] = d[k + 1] = d[k + 2] = v;
          }
        }
      }
    }
    g.putImageData(img, 0, 0);
  }
  /* opts: { xHeightCss, polarity, dim, staircases (1 or 2), eyebrow, title }.
     Resolves { threshold, thresholds, logCS, spreadLog, unitDev, heightCss, polarity, dim }. */
  function contrastTest(root, ctx, opts = {}) {
    return new Promise((resolve) => {
      const polarity = opts.polarity || "light";
      const ui = shell(root, {
        eyebrow: opts.eyebrow || "Contrast",
        title: opts.title || "Which way is the faint E pointing?",
        hint: "It gets fainter when you're right and darker when you miss. It waits for you; guess if you're not sure."
      });
      // Big enough for the E plus a margin: people who need large text get a large E (it used to be clipped
      // above about 150px).
      const cv = makeCanvas(Math.max(160, Math.ceil(Math.max(4, opts.xHeightCss || 8.3) * 1.6)));
      if (polarity === "dark") ui.stage.style.background = `rgb(${DARK_BG},${DARK_BG},${DARK_BG})`;
      if (opts.dim && opts.dim < 1) ui.stage.style.filter = `brightness(${opts.dim})`;
      ui.stage.appendChild(cv.c);
      const heightCss = Math.max(4, opts.xHeightCss || 8.3);
      const unitDev = Math.max(1, Math.round(heightCss * cv.dpr / 5));
      const nSc = opts.staircases || 1;
      // Weber contrast is the staircase variable. A dark E on white tops out at 0.95 (black); a light E on the
      // dark background can go far higher, so its ceiling is set to 19, the same easiest level as light mode
      // in Michelson terms (0.95 → 0.90 and 19 → 0.90). Near threshold the two scales agree.
      const MAXC = polarity === "dark" ? 19 : 0.95;
      const mk = (start) => new Staircase({ start, min: 0.0015, max: MAXC, stepFast: 0.55, step: 0.75, maxTrials: nSc > 1 ? 18 : 26, maxReversals: 7 });
      const sc = nSc > 1 ? [mk(0.3), mk(0.06)] : [mk(0.3)];
      let cur = null, busy = false, n = 0;
      const total = nSc > 1 ? 36 : 26;
      function next() {
        const live = sc.map((s, i) => i).filter((i) => !sc[i].done);
        if (!live.length) {
          keys.clear();
          const th = sc.map((s) => s.threshold());
          const t = geomean(th);
          // Ceiling: the staircase ended near its easiest level, so the real limit may be even higher.
          const ceiling = th.some((x) => x >= 0.8 * MAXC);
          resolve({ threshold: t, thresholds: th, logCS: -Math.log10(t), spreadLog: th.length > 1 ? Math.abs(Math.log10(th[0] / th[1])) : null, unitDev, heightCss: 5 * unitDev / cv.dpr, polarity, dim: opts.dim || 1, trials: n, max: MAXC, ceiling });
          return;
        }
        const i = choice(live);
        const lv = contrastLevels(sc[i].level, polarity);
        const dir = choice(DIRS);
        cur = { i, dir, actual: Math.max(1e-4, lv.actual) };
        drawContrastE(cv, unitDev, dir, lv);
        ui.count.textContent = `${n + 1}`;
        ctx.progress(Math.min(0.97, n / total));
        busy = false;
      }
      async function answer(d) {
        if (busy || !cur) return;
        busy = true;
        const ok = d === cur.dir;
        sc[cur.i].record(ok, cur.actual);
        n++;
        drawContrastE(cv, unitDev, null, contrastLevels(0, polarity));
        await ui.flash(ok);
        await sleep(120);
        next();
      }
      ui.controls.appendChild(arrowPad(answer));
      keys.set((e) => {
        if (KEYMAP[e.key]) { answer(KEYMAP[e.key]); return true; }
        if (e.key === "n" || e.key === "N") { answer(null); return true; }
        return false;
      });
      next();
    });
  }

  /* ---------- color: four tiles, untimed (Cambridge Colour Test logic) ----------
     One tile differs from the others only in chromaticity, along a protan, deutan or tritan
     confusion line through D65 in CIE u'v'. Tile brightness is jittered so brightness can't give the
     answer. Three interleaved staircases, one per line. */
  const WHITE = [0.1978, 0.4683];
  const COPUNCTAL = { protan: [0.678, 0.501], deutan: [-1.217, 0.782], tritan: [0.257, 0.0] };
  const Y_BG = 0.3;
  function uvYToLin(u, v, Y) {
    const X = Y * 9 * u / (4 * v), Z = Y * (12 - 3 * u - 20 * v) / (4 * v);
    return [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z];
  }
  const inGamut = (lin) => lin.every((c) => c >= 0 && c <= 1);
  const toCss = (lin) => `rgb(${lin.map((c) => Math.round(255 * srgbEncode(clamp(c, 0, 1)))).join(",")})`;
  function axisDir(axis) {
    const [cu, cv] = COPUNCTAL[axis];
    const du = cu - WHITE[0], dv = cv - WHITE[1], m = Math.hypot(du, dv);
    return [du / m, dv / m];
  }
  function maxInGamut(axis, sign) {
    const [du, dv] = axisDir(axis);
    let lo = 0, hi = 0.15;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const ok = [0.82, 1.18].every((f) => inGamut(uvYToLin(WHITE[0] + sign * mid * du, WHITE[1] + sign * mid * dv, Y_BG * f)));
      if (ok) lo = mid; else hi = mid;
    }
    return lo;
  }
  function colorTest(root, ctx, opts = {}) {
    return new Promise((resolve) => {
      const ui = shell(root, { eyebrow: opts.eyebrow || "Color", title: "Which tile is a different color?", hint: "Brightness varies on purpose; look for the color. It waits for you. If you can't see a difference, say so." });
      const grid = h("div", { class: "tiles tiles-4" });
      ui.stage.appendChild(grid);
      const axes = ["protan", "deutan", "tritan"];
      const caps = Object.fromEntries(axes.map((a) => [a, Math.min(maxInGamut(a, 1), maxInGamut(a, -1), 0.08)]));
      const sc = Object.fromEntries(axes.map((a) => [a, new Staircase({ start: Math.min(0.04, caps[a]), min: 0.0015, max: caps[a], stepFast: 0.6, step: 0.75, maxTrials: 14, maxReversals: 6 })]));
      let queue = [], odd = -1, busy = true, cur = null, n = 0;
      const total = axes.length * 14;
      const refill = () => { queue = shuffle(axes.filter((a) => !sc[a].done)); };
      function next() {
        if (!queue.length) refill();
        if (!queue.length) {
          keys.clear();
          grid.replaceChildren();
          resolve({
            thresholds: Object.fromEntries(axes.map((a) => [a, sc[a].threshold()])), caps,
            atCap: Object.fromEntries(axes.map((a) => [a, sc[a].history.slice(-4).length === 4 && sc[a].history.slice(-4).every((t) => t.level >= caps[a] * 0.98 && !t.correct)])),
            trials: n
          });
          return;
        }
        const axis = queue.shift();
        const d = sc[axis].level, sign = Math.random() < 0.5 ? -1 : 1;
        const [du, dv] = axisDir(axis);
        odd = Math.floor(Math.random() * 4);
        cur = { axis, d };
        grid.replaceChildren(...Array.from({ length: 4 }, (_, i) => {
          const Y = Y_BG * (0.85 + Math.random() * 0.3);
          const lin = i === odd ? uvYToLin(WHITE[0] + sign * d * du, WHITE[1] + sign * d * dv, Y) : uvYToLin(WHITE[0], WHITE[1], Y);
          return h("button", { class: "tile", "aria-label": "Tile " + (i + 1), style: { background: toCss(lin) }, onclick: () => pick(i) },
            ES.isTouch ? null : h("span", { class: "tile-num" }, String(i + 1)));
        }));
        ui.count.textContent = `${n + 1}`;
        ctx.progress(Math.min(0.97, n / total));
        busy = false;
      }
      async function pick(i) {
        if (busy) return;
        busy = true;
        const ok = i === odd;
        sc[cur.axis].record(ok, cur.d);
        n++;
        if (!ok && grid.children[odd]) grid.children[odd].classList.add("tile-answer");
        await ui.flash(ok, i === -1 ? "It was this one" : null);
        await sleep(ok ? 100 : 500);
        next();
      }
      ui.controls.appendChild(h("button", { class: "btn btn-ghost", onclick: () => pick(-1) }, "I can't see a difference", ES.isTouch ? null : [" ", h("span", { class: "kbd" }, "N")]));
      keys.set((e) => {
        if (["1", "2", "3", "4"].includes(e.key)) { pick(+e.key - 1); return true; }
        if (e.key === "n" || e.key === "N") { pick(-1); return true; }
        return false;
      });
      next();
    });
  }

  /* ---------- dim picker (night check) ---------- */
  const DIM_LEVELS = [1, 0.85, 0.7, 0.55, 0.4];
  function dimPicker(root, opts = {}) {
    return new Promise((resolve) => {
      let i = 0;
      const sample = h("div", { class: "dim-sample" },
        h("p", null, "The library on Grove Street opens at nine. On Saturdays there is a reading hour for children, and the staff put out new books by the front window."),
        h("p", { class: "rx-gray" }, "Posted 3 hours ago · 4 min read"));
      const label = h("strong");
      const btns = DIM_LEVELS.map((v, k) => h("button", { class: "btn btn-small seg-btn", onclick: () => { i = k; sync(); } }, Math.round(v * 100) + "%"));
      function sync() { sample.style.filter = `brightness(${DIM_LEVELS[i]})`; label.textContent = Math.round(DIM_LEVELS[i] * 100) + "%"; btns.forEach((b, k) => b.classList.toggle("on", k === i)); }
      const done = () => { keys.clear(); resolve(DIM_LEVELS[i]); };
      root.replaceChildren(h("div", { class: "card narrow" },
        h("div", { class: "eyebrow" }, opts.eyebrow || "Night check · 1 of 3"),
        h("h2", null, "Pick a comfortable page brightness"),
        h("p", { class: "muted" }, "Your screen stays at full brightness; this dims only the page. Pick the brightest level that feels comfortable in this room right now. The next two steps check that text is still easy to see at that level."),
        sample,
        h("div", { class: "row center", style: { margin: "14px 0" } }, btns),
        h("p", { class: "small center" }, "Page brightness: ", label),
        h("div", { class: "row end" }, h("button", { class: "btn btn-primary", onclick: done }, "Use this level"))));
      keys.set((e) => {
        if (e.key === "ArrowLeft") { i = Math.max(0, i - 1); sync(); return true; }
        if (e.key === "ArrowRight") { i = Math.min(DIM_LEVELS.length - 1, i + 1); sync(); return true; }
        if (e.key === "Enter") { done(); return true; }
        return false;
      });
      sync();
    });
  }

  ES.tests = { sizeTest, contrastTest, colorTest, dimPicker, contrastLevels, DIM_LEVELS, DARK_BG, srgbEncode, srgbDecode, uvYToLin, WHITE, COPUNCTAL };
})(window.ES);
