/* Rules that turn each measured limit into a setting, and the profile the extension applies.
   Each rule is a published one, or is labeled as EyeScore's own where no published rule exists.
     Size     : text x-height at least 2× your smallest readable E (Legge & Bigelow 2011: critical
                print size is at least 2× acuity size for normally sighted readers). 3× is offered as a
                labeled comfort option (secondary sources only).
     Contrast : text contrast at least 10× your contrast threshold, never below 4×
                (Whittaker & Lovie-Kitchin 1994).
     Color    : thresholds compared with reference limits from the Cambridge Colour Test (about 0.0100 u'v' on the
                red-green lines, 0.0150 on blue-yellow; Hasrod & Rubin 2019). Those norms come from
                calibrated monitors, so classification here is provisional. Strength is EyeScore's own
                mapping (see colorRule).
     Night    : switch to dark mode only if your contrast limit is better there by more than 0.15 log
                units, compared as Michelson contrast so both polarities share one scale (borrowed from
                the Mars chart's meaningful-change size; EyeScore's own retest data should replace it).
                If either run ends near its easiest level, there's no verdict: your preference is used.
     Comfort  : EyeScore's own check, a preference rather than a measurement. Passages at your size and
                15% either side; the minimum goes up a step only if you pick the bigger one both times. */
(function (ES) {
  "use strict";
  const { h, store } = ES;
  const T = ES.tests;

  const XH_ARIAL = 0.519;                      // Arial's x-height as a share of font size
  const TYPICAL_FONT = 16;                     // most websites' body text
  const TYPICAL_XH = TYPICAL_FONT * XH_ARIAL;  // ≈ 8.3 CSS px
  const REF_GRAY = 0x99;                       // #999999, common light-gray text
  const CONTRAST_EXP = { 1: 1.45, 2: 1.9 };    // same curves as the extension
  const weberOfGray = (g) => 1 - T.srgbDecode(g / 255);
  const weberBoosted = (g, lvl) => 1 - T.srgbDecode(Math.pow(g / 255, CONTRAST_EXP[lvl]));
  const NORMS = { protan: 0.0100, deutan: 0.0100, tritan: 0.0150 };
  // Protan and deutan count as "within noise" of each other inside two staircase steps (≈0.25 log
  // units); then the more common deutan type is used.
  const STEP_LOG = 2 * Math.log10(1 / 0.75);

  const opts = () => Object.assign({ sizeFactor: 2 }, store.get("opts", {}));
  const r1 = (x) => Math.round(x * 10) / 10;

  /* ---------- size ---------- */
  function sizeRule(res, calib, factor) {
    factor = factor || opts().sizeFactor;
    const th = res.thresholdCss;               // E height at your limit, CSS px
    const minXHeight = factor * th;            // the rule
    const minFont = minXHeight / XH_ARIAL;     // shown as an Arial-equivalent font size
    const out = {
      thresholdCss: th, factor, minXHeight, minFont,
      reserveTypical: TYPICAL_XH / th,         // how many times your limit typical text is
      change: minXHeight > TYPICAL_XH + 0.05,
      floorHit: !!res.floorHit,
      unreliable: res.spreadLog > 0.2,
      spreadLog: res.spreadLog
    };
    if (calib) {
      // Physical size only. EyeScore doesn't report clinical acuity scores (20/xx, logMAR): it's a
      // screen-settings tool, not an eye exam.
      out.eMm = th / calib.pxPerMm;
      out.distanceCm = Math.round(calib.distanceMm / 10);
    }
    return out;
  }

  /* ---------- contrast ---------- */
  function contrastRule(res) {
    const t = res.threshold;
    const ref = weberOfGray(REF_GRAY);
    const reserve = ref / t;
    let boost = 0;
    if (reserve < 10) boost = weberBoosted(REF_GRAY, 1) / t >= 10 ? 1 : 2;
    return {
      threshold: t, logCS: res.logCS, refContrast: ref, reserve, boost,
      reach10: 1 / t >= 10,                    // can even black text reach 10×?
      below4: 1 / t < 4,                       // even black text is under 4×
      boostedReserve: boost ? weberBoosted(REF_GRAY, boost) / t : reserve,
      unreliable: res.spreadLog !== null && res.spreadLog !== undefined && res.spreadLog > 0.2
    };
  }

  /* ---------- color ---------- */
  function colorRule(res) {
    const th = res.thresholds;
    const n = Object.fromEntries(Object.keys(NORMS).map((a) => [a, th[a] / NORMS[a]]));
    const high = Object.fromEntries(Object.keys(n).map((a) => [a, n[a] > 1 || (res.atCap && res.atCap[a])]));
    const count = Object.values(high).filter(Boolean).length;
    let result = "normal", assist = null, strength = 0;
    if (count === 3) result = "all-high";
    else if (high.tritan && !high.protan && !high.deutan) result = "tritan-only";
    else if (high.tritan) result = "mixed";
    else if (high.protan || high.deutan) {
      result = "redgreen";
      const diff = Math.log10(th.protan / th.deutan);
      assist = Math.abs(diff) <= STEP_LOG ? "deutan" : diff > 0 ? "protan" : "deutan";
      // Strength (EyeScore's own mapping, not validated): how far the worse line sits between the
      // normal limit (0) and the most the screen can show (1), on a log scale; at least 0.3.
      const a = assist, cap = res.caps[a];
      const s = cap > NORMS[a] ? Math.log(th[a] / NORMS[a]) / Math.log(cap / NORMS[a]) : 1;
      strength = (res.atCap && res.atCap[a]) ? 1 : Math.max(0.3, Math.min(1, s));
    }
    return { thresholds: th, norms: NORMS, ratios: n, result, assist, strength: +strength.toFixed(2) };
  }

  /* ---------- night ---------- */
  // Michelson contrast treats both polarities alike: (Lmax − Lmin) / (Lmax + Lmin). From Weber contrast c,
  // a dark E on white is c / (2 − c) and a light E on dark is c / (2 + c); near threshold both are about c / 2.
  const michelson = (r, pol) => pol === "dark" ? r.threshold / (2 + r.threshold) : r.threshold / (2 - r.threshold);
  const atCeiling = (r, pol) => r.ceiling !== undefined ? !!r.ceiling : r.threshold >= 0.8 * (r.max || 0.95);
  function nightRule(night) {
    const diff = Math.log10(michelson(night.light, "light") / michelson(night.dark, "dark"));   // > 0: dark mode is better
    let polarity = night.preference || "light", reason = "tie";
    if (atCeiling(night.light, "light") || atCeiling(night.dark, "dark")) reason = "ceiling";   // a limit wasn't reached: no verdict
    else if (diff > 0.15) { polarity = "dark"; reason = "measured"; }
    else if (diff < -0.15) { polarity = "light"; reason = "measured"; }
    const lightReserve = weberOfGray(REF_GRAY) / night.light.threshold;
    return { polarity, reason, diffLog: diff, dim: night.dim, lightReserve, lightBelow10: polarity === "light" && lightReserve < 10 };
  }

  /* ---------- reading comfort ---------- */
  // Starts from your minimum or typical 16px text, whichever is bigger: below typical size the extension
  // leaves pages alone, so that's the size you'd actually read at. Each step is 15%, up to three steps.
  const COMFORT_STEP = 1.15, COMFORT_MAX_STEPS = 3;
  const comfortBase = (minXh) => Math.max(minXh, TYPICAL_XH);
  const comfortSteps = (c) => (c && c.steps > 0 ? Math.min(COMFORT_MAX_STEPS, Math.round(c.steps)) : 0);
  function comfortXHeight(minXh, comfort) {
    const n = comfortSteps(comfort);
    return n ? +(comfortBase(minXh) * Math.pow(COMFORT_STEP, n)).toFixed(2) : null;
  }

  /* ---------- the profile the extension applies ---------- */
  const resFor = (key) => store.get("res:" + key, null) || {};
  function buildProfile() {
    const screens = {};
    const results = {};
    for (const [key, cal] of Object.entries(ES.calib.all())) {
      const res = resFor(key);
      if (!res.size) continue;
      const size = sizeRule(res.size, cal);
      const sc = {
        name: cal.name, at: res.size.at || cal.at,
        // When each test was taken: merges keep the newest of each test separately. ("at" stays the size
        // test's date: it decides when the screen is due for a retest.)
        dates: Object.fromEntries(["size", "contrast", "night", "noGlasses", "comfort"].filter((k) => res[k] && res[k].at).map((k) => [k, res[k].at])),
        updatedAt: new Date(Math.max(0, ...["size", "contrast", "night", "noGlasses", "comfort"].map((k) => Date.parse((res[k] && res[k].at) || 0) || 0))).toISOString(),
        minXHeight: +size.minXHeight.toFixed(2),
        minXHeightNoGlasses: res.noGlasses ? +sizeRule(res.noGlasses, cal).minXHeight.toFixed(2) : null,
        comfortSteps: comfortSteps(res.comfort),
        comfortXHeight: comfortXHeight(size.minXHeight, res.comfort),
        contrast: res.contrast ? contrastRule(res.contrast).boost : 0,
        night: res.night ? (({ polarity, dim }) => ({ polarity, dim }))(nightRule(res.night)) : null
      };
      screens[key] = sc;
      results[key] = { calib: cal, res };
    }
    const colorRes = store.get("color", null);
    const color = colorRes ? colorRule(colorRes) : null;
    return {
      v: 3,
      createdAt: new Date().toISOString(),
      screens,
      color: color && color.assist ? { assist: color.assist, strength: color.strength } : null,
      tested: Object.keys(screens).length ? ["size", "contrast", "color"] : [],
      headline: headline(screens[ES.calib.screenKey()], color),
      results: { screens: results, color: colorRes }
    };
  }

  function headline(sc, color) {
    const parts = [];
    if (sc) {
      const xh = Math.max(sc.minXHeight, sc.comfortXHeight || 0);
      if (xh > TYPICAL_XH + 0.05) parts.push(`text at least ${Math.round(xh / XH_ARIAL)}px`);
      if (sc.contrast) parts.push("darker gray text");
      if (sc.night) parts.push(sc.night.polarity === "dark" ? "dark mode at night" : "light mode at night");
    }
    if (color && color.assist) parts.push("color assist");
    if (!parts.length) return "Your eyes have plenty of room on this screen. EyeScore leaves pages as they are.";
    const t = parts.join(", ");
    return t.charAt(0).toUpperCase() + t.slice(1) + ".";
  }

  ES.rx = { sizeRule, contrastRule, colorRule, nightRule, buildProfile, comfortBase, comfortSteps, comfortXHeight, COMFORT_STEP, COMFORT_MAX_STEPS, headline, resFor, opts, XH_ARIAL, TYPICAL_FONT, TYPICAL_XH, REF_GRAY, NORMS, weberOfGray, weberBoosted, CONTRAST_EXP, r1 };
})(window.ES);
