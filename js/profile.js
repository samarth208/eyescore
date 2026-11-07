/* Screen prescription (profile): save it and hand it to the extension. ES.rx.build makes it.
   - As an extension page (chrome-extension://…/site/index.html): reads/writes chrome.storage.local directly.
   - As a normal website: posts messages to the page; the extension's content script (running only on
     allowed EyeScore origins) picks them up and stores them. A copyable profile code is the fallback. */
(function (ES) {
  "use strict";
  const { store } = ES;
  const CODE_PREFIX = "ES1:";

  let extPresent = false;
  const listeners = [];
  const pendingSaves = new Map();          // request id → resolve
  let nextId = 1;

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "eyescore-ext") return;
    if (e.data.type === "HELLO" || e.data.type === "PONG") {
      if (!extPresent) { extPresent = true; listeners.forEach((fn) => fn(true)); }
    }
    if (e.data.type === "SAVED" || e.data.type === "SAVE_FAILED") {
      const done = pendingSaves.get(e.data.id);
      if (done) { pendingSaves.delete(e.data.id); done(e.data.type === "SAVED"); }
    }
  });

  function detectExtension(timeout = 900) {
    if (ES.isExtensionPage) return Promise.resolve(true);
    if (extPresent) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(extPresent), timeout);
      listeners.push((v) => { clearTimeout(t); resolve(v); });
      window.postMessage({ source: "eyescore-site", type: "PING" }, "*");
    });
  }

  function toCode(p) {
    const lite = Object.assign({}, p);
    delete lite.analysis; delete lite.choices; delete lite.results; // keep codes short
    return CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(lite))));
  }
  function fromCode(code) {
    const c = String(code || "").trim();
    if (!c.startsWith(CODE_PREFIX)) throw new Error("Not an EyeScore profile code");
    const p = JSON.parse(decodeURIComponent(escape(atob(c.slice(CODE_PREFIX.length)))));
    if (!p || !(p.v === 3 ? p.screens : p.settings)) throw new Error("Unrecognized profile");
    delete p.results;                      // codes carry settings only, never raw results
    return p;
  }

  async function post(type, payload) {
    if (!(await detectExtension())) return false;
    const id = nextId++;
    const acked = new Promise((resolve) => {
      pendingSaves.set(id, resolve);
      setTimeout(() => { if (pendingSaves.delete(id)) resolve(false); }, 1500);
    });
    window.postMessage(Object.assign({ source: "eyescore-site", type, id }, payload), "*");
    return acked;
  }

  /* Shape checks for results coming back from storage or a code. */
  const num = (x) => typeof x === "number" && isFinite(x) && x > 0;
  function validScreen(v) {
    return !!(v && v.calib && num(v.calib.pxPerMm) && num(v.calib.distanceMm) && v.res && v.res.size && num(v.res.size.thresholdCss));
  }
  function validColor(c) {
    return !!(c && c.thresholds && ["protan", "deutan", "tritan"].every((a) => num(c.thresholds[a])) && c.caps);
  }
  /* Merging a saved profile with an incoming one: the same rule as the extension's mergeProfiles (shared.js).
     Each test (size, contrast, night, no glasses, comfort) is merged on its own date, and a test's setting
     and raw result always come from the same side. Color: the newer color test wins. */
  const PARTS = ["size", "contrast", "night", "noGlasses", "comfort"];
  const FIELDS = { size: ["minXHeight"], contrast: ["contrast"], night: ["night"], noGlasses: ["minXHeightNoGlasses"], comfort: ["comfortSteps"] };
  const ms = (iso) => Date.parse(iso || 0) || 0;
  function partDate(s, raw, c) {
    const r = raw && raw.res && raw.res[c];
    if (r && r.at) return ms(r.at);
    if (s.dates) return s.dates[c] ? ms(s.dates[c]) : -1;
    const has = c === "size" ? !!s.minXHeight : c === "contrast" ? true : c === "night" ? !!s.night
      : c === "noGlasses" ? !!s.minXHeightNoGlasses : (s.comfortSteps || 0) > 0;
    if (!has) return -1;
    return ms(c === "size" || c === "contrast" ? s.at : s.updatedAt || s.at);
  }
  const comfortXH = (minXh, steps) => (steps > 0 && minXh ? +(Math.max(minXh, ES.rx.TYPICAL_XH) * Math.pow(ES.rx.COMFORT_STEP, steps)).toFixed(2) : null);
  function mergeScreen(cur, curRaw, inc, incRaw) {
    const out = {}, dates = {}, raw = { calib: (curRaw && curRaw.calib) || null, res: {} };
    let tookNew = false, keptOld = false, sizeFrom = inc;
    for (const c of PARTS) {
      const dOld = partDate(cur, curRaw, c), dNew = partDate(inc, incRaw, c);
      const useNew = dNew >= dOld;
      const [s, r, d] = useNew ? [inc, incRaw, dNew] : [cur, curRaw, dOld];
      for (const f of FIELDS[c]) out[f] = s[f] === undefined ? null : s[f];
      if (r && r.res && r.res[c]) raw.res[c] = r.res[c];
      if (c === "size") { sizeFrom = s; if (r && r.calib) raw.calib = r.calib; }
      if (d > 0) dates[c] = new Date(d).toISOString();
      if (useNew && dNew >= 0) tookNew = true;
      if (!useNew && dNew >= 0) keptOld = true;
    }
    const all = Object.values(dates).map(ms);
    const screen = Object.assign({}, out, {
      name: sizeFrom.name || cur.name || inc.name, at: sizeFrom.at || null,
      updatedAt: all.length ? new Date(Math.max(...all)).toISOString() : null,
      contrast: out.contrast || 0, comfortSteps: out.comfortSteps || 0,
      comfortXHeight: comfortXH(out.minXHeight, out.comfortSteps || 0),
      dates, source: sizeFrom.source || null
    });
    return { screen, raw: Object.keys(raw.res).length ? raw : null, tookNew, keptOld };
  }
  function mergeInto(old, p, stats) {
    const st = stats || {};
    st.added = []; st.updated = []; st.keptNewer = [];
    if (!old || old.v !== 3 || !old.screens || !p) return p;
    const atOf = (x) => ms(x && x.at);
    const screens = Object.assign({}, old.screens);
    const oldRes = (old.results && old.results.screens) || {}, newRes = (p.results && p.results.screens) || {};
    const res = Object.assign({}, oldRes);
    for (const [k, s] of Object.entries(p.screens || {})) {
      const cur = screens[k];
      if (!cur) { st.added.push(s.name || k); screens[k] = s; if (newRes[k]) res[k] = newRes[k]; continue; }
      const m = mergeScreen(cur, oldRes[k], s, newRes[k]);
      screens[k] = m.screen;
      if (m.raw) res[k] = m.raw; else delete res[k];
      if (m.tookNew) st.updated.push(m.screen.name || k);
      if (m.keptOld) st.keptNewer.push(m.screen.name || k);
    }
    const oc = old.results && old.results.color, nc = p.results && p.results.color;
    let color = old.color, colorRes = oc || null;
    if (nc) { if (!oc || atOf(nc) >= atOf(oc)) { color = p.color; colorRes = nc; } }
    else if (p.color && (!oc || ms(p.createdAt) >= atOf(oc))) color = p.color;
    const created = [old.createdAt, p.createdAt].filter(Boolean).sort().pop();
    const tested = Array.from(new Set([].concat(old.tested || [], p.tested || [])));
    return Object.assign({}, p, { createdAt: created || p.createdAt, screens, color, tested, results: { screens: res, color: colorRes } });
  }

  /* Shape checks for one test's raw result, before the bundled site copies it in. */
  function validPart(c, r) {
    if (!r || typeof r !== "object") return false;
    if (c === "size" || c === "noGlasses") return num(r.thresholdCss);
    if (c === "contrast") return num(r.threshold);
    if (c === "night") return !!(r.light && r.dark && num(r.light.threshold) && num(r.dark.threshold));
    if (c === "comfort") return typeof r.steps === "number" && r.steps >= 0 && r.steps <= 3;
    return false;
  }
  const validCalib = (c) => !!(c && num(c.pxPerMm) && num(c.distanceMm));

  /* Saves a full profile. Returns "extension" if the extension has it, otherwise "local". */
  async function save(p) {
    store.set("profile", p);
    if (ES.isExtensionPage) {
      let existing = null;
      try { existing = (await chrome.storage.local.get("profile")).profile; } catch (e) { /* none */ }
      await chrome.storage.local.set({ profile: mergeInto(existing, p) });
      return "extension";
    }
    return (await post("SAVE_PROFILE", { profile: p })) ? "extension" : "local";
  }

  /* The profile as the extension sees it (extension page), else the local copy. */
  async function loadBest() {
    if (ES.isExtensionPage) {
      try { const { profile } = await chrome.storage.local.get("profile"); if (profile) return profile; } catch (e) { /* fall through */ }
    }
    return store.get("profile", null);
  }

  ES.profile = {
    save, toCode, fromCode, detectExtension, loadBest, validScreen, validColor, validPart, validCalib, mergeInto, PARTS,
    onExtension(fn) { if (extPresent) fn(true); else listeners.push(fn); },
    load: () => store.get("profile", null)
  };
})(window.ES);
