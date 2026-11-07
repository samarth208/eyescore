/* Shared helpers. Classic script (no modules) so the site also works from file:// and as an extension page. */
window.ES = window.ES || {};

(function (ES) {
  "use strict";

  /* ---------- DOM ---------- */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k === "dataset") Object.assign(el.dataset, v);
        else if (k === "html") el.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      }
    }
    appendChildren(el, children);
    return el;
  }
  function appendChildren(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }
  const $ = (s, r = document) => r.querySelector(s);

  /* ---------- timing ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  // Resolves after the current DOM changes have been painted, so reaction timers start at stimulus onset.
  const afterPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))));

  /* ---------- math ---------- */
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : NaN);
  function median(a) {
    if (!a.length) return NaN;
    const s = a.slice().sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  const geomean = (a) => (a.length ? Math.exp(mean(a.map(Math.log))) : NaN);
  function resample(a) {
    const out = new Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[Math.floor(Math.random() * a.length)];
    return out;
  }
  // Bootstrap probability that the geometric mean of `a` exceeds that of `b`.
  function bootstrapConf(a, b, B = 3000) {
    if (a.length < 2 || b.length < 2) return 0;
    const la = a.map(Math.log), lb = b.map(Math.log);
    let wins = 0;
    for (let i = 0; i < B; i++) {
      const d = mean(resample(la)) - mean(resample(lb));
      if (d > 0) wins += 1;
      else if (d === 0) wins += 0.5;
    }
    return wins / B;
  }

  /* One-sided permutation test on log speeds: p-value for "a is faster than b".
     Exact for small samples (all splits enumerated), Monte Carlo otherwise. Valid at n = 3-4 per group,
     where a bootstrap would be overconfident. */
  const comboCache = {};
  function combos(n, k) {
    const key = n + "," + k;
    if (comboCache[key]) return comboCache[key];
    const out = [], c = [];
    (function rec(start) {
      if (c.length === k) { out.push(c.slice()); return; }
      for (let i = start; i < n; i++) { c.push(i); rec(i + 1); c.pop(); }
    })(0);
    return (comboCache[key] = out);
  }
  function nChooseK(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }
  function permTestP(a, b) {
    if (a.length < 2 || b.length < 2) return 1;
    const all = a.map(Math.log).concat(b.map(Math.log));
    const n = all.length, k = a.length, total = sum(all);
    const obs = mean(all.slice(0, k)) - mean(all.slice(k)) - 1e-12;
    const diff = (idx) => { let sa = 0; for (const i of idx) sa += all[i]; return sa / k - (total - sa) / (n - k); };
    let ge = 0, count = 0;
    if (nChooseK(n, k) <= 5000) {
      for (const c of combos(n, k)) { count++; if (diff(c) >= obs) ge++; }
    } else {
      const idx = all.map((_, i) => i);
      for (let r = 0; r < 4000; r++) {
        for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
        count++; if (diff(idx.slice(0, k)) >= obs) ge++;
      }
    }
    return ge / count;
  }

  /* ---------- storage (best effort) ---------- */
  const store = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem("eyescore:" + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("eyescore:" + key, JSON.stringify(value)); } catch (e) { /* private mode etc. */ }
    },
    remove(key) {
      try { localStorage.removeItem("eyescore:" + key); } catch (e) { /* ignore */ }
    }
  };

  /* ---------- keyboard ---------- */
  let keyHandler = null;
  document.addEventListener("keydown", (e) => {
    if (!keyHandler || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const handled = keyHandler(e);
    if (handled) e.preventDefault();
  });
  const keys = {
    set(fn) { keyHandler = fn; },
    clear() { keyHandler = null; }
  };

  /* ---------- misc UI ---------- */
  let toastTimer = null;
  function toast(msg) {
    let t = $(".toast");
    if (!t) { t = h("div", { class: "toast", role: "status" }); document.body.appendChild(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = h("textarea", { style: { position: "fixed", opacity: "0" } });
      ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }
  const pct = (x, digits = 0) => (x * 100).toFixed(digits) + "%";

  /* ---------- adaptive staircase ----------
     Level is a positive quantity where smaller = harder (contrast, letter size, color difference).
     Starts in a fast 1-down/1-up phase until the first miss, then runs 2-down/1-up (converges near 71% correct). */
  class Staircase {
    constructor(o) {
      this.level = o.start;
      this.min = o.min; this.max = o.max;
      this.stepFast = o.stepFast || 0.6;
      this.step = o.step || 0.78;
      this.maxTrials = o.maxTrials || 24;
      this.maxReversals = o.maxReversals || 7;
      this.nDown = o.nDown || 2;
      this.phase = "fast";
      this.correctRun = 0;
      this.lastDir = 0;
      this.floorRun = 0;
      this.reversals = [];
      this.history = [];
    }
    get done() {
      return this.history.length >= this.maxTrials || this.reversals.length >= this.maxReversals || this.floorRun >= 4;
    }
    record(correct, actual) {
      const lvl = actual === undefined ? this.level : actual;
      this.history.push({ level: lvl, correct });
      if (correct && this.level <= this.min * 1.0001) this.floorRun++; else this.floorRun = 0;
      let dir = 0;
      if (this.phase === "fast") {
        if (correct) dir = -1; else { this.phase = "main"; dir = 1; }
      } else if (correct) {
        this.correctRun++;
        if (this.correctRun >= this.nDown) { dir = -1; this.correctRun = 0; }
      } else { this.correctRun = 0; dir = 1; }
      if (dir !== 0) {
        if (this.lastDir !== 0 && dir !== this.lastDir) this.reversals.push(lvl);
        this.lastDir = dir;
        const f = this.phase === "fast" ? this.stepFast : this.step;
        this.level = clamp(dir < 0 ? this.level * f : this.level / f, this.min, this.max);
      }
    }
    threshold() {
      const r = this.reversals.length >= 4 ? this.reversals.slice(2) : this.reversals;
      if (r.length >= 2) return geomean(r);
      const tail = this.history.slice(-6).map((t) => t.level);
      return tail.length ? geomean(tail) : this.level;
    }
  }

  /* ---------- environment ---------- */
  const isExtensionPage = !!(window.chrome && chrome.runtime && chrome.runtime.id && chrome.storage && location.protocol === "chrome-extension:");
  const isTouch = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);

  Object.assign(ES, {
    h, $, sleep, nextFrame, afterPaint, clamp, randInt, choice, shuffle, sum, mean, median, geomean,
    bootstrapConf, permTestP, store, keys, toast, copyText, pct, Staircase, isExtensionPage, isTouch
  });
})(window.ES);
