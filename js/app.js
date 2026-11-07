/* EyeScore flow.
   Main test (about 4 minutes): setup (checklist, card, red dot) → size → contrast → color → results.
   Modes, run any time afterward: night check, no-glasses size test, tired-eyes log. Results are saved
   per screen. */
(function (ES) {
  "use strict";
  const { h, $, keys, toast, copyText, store } = ES;
  const app = $("#app");
  const progressEl = $("#progress"), progressFill = $("#progress-fill"), progressLabel = $("#progress-label");
  const T = ES.tests, RX = ES.rx, C = ES.calib;
  const state = { where: null };

  /* ---------- helpers ---------- */
  function setProgress(label, frac) {
    if (label === null) { progressEl.hidden = true; return; }
    progressEl.hidden = false;
    progressLabel.textContent = label;
    progressFill.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + "%";
  }
  function show(nodes) {
    keys.clear();
    app.replaceChildren(...[].concat(nodes).filter(Boolean));
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }
  function introCard({ eyebrow, title, body, sets, rule, time, cta = "Start" }) {
    return new Promise((resolve) => {
      const go = () => { keys.clear(); resolve(); };
      show(h("div", { class: "card narrow" },
        h("div", { class: "eyebrow" }, eyebrow),
        h("h2", null, title),
        h("p", { class: "muted" }, body),
        sets || time ? h("dl", { class: "spec" },
          sets ? [h("dt", null, "Sets"), h("dd", null, sets)] : null,
          sets && rule ? [h("dt", null, "Rule"), h("dd", null, rule)] : null,
          time ? [h("dt", null, "Time"), h("dd", null, time)] : null) : null,
        h("div", { class: "row end" }, h("button", { class: "btn btn-primary btn-lg", onclick: go }, cta, ES.isTouch ? null : [" ", h("span", { class: "kbd" }, "Enter")]))));
      keys.set((e) => { if (e.key === "Enter") { go(); return true; } return false; });
    });
  }
  const resNow = () => RX.resFor(C.screenKey());
  function saveRes(patch) { const k = "res:" + C.screenKey(); store.set(k, Object.assign({}, store.get(k, {}), patch)); }
  const stamp = (o) => Object.assign({}, o, { at: new Date().toISOString() });
  const pct = (x, d = 1) => (x * 100).toFixed(x < 0.1 ? d : 0) + "%";
  const fx = (x) => (x >= 10 ? Math.round(x) : x.toFixed(1)) + "×";

  async function saveProfile() {
    const p = RX.buildProfile();
    state.where = await ES.profile.save(p);
    return p;
  }

  /* ---------- welcome ---------- */
  function welcome() {
    setProgress(null);
    const hasRes = !!resNow().size;
    const step = (n, t, d, time) => h("li", { class: "home-step" },
      h("span", { class: "home-n" }, String(n).padStart(2, "0")), h("span", { class: "home-t" }, t),
      h("span", { class: "home-time" }, time), h("span", { class: "home-d" }, d));
    show(h("section", { class: "home" },
      h("div", null,
        h("div", { class: "eyebrow" }, "The EyeScore test"),
        h("h1", null, "Find your text settings on this screen"),
        h("p", { class: "lede" }, "A short setup, then three tests, about 4 minutes in all. Nothing flashes and nothing is timed: each test waits for your answer and homes in on your limit."),
        h("div", { class: "row" },
          h("button", { class: "btn btn-primary btn-lg", onclick: start }, hasRes ? "Retake the test" : "Start the test"),
          hasRes ? h("button", { class: "btn btn-lg", onclick: results }, "See my results") : null),
        h("p", { class: "tiny home-note" }, "Your results stay in this browser, with no account. EyeScore is not an eye exam. ", h("a", { href: "privacy.html" }, "Privacy"))),
      h("ol", { class: "home-steps", "aria-label": "What the test does" },
        step(1, "Setup", "Brightness all the way up, a bank card held to the screen, and a red dot that finds how far away you sit.", "1–2 min"),
        step(2, "Text size", "Say which way an E points as it shrinks.", "About 1 min"),
        step(3, "Contrast", "The same E fades out at reading size.", "About 40 s"),
        step(4, "Color", "Find the tile that's a slightly different color.", "About 1 min"))));
  }

  /* ---------- main test ---------- */
  async function start() {
    setProgress("Setup", 0.02);
    await C.run(app);
    await runMain();
  }

  async function runMain() {
    const cal = C.get();
    if (!cal) return start();
    const steps = 3;
    const ctxFor = (i, name) => ({ progress: (f) => setProgress(`Step ${i} of ${steps} · ${name}`, (i - 1 + f) / steps) });

    await introCard({ eyebrow: "Step 1 of 3", title: "Text size", body: "An E shrinks when you say which way it points and grows when you miss, until it finds the smallest one you can read. It stays on screen until you answer. Guess when you're not sure; that's part of how it works.", sets: "your minimum text size", rule: "text x-height at least 2× the smallest E you can read", time: "About a minute." });
    const size = await T.sizeTest(app, ctxFor(1, "Text size"), { eyebrow: "Step 1 of 3 · Text size" });
    saveRes({ size: stamp(size) });
    const sr = RX.sizeRule(size, cal);

    await introCard({ eyebrow: "Step 2 of 3", title: "Contrast", body: "Now the E is about the size of normal text and fades toward the background. It gets fainter when you're right and darker when you miss, until it finds the faintest one you can see.", sets: "darker gray text, only if you need it", rule: "text contrast at least 10× the faintest E you can see, never below 4×", time: "About 40 seconds." });
    const con = await T.contrastTest(app, ctxFor(2, "Contrast"), { eyebrow: "Step 2 of 3 · Contrast", xHeightCss: Math.max(sr.minXHeight, RX.TYPICAL_XH) });
    saveRes({ contrast: stamp(con) });

    await introCard({ eyebrow: "Step 3 of 3", title: "Color", body: "Four tiles; one is a slightly different color. The difference shrinks when you find it and grows when you miss, separately for the three directions people commonly confuse colors in. Brightness varies on purpose, so look for the color.", sets: "color assist, only if one direction is much harder for you", rule: "your limits compared with the Cambridge Colour Test's reference limits (provisional on an uncalibrated screen)", time: "About a minute." });
    const col = await T.colorTest(app, ctxFor(3, "Color"), { eyebrow: "Step 3 of 3 · Color" });
    store.set("color", stamp(col));

    await saveProfile();
    results();
  }

  /* ---------- results ---------- */
  function extensionBlock(where, profile) {
    if (where === "extension") {
      return h("div", { class: "stack" },
        h("h3", null, "Your personalized settings are ready"),
        h("p", { class: "muted", style: { margin: 0 } }, "EyeScore will use these settings on supported websites, adapting them when necessary to preserve each page's layout. Switch modes or change anything from the extension's toolbar button."));
    }
    const code = ES.profile.toCode(profile);
    const storeUrl = window.ES_CONFIG && ES_CONFIG.chromeStoreUrl;
    return h("div", { class: "stack" },
      h("h3", null, "Use your settings on websites"),
      h("p", { class: "muted", style: { margin: 0 } }, "The EyeScore Chrome extension uses these settings on supported websites, with Night and No-glasses modes and an off switch for any site."),
      storeUrl ? h("a", { class: "btn btn-primary", href: storeUrl, target: "_blank", rel: "noopener" }, "Add EyeScore to Chrome")
        : h("p", { class: "small callout warn", style: { margin: 0 } }, "Not in the Chrome Web Store yet. To try it: open chrome://extensions, turn on Developer mode, click Load unpacked, and choose the EyeScore/extension folder. Then reload this page."),
      h("div", null,
        h("p", { class: "small", style: { marginBottom: "6px" } }, "Extension on another computer? Paste this code into its popup:"),
        h("div", { class: "code-box" }, code),
        h("div", { class: "row", style: { marginTop: "8px" } }, h("button", { class: "btn", onclick: async () => { toast(await copyText(code) ? "Profile code copied." : "Couldn't copy. Select the code above and copy it by hand."); } }, "Copy profile code"))));
  }

  function row(name, source, limit, rule, verdict, extra) {
    return h("div", { class: "rx-row" },
      h("div", { class: "rx-name" }, h("strong", null, name), h("div", { class: "tiny" }, source)),
      h("div", { class: "rx-main" },
        limit ? h("div", { class: "small" }, h("span", { class: "muted" }, "Your limit: "), limit) : null,
        rule ? h("div", { class: "small" }, h("span", { class: "muted" }, "Rule: "), rule) : null,
        h("div", { class: "rx-verdict" }, verdict),
        extra || null));
  }

  function results() {
    const cal = C.get();
    const res = resNow();
    if (!cal || !res.size) return welcome();
    setProgress(null);
    const o = RX.opts();
    const sr = RX.sizeRule(res.size, cal);
    const cr = res.contrast ? RX.contrastRule(res.contrast) : null;
    const colRes = store.get("color", null);
    const kr = colRes ? RX.colorRule(colRes) : null;
    const profile = RX.buildProfile();
    const sc = profile.screens[C.screenKey()];

    /* size */
    const sizeLimit = [sr.eMm ? `an E ${sr.eMm.toFixed(2)} mm tall at ${sr.distanceCm} cm` : `an E ${RX.r1(sr.thresholdCss)} px tall`,
      sr.floorHit ? h("span", { class: "muted" }, ". You reached the smallest E this screen can draw, so your real limit is even smaller.") : null];
    const sizeVerdict = sr.change
      ? h("span", null, h("strong", { class: "accent" }, `Text at least ${Math.round(sr.minFont)}px`), ` (x-height ${RX.r1(sr.minXHeight)}px). Typical 16px text is only ${fx(sr.reserveTypical)} your limit, so EyeScore enlarges pages whose text is smaller than that.`)
      : h("span", null, h("strong", null, "No change on typical text. "), `16px text is ${fx(sr.reserveTypical)} your limit; the rule needs ${sr.factor}×. Pages with smaller text (x-height under ${RX.r1(sr.minXHeight)}px) get enlarged to your minimum.`);
    const factorToggle = h("label", { class: "switch-row small", style: { marginTop: "8px" } },
      h("span", { class: "switch" }, h("input", { type: "checkbox", checked: o.sizeFactor === 3, onchange: async (e) => { store.set("opts", Object.assign(RX.opts(), { sizeFactor: e.target.checked ? 3 : 2 })); await saveProfile(); results(); } }), h("span")),
      h("span", null, "Comfort option: 3× instead of 2× (for long reading; based on secondary sources only)"));
    const sizeExtra = [factorToggle, sr.unreliable ? h("p", { class: "small callout warn", style: { margin: "8px 0 0" } }, "Your two runs disagreed by more than 0.2 log units. Retake the test for a steadier result.") : null];

    /* contrast */
    let conRow = null;
    if (cr) {
      const verdict = cr.boost === 0
        ? h("span", null, h("strong", null, "No change. "), `Light-gray text (#999) is ${fx(cr.reserve)} your limit.`)
        : h("span", null, h("strong", { class: "accent" }, cr.boost === 2 ? "Strong contrast boost" : "Contrast boost"), `. Light-gray text is only ${fx(cr.reserve)} your limit; EyeScore darkens it to ${fx(cr.boostedReserve)}.`);
      const warn = cr.below4 ? "Even black text is under 4× your limit. Better lighting, magnification, or an eye care professional can help more than screen settings."
        : !cr.reach10 ? "Even black text is under 10× your limit, so EyeScore also suggests the 3× size option above." : null;
      conRow = row("Contrast", "Fading E (like a contrast chart)", `${pct(cr.threshold)} contrast at reading size`, "text contrast at least 10× that, never below 4×", verdict, warn ? h("p", { class: "small callout warn", style: { margin: "8px 0 0" } }, warn) : null);
    }

    /* color */
    let colRow = null;
    if (kr) {
      const names = { protan: "Red–green 1", deutan: "Red–green 2", tritan: "Blue–yellow" };
      const lines = h("div", { class: "small" }, Object.keys(names).map((a) => h("div", null, `${names[a]}: ${kr.thresholds[a].toFixed(4)} (${kr.ratios[a].toFixed(1)}× the reference limit)`)));
      const verdicts = {
        normal: h("span", null, h("strong", null, "Off. "), "All three directions are within the reference limits on this screen."),
        redgreen: h("span", null, h("strong", { class: "accent" }, `Color assist on (${names[kr.assist]}, strength ${Math.round(kr.strength * 100)}%)`), ", plus underlined links. This isn't a diagnosis."),
        "tritan-only": h("span", null, h("strong", null, "Off for now. "), "Only blue–yellow came out high. That's rare and is often caused by Night Shift, True Tone or a blue-light filter. Turn those off and retake; if it stays high, consider an eye exam."),
        "all-high": h("span", null, h("strong", null, "Off for now. "), "All three directions came out high, which usually means the screen's colors or a filter, not your eyes. Check that filters are off and retake."),
        mixed: h("span", null, h("strong", null, "Off for now. "), "The pattern doesn't match a common color vision difference. Retake to check.")
      };
      colRow = row("Color", "Odd tile out (like the Cambridge Colour Test)", lines, "compare each direction with its reference limit (from calibrated monitors, so on this screen it's provisional, not a diagnosis)", verdicts[kr.result]);
    }

    /* modes */
    const night = res.night ? RX.nightRule(res.night) : null;
    const nightRow = night
      ? row("Night mode", "Contrast test in light and dark mode, at night",
          `light mode ${pct(res.night.light.threshold)}, dark mode ${pct(res.night.dark.threshold)} at ${Math.round(night.dim * 100)}% page brightness`,
          "switch to dark only if it's better by more than 0.15 log units; otherwise your preference",
          h("span", null, h("strong", { class: "accent" }, `${night.polarity === "dark" ? "Dark" : "Light"} mode, ${Math.round(night.dim * 100)}% brightness`), night.reason === "tie" ? ` (a tie, so your preference). Difference ${Math.abs(night.diffLog).toFixed(2)} log units.` : night.reason === "ceiling" ? " (your preference: one of the two runs ended at its easiest level, so the comparison isn't reliable. Redo it to try again)." : ` (measured: ${Math.abs(night.diffLog).toFixed(2)} log units better).`),
          h("div", { class: "row", style: { marginTop: "8px" } }, h("button", { class: "btn btn-small", onclick: runNight }, "Redo the night check")))
      : row("Night mode", "Contrast test in light and dark mode, at night", null, null, h("span", { class: "muted" }, "Not measured yet. Do it at night, in your usual lighting, with screen brightness all the way up. About 2–3 minutes."),
          h("div", { class: "row", style: { marginTop: "8px" } }, h("button", { class: "btn btn-small", onclick: runNight }, "Run the night check")));
    const ng = res.noGlasses ? RX.sizeRule(res.noGlasses, cal) : null;
    const ngRow = ng
      ? row("No glasses", "Size test without glasses", ng.eMm ? `an E ${ng.eMm.toFixed(2)} mm tall` : null, "same 2× rule",
          h("span", null, h("strong", { class: "accent" }, ng.change ? `Text at least ${Math.round(ng.minFont)}px` : "No change"), " when No-glasses mode is on. Switch it on from the extension's popup."),
          h("div", { class: "row", style: { marginTop: "8px" } }, h("button", { class: "btn btn-small", onclick: runNoGlasses }, "Redo")))
      : row("No glasses", "Size test without glasses", null, null, h("span", { class: "muted" }, "For reading in bed or when you don't have your glasses. About a minute."),
          h("div", { class: "row", style: { marginTop: "8px" } }, h("button", { class: "btn btn-small", onclick: runNoGlasses }, "Test without glasses")));

    /* reading comfort */
    const cm = res.comfort || null, cSteps = RX.comfortSteps(cm);
    const cXh = RX.comfortXHeight(sr.minXHeight, cm);
    const comfortRow = row("Reading comfort", "Your preference, side by side (not a measurement)", null, cm ? "15% bigger only if you pick the bigger passage both times" : null,
      !cm ? h("span", { class: "muted" }, "Not checked yet. Compare a passage at your size with 15% bigger and smaller ones. About a minute.")
        : cSteps ? h("span", null, h("strong", { class: "accent" }, `Text at least ${Math.round(cXh / RX.XH_ARIAL)}px`), ` on this screen, by your choice (${cSteps} step${cSteps > 1 ? "s" : ""} of 15% above ${Math.round(RX.comfortBase(sr.minXHeight) / RX.XH_ARIAL)}px).`)
        : h("span", null, h("strong", null, "No change. "), "You kept your measured size."),
      h("div", { class: "row", style: { marginTop: "8px" } },
        h("button", { class: "btn btn-small", onclick: runComfort }, cm ? "Check again" : "Check reading comfort"),
        cSteps ? h("button", { class: "btn btn-small btn-ghost", onclick: () => { saveRes({ comfort: stamp({ steps: 0, outcome: "reset" }) }); saveProfile().then(results); } }, "Back to my measured size") : null));

    /* color preview */
    const preview = kr && kr.assist ? colorPreview(kr.assist, kr.strength) : null;

    const stat = (v, l) => h("div", { class: "stat" }, h("div", { class: "stat-v" }, v), h("div", { class: "stat-l" }, l));
    const extSlot = h("div", { class: "card" });
    const renderExt = (w) => extSlot.replaceChildren(extensionBlock(w, profile));
    const others = Object.values(C.all()).filter((s) => s.key !== C.screenKey());

    show([
      h("div", { class: "headline-box" },
        h("div", { class: "eyebrow" }, `Your screen settings · ${cal.name}`),
        h("div", { class: "big" }, profile.headline),
        // The same three numbers as the extension's popup ("Your screen profile").
        h("div", { class: "stats" },
          stat(sc ? `${Math.round(Math.max(sc.minXHeight, sc.comfortXHeight || 0) / RX.XH_ARIAL)}px` : "–", "Text minimum"),
          stat(sc && sc.contrast === 2 ? "Strong" : sc && sc.contrast === 1 ? "Boost" : "Off", "Contrast"),
          stat(profile.color ? "On" : "Off", "Color assist")),
        h("div", { class: "sub" }, `Measured at ${Math.round(cal.distanceMm / 10)} cm with the screen at full brightness. Each setting comes from your limit and a rule; "no change" means your eyes clear the rule with room to spare.`)),
      h("div", { class: "rx-layout" },
        h("div", { class: "stack" },
          h("div", { class: "card" }, h("h3", null, "What we measured and what it sets"),
            h("div", { class: "rx-rows" },
              row("Text size", "Shrinking E (like an eye chart)", sizeLimit, `text x-height at least ${sr.factor}× that`, sizeVerdict, sizeExtra),
              conRow, colRow)),
          h("div", { class: "card" }, h("h3", null, "Check it by reading"), h("div", { class: "rx-rows" }, comfortRow)),
          preview ? h("div", { class: "card" }, h("h3", null, "Color assist preview"), h("p", { class: "small muted" }, "Keep it on if the right-hand chart is easier to tell apart. You can turn it off in the extension's popup."), preview) : null,
          h("div", { class: "card" }, h("h3", null, "Modes"), h("div", { class: "rx-rows" }, nightRow, ngRow,
            row("Tired eyes", "Experiment: start vs end of a session", null, null, h("span", { class: "muted" }, "Check whether your limits drop after a long session, compared with the test's own noise."),
              h("div", { class: "row", style: { marginTop: "8px" } }, h("button", { class: "btn btn-small", onclick: tired }, "Open the tired-eyes log")))))),
        h("div", { class: "stack" },
          extSlot,
          h("div", { class: "card" },
            h("h3", null, "Screens"),
            h("p", { class: "small" }, h("strong", null, "This screen: "), `${cal.name} · ${cal.w}×${cal.h} · ${Math.round(cal.distanceMm / 10)} cm (${cal.distanceMethod === "blindspot" ? "red dot" : "typed"})${cal.cardMatched ? "" : " · card not matched, so sizes in mm and the distance are estimates"}`),
            Math.abs((window.devicePixelRatio || 1) - (cal.dpr || 1)) > 0.01 ? h("p", { class: "small callout warn" }, `Browser zoom seems different from when you set up (pixel ratio ${cal.dpr} then, ${+(window.devicePixelRatio || 1).toFixed(2)} now). Results are most accurate at the zoom you tested with; 100% is best.`) : null,
            others.length ? h("ul", { class: "small", style: { paddingLeft: "18px" } }, others.map((s) => h("li", null, `${s.name} · ${s.w}×${s.h}`))) : null,
            h("p", { class: "tiny" }, "To set up another screen, open EyeScore on that screen and take the test there. The extension picks the right results for each screen automatically."),
            h("button", { class: "btn", onclick: start }, "Retake the test on this screen")))),
      h("p", { class: "tiny center", style: { marginTop: "16px" } }, "These are screen settings, not a medical test. If reading has become harder for you lately, see an eye care professional.")
    ]);
    if (state.where) renderExt(state.where);
    else {
      extSlot.replaceChildren(h("p", { class: "muted", style: { margin: 0 } }, "Looking for the EyeScore extension…"));
      ES.profile.detectExtension().then((present) => {
        if (present) saveProfile().then((p) => { renderExt(state.where); void p; }); else renderExt(ES.isExtensionPage ? "extension" : "local");
      });
    }
  }

  /* Before/after chart for color assist, using the same matrix as the extension. */
  function colorPreview(type, strength) {
    const id = "pv-dalt";
    let svg = document.getElementById("pv-filters");
    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "pv-filters";
      svg.setAttribute("style", "position:absolute;width:0;height:0");
      svg.setAttribute("aria-hidden", "true");
      document.body.appendChild(svg);
    }
    const M = ES.dalton.matrix(type, strength);
    svg.innerHTML = `<filter id="${id}" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${M[0]} ${M[1]} ${M[2]} 0 0 ${M[3]} ${M[4]} ${M[5]} 0 0 ${M[6]} ${M[7]} ${M[8]} 0 0 0 0 0 1 0"/></filter>`;
    const rows = type === "tritan"
      ? [["Blue", "#1f77b4", 82], ["Green", "#2ca02c", 64], ["Purple", "#9467bd", 47], ["Olive", "#bcbd22", 30]]
      : [["Red", "#d62728", 82], ["Green", "#2ca02c", 64], ["Orange", "#ff7f0e", 47], ["Brown", "#8c564b", 30]];
    const chart = () => h("div", { class: "rx-chart" }, rows.map(([n, c, v]) => h("div", { class: "rx-chart-row" }, h("span", { class: "rx-key", style: { background: c } }), h("span", null, n), h("span", { class: "rx-chart-bar", style: { width: v + "%", background: c } }))));
    return h("div", { class: "rx-compare" },
      h("div", { class: "rx-panel" }, h("div", { class: "tiny" }, "Original"), chart()),
      h("div", { class: "rx-panel" }, h("div", { class: "tiny" }, "With color assist"), h("div", { style: { filter: `url(#${id})` } }, chart())));
  }

  /* ---------- modes ---------- */
  async function runNoGlasses() {
    if (!C.get()) return start();
    await introCard({ eyebrow: "No-glasses mode", title: "Text size without glasses", body: "Take off your glasses or contacts and sit the way you'd read without them, for example in bed. Then do the same shrinking-E test. EyeScore keeps this as a second minimum text size you can switch to in one click.", sets: "your minimum text size for No-glasses mode", rule: "the same: text x-height at least 2× your limit", time: "About a minute. Stay on this screen." });
    const r = await T.sizeTest(app, { progress: (f) => setProgress("No glasses · Text size", f) }, { eyebrow: "No-glasses mode · Text size", startCss: 40, startLowCss: 8 });
    saveRes({ noGlasses: stamp(r) });
    await saveProfile();
    results();
  }

  async function runNight() {
    const res = resNow();
    if (!C.get() || !res.size) return start();
    const xh = Math.max(RX.sizeRule(res.size, C.get()).minXHeight, RX.TYPICAL_XH);
    await introCard({ eyebrow: "Night check", title: "Measure your night mode", body: "Do this at night, in the lighting you usually have when you read at night, with screen brightness all the way up. First pick a comfortable page brightness, then do the fading-E test twice: once in light mode, once in dark mode.", sets: "light or dark mode at night, and page dimming", rule: "switch to dark mode only if your limit is better there by more than 0.15 log units; otherwise your preference", time: "About 2–3 minutes." });
    const dim = await T.dimPicker(app, { eyebrow: "Night check · 1 of 3" });
    const order = Math.random() < 0.5 ? ["light", "dark"] : ["dark", "light"];
    const out = {};
    for (let i = 0; i < 2; i++) {
      const pol = order[i];
      out[pol] = await T.contrastTest(app, { progress: (f) => setProgress(`Night check · ${pol === "dark" ? "Dark" : "Light"} mode`, (1 + i + f) / 3) }, { eyebrow: `Night check · ${i + 2} of 3 · ${pol === "dark" ? "Dark" : "Light"} mode`, polarity: pol, dim, xHeightCss: xh });
    }
    const pref = await new Promise((resolve) => {
      show(h("div", { class: "card narrow" },
        h("div", { class: "eyebrow" }, "Night check"),
        h("h2", null, "Which do you prefer at night?"),
        h("p", { class: "muted" }, "If the two results are too close to call, EyeScore uses your preference."),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: () => resolve("light") }, "Light mode"), h("button", { class: "btn", onclick: () => resolve("dark") }, "Dark mode"))));
    });
    saveRes({ night: stamp({ dim, light: out.light, dark: out.dark, preference: pref, order }) });
    await saveProfile();
    results();
  }

  /* ---------- reading comfort (a preference, not a measurement) ---------- */
  // Original passages, plain everyday text, one per comparison.
  const PASSAGES = [
    "The library on Elm Street opens at nine on weekdays and at ten on Saturdays. Returned books go in the slot by the front door, and the staff sort them before noon. If a book you want is checked out, you can ask to be told when it comes back.",
    "To cook rice on the stove, rinse one cup of rice until the water runs almost clear. Put it in a pot with one and a half cups of water and a pinch of salt. Bring it to a boil, cover it, turn the heat down low and leave it for fifteen minutes.",
    "The morning train leaves the city at 7:40 and reaches the coast a little after ten. Most people get off at the second stop, where the market is. The last train back leaves at six, so plan the day around it or be ready to wait for the bus.",
    "Tomatoes need at least six hours of sun a day and steady water. Water them at the base in the morning rather than over the leaves at night. When the first fruit appears, tie the main stem loosely to a stake so the plant doesn't bend under the weight.",
    "Before a long bike ride, check that both tires are firm and that the brakes stop the wheel quickly. Bring water, a small snack and a spare tube. If the weather looks uncertain, a thin jacket that folds into a pocket is worth the extra space.",
    "The museum's new hall shows maps drawn over four hundred years. Early ones guess at coastlines and fill the empty space with drawings of ships. Later maps add roads, rivers and town names in careful lettering. A short film near the exit explains how the surveys were made."
  ];
  const fontPx = (xh) => xh / RX.XH_ARIAL;

  // One comparison: the same passage at two sizes, in equal columns (bigger text wraps onto more lines,
  // as it would on a page). Resolves "A", "B" or "same".
  function comparePassages(i, n, text, sizeA, sizeB) {
    return new Promise((resolve) => {
      const done = (v) => { keys.clear(); resolve(v); };
      const panel = (label, px) => h("div", { class: "cmp-panel" },
        h("div", { class: "cmp-label" }, label),
        h("p", { class: "cmp-text", style: { fontSize: px.toFixed(2) + "px" } }, text));
      const kbd = (k) => (ES.isTouch ? null : [" ", h("span", { class: "kbd" }, k)]);
      show(h("div", { class: "card" },
        h("div", { class: "eyebrow" }, `Reading comfort · ${i} of ${n}`),
        h("h2", null, "Which is more comfortable to read?"),
        h("p", { class: "muted small" }, "Read both. Imagine reading a whole page at that size, then pick one, or About the same."),
        h("div", { class: "cmp" }, panel("A", sizeA), panel("B", sizeB)),
        h("div", { class: "row center", style: { marginTop: "16px" } },
          h("button", { class: "btn", onclick: () => done("A") }, "A", kbd("←")),
          h("button", { class: "btn btn-ghost", onclick: () => done("same") }, "About the same", kbd("S")),
          h("button", { class: "btn", onclick: () => done("B") }, "B", kbd("→")))));
      keys.set((e) => {
        const k = e.key.toLowerCase();
        if (k === "arrowleft" || k === "a") { done("A"); return true; }
        if (k === "arrowright" || k === "b") { done("B"); return true; }
        if (k === "s" || k === "=") { done("same"); return true; }
        return false;
      });
    });
  }

  async function runComfort() {
    const cal = C.get(), res = resNow();
    if (!cal || !res.size) return start();
    const sr = RX.sizeRule(res.size, cal);
    const steps0 = RX.comfortSteps(res.comfort);
    const step = RX.COMFORT_STEP;
    const cur = fontPx(RX.comfortBase(sr.minXHeight) * Math.pow(step, steps0));   // the size you'd read at now
    const typ = RX.TYPICAL_FONT;
    await introCard({ eyebrow: "Reading comfort", title: "Check your text size by reading", body: "You'll see a short passage twice, side by side, at two sizes. Read both and pick the one that's more comfortable for reading a whole page, or About the same. Each pair comes up twice with the sides swapped, and EyeScore only changes your size if you pick the same one both times.", sets: "a bigger minimum text size, only if you choose it", rule: "your preference, not a measurement: 15% bigger if you pick the bigger passage both times", time: "About a minute. Sit the way you usually do." });

    const pairs = [];
    if (cur > typ + 0.5) pairs.push({ id: "typical", small: typ, big: cur });          // without vs with EyeScore
    pairs.push({ id: "bigger", small: cur, big: cur * step });
    pairs.push({ id: "smaller", small: cur / step, big: cur });
    let trials = [];
    for (const p of pairs) { const bigFirst = Math.random() < 0.5; trials.push({ p, bigLeft: bigFirst }, { p, bigLeft: !bigFirst }); }
    trials = ES.shuffle(trials);
    const texts = ES.shuffle(PASSAGES);
    const log = [];
    for (let i = 0; i < trials.length; i++) {
      const t = trials[i];
      setProgress("Reading comfort", i / trials.length);
      const [a, b] = t.bigLeft ? [t.p.big, t.p.small] : [t.p.small, t.p.big];
      const pick = await comparePassages(i + 1, trials.length, texts[i % texts.length], a, b);
      const chose = pick === "same" ? "same" : (pick === "A") === t.bigLeft ? "big" : "small";
      log.push({ pair: t.p.id, chose });
    }
    setProgress(null);
    const agreed = (id) => { const c = log.filter((x) => x.pair === id).map((x) => x.chose); return c.length === 2 && c[0] === c[1] && c[0] !== "same" ? c[0] : (c.length ? "none" : null); };
    const out = { typical: agreed("typical"), bigger: agreed("bigger"), smaller: agreed("smaller") };
    const up = out.bigger === "big", down = out.smaller === "small";
    let suggest = steps0, outcome = "right";
    if (up && down) outcome = "inconsistent";
    else if (up) { outcome = steps0 < RX.COMFORT_MAX_STEPS ? "bigger" : "at-max"; suggest = Math.min(RX.COMFORT_MAX_STEPS, steps0 + 1); }
    else if (down) { outcome = steps0 > 0 ? "smaller" : "smaller-ok"; suggest = Math.max(0, steps0 - 1); }

    const record = (steps) => {
      saveRes({ comfort: stamp({ steps, outcome, picks: out, fontPx: +cur.toFixed(1) }) });
      return saveProfile().then(results);
    };
    const px = (x) => `${Math.round(x)}px`;
    const line = (label, v, bigText, smallText) => h("li", null, h("strong", null, label + ": "),
      v === "big" ? bigText : v === "small" ? smallText : "no consistent pick (that's fine).");
    const lines = h("ul", { class: "checklist plain" },
      out.typical ? line(`Typical ${px(typ)} text or your EyeScore size, ${px(cur)}`, out.typical, "you picked your EyeScore size both times.", "you picked typical text both times. EyeScore keeps its minimum, since it comes from the reading-speed rule; you can make a site smaller with − in the extension.") : null,
      line(`Your size or 15% bigger, ${px(cur * step)}`, out.bigger, "you picked the bigger one both times.", "you picked your size both times."),
      line(`Your size or 15% smaller, ${px(cur / step)}`, out.smaller, "you picked your size both times.", "you picked the smaller one both times."));
    const next = cur * Math.pow(step, suggest - steps0);
    const messages = {
      right: "Your current size looks right for you. Nothing changes.",
      inconsistent: "You picked bigger in one pair and smaller in the other, so EyeScore keeps your size. Try again another time if you like.",
      "at-max": "You're already at the largest comfort step (three steps above your minimum). Nothing changes.",
      "smaller-ok": "Smaller text felt fine too. EyeScore never shrinks pages and keeps your measured minimum, so nothing changes.",
      bigger: `Make your minimum text size on this screen 15% bigger, ${px(cur)} → ${px(next)}?`,
      smaller: `Go back one step, ${px(cur)} → ${px(next)}?`
    };
    const ask = outcome === "bigger" || outcome === "smaller";
    show(h("div", { class: "card narrow" },
      h("div", { class: "eyebrow" }, "Reading comfort"),
      h("h2", null, "What you picked"),
      lines,
      h("p", null, messages[outcome]),
      h("p", { class: "tiny" }, "This is your preference, not a measurement. People often pick bigger text in side-by-side comparisons, which is why a change needs the same pick twice."),
      h("div", { class: "row end" }, ask
        ? [h("button", { class: "btn btn-ghost", onclick: () => record(steps0) }, "Keep my size"),
           h("button", { class: "btn btn-primary", onclick: () => record(suggest) }, outcome === "bigger" ? "Make it bigger" : "Go back a step")]
        : h("button", { class: "btn btn-primary", onclick: () => record(steps0) }, "See results"))));
  }

  /* ---------- tired-eyes experiment ---------- */
  const tiredLog = () => store.get("tired", []) || [];
  function pooledSd(field, screenKey) {
    const d = tiredLog().filter((e) => e.screen === screenKey).map((e) => e[field] && e[field].spreadLog).filter((x) => typeof x === "number");
    if (!d.length) return null;
    return { sd: Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length / 2), n: d.length };
  }
  function tired() {
    const cal = C.get();
    if (!cal) return start();
    setProgress(null);
    const log = tiredLog().filter((e) => e.screen === cal.key);
    const label = h("select", { class: "text-input", "aria-label": "When" },
      ["Start of a session", "Middle of a session", "End of a session", "Other"].map((t) => h("option", null, t)));
    const hours = h("input", { type: "number", min: 0, max: 24, step: 0.5, class: "text-input", placeholder: "e.g. 2", style: { maxWidth: "110px" }, "aria-label": "Hours on screens so far today" });
    const sSize = pooledSd("size", cal.key), sCon = pooledSd("contrast", cal.key);
    // Group by the local calendar day (the table shows local times).
    const day = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
    const mm = (e, css) => css / (e.pxPerMm || cal.pxPerMm);           // calibration at the time of the check
    const firstOfDay = {};
    for (const e of log) if (!firstOfDay[day(e.at)]) firstOfDay[day(e.at)] = e;
    const verdict = (dlog, s) => {
      if (!s || s.n < 2) return "need more checks";
      if (Math.abs(dlog) <= 2 * s.sd) return "within noise";
      return dlog > 0 ? "worse than noise" : "better than noise";
    };
    const rowsEl = log.slice().reverse().map((e) => {
      const f = firstOfDay[day(e.at)];
      const dS = Math.log10(e.size.thresholdCss / f.size.thresholdCss);
      const dC = Math.log10(e.contrast.threshold / f.contrast.threshold);
      const same = f === e;
      return h("tr", null,
        h("td", null, new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })),
        h("td", null, e.label + (typeof e.hours === "number" ? ` · ${e.hours} h` : "")),
        h("td", null, `${mm(e, e.size.thresholdCss).toFixed(2)} mm`),
        h("td", null, pct(e.contrast.threshold)),
        h("td", null, same ? "first of the day" : `size ${dS >= 0 ? "+" : ""}${dS.toFixed(2)} (${verdict(dS, sSize)}) · contrast ${dC >= 0 ? "+" : ""}${dC.toFixed(2)} (${verdict(dC, sCon)})`));
    });
    show([
      h("div", { class: "card" },
        h("div", { class: "eyebrow" }, "Experiment"),
        h("h2", null, "Tired-eyes log"),
        h("p", { class: "muted" }, "Does your eyesight on screen drop after a long session? Each check runs the shrinking-E test and the fading-E test, each with two staircases so it can estimate its own noise (about 2½ minutes). Do one at the start of a long study session and one at the end, at full brightness, same seat. EyeScore compares the change with your noise: a change counts only if it's more than twice the noise."),
        h("div", { class: "row" },
          h("label", { class: "field" }, h("span", { class: "small" }, "When"), label),
          h("label", { class: "field" }, h("span", { class: "small" }, "Hours on screens so far today (optional)"), hours),
          h("button", { class: "btn btn-primary", onclick: () => runTiredCheck(label.value, hours.value === "" ? null : +hours.value) }, "Run a check"))),
      h("div", { class: "card" },
        h("h3", null, "Your checks on this screen"),
        log.length ? h("div", { class: "table-wrap" }, h("table", { class: "data-table" },
          h("thead", null, h("tr", null, h("th", null, "When"), h("th", null, "Label"), h("th", null, "Smallest E"), h("th", null, "Faintest E"), h("th", null, "Change vs first check that day (log units)"))),
          h("tbody", null, rowsEl))) : h("p", { class: "muted" }, "No checks yet."),
        h("p", { class: "tiny" }, `Noise estimate (one check, from its two staircases): size ±${sSize ? (2 * sSize.sd).toFixed(2) : "–"}, contrast ±${sCon ? (2 * sCon.sd).toFixed(2) : "–"} log units, from ${sSize ? sSize.n : 0} checks. Positive change = worse (needs a bigger or darker E). It gets more reliable with more checks.`),
        h("div", { class: "row" },
          log.length ? h("button", { class: "btn", onclick: () => downloadCsv(log, cal) }, "Download data (CSV)") : null,
          h("button", { class: "btn btn-ghost", onclick: results }, "Back to results")))
    ]);
  }
  async function runTiredCheck(label, hours) {
    const cal = C.get();
    const r = resNow();
    const xh = Math.max(r.size ? RX.sizeRule(r.size, cal).minXHeight : 0, RX.TYPICAL_XH);
    const s = await T.sizeTest(app, { progress: (f) => setProgress("Tired-eyes check · Size", f / 2) }, { eyebrow: "Tired-eyes check · 1 of 2 · Size" });
    const c = await T.contrastTest(app, { progress: (f) => setProgress("Tired-eyes check · Contrast", 0.5 + f / 2) }, { eyebrow: "Tired-eyes check · 2 of 2 · Contrast", xHeightCss: xh, staircases: 2 });
    const log = store.get("tired", []) || [];
    log.push({ at: new Date().toISOString(), screen: cal.key, pxPerMm: cal.pxPerMm, label, hours, size: { thresholdCss: s.thresholdCss, thresholdsCss: s.thresholdsCss, spreadLog: s.spreadLog }, contrast: { threshold: c.threshold, thresholds: c.thresholds, spreadLog: c.spreadLog, heightCss: c.heightCss } });
    store.set("tired", log.slice(-300));
    tired();
  }
  function downloadCsv(log, cal) {
    const head = ["time", "label", "hours", "screen", "size_E_mm", "size_run1_mm", "size_run2_mm", "contrast", "contrast_run1", "contrast_run2"];
    const lines = log.map((e) => [e.at, e.label, e.hours ?? "", cal.name,
      (e.size.thresholdCss / (e.pxPerMm || cal.pxPerMm)).toFixed(4), ...e.size.thresholdsCss.map((t) => (t / (e.pxPerMm || cal.pxPerMm)).toFixed(4)),
      e.contrast.threshold.toFixed(5), ...e.contrast.thresholds.map((t) => t.toFixed(5))].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: "eyescore-tired-eyes.csv" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /* ---------- boot ---------- */
  // The EyeScore logo goes to the home page (index.html); this page's own start screen is welcome().
  const pill = $("#ext-pill");
  if (ES.isExtensionPage) { pill.textContent = "Running in the extension"; pill.hidden = false; }
  else { ES.profile.onExtension(() => { pill.hidden = false; }); ES.profile.detectExtension(); }

  (async function boot() {
    // Inside the extension, pick up results saved from the website (the two keep separate local storage).
    if (ES.isExtensionPage) {
      const p = await ES.profile.loadBest();
      if (p && p.v === 3 && p.screens) {
        // Bring in, test by test, any result the extension has that's newer than this page's copy (results
        // can come from the website or the other copy of this page). Malformed results are skipped.
        // If the extension has newer settings for a test with no result behind them (a profile code chosen
        // over this computer's results), this page's older result for that test is dropped, so the results
        // page doesn't show numbers the extension no longer uses.
        const P = ES.profile, ms = (iso) => Date.parse(iso || 0) || 0;
        const extRes = (p.results && p.results.screens) || {};
        for (const [key, sc] of Object.entries(p.screens)) {
          const v = extRes[key] || null;
          const mine = store.get("res:" + key, null) || {};
          let changed = false;
          for (const c of P.PARTS) {
            const ext = v && v.res && v.res[c];
            const mineAt = ms(mine[c] && mine[c].at);
            if (ext && P.validPart(c, ext) && ms(ext.at) > mineAt) {
              if (c === "size") { if (!P.validCalib(v.calib)) continue; C.save(Object.assign({}, v.calib, { key })); }
              mine[c] = ext; changed = true;
            } else if (!ext && mine[c] && sc && sc.dates && ms(sc.dates[c]) > mineAt) { delete mine[c]; changed = true; }
          }
          if (changed) store.set("res:" + key, mine);
        }
        const lc = store.get("color", null);
        if (p.results && P.validColor(p.results.color) && (!lc || Date.parse(p.results.color.at || 0) > Date.parse(lc.at || 0))) store.set("color", p.results.color);
      }
    }
    const route = location.hash.replace("#", "");
    if (route === "start") start();
    else if (route === "night") runNight();
    else if (route === "noglasses") runNoGlasses();
    else if (route === "tired") tired();
    else if (route === "comfort") runComfort();
    else if (["results", "prescription", "profile"].includes(route) && resNow().size) results();
    else welcome();
  })();

  ES.app = { state, welcome, start, runMain, results, runNight, runNoGlasses, runComfort, tired, runTiredCheck };
})(window.ES);
