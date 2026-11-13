/* Screen setup, once per screen:
   1. Checklist (usual glasses, screen brightness all the way up, filters off, zoom 100%).
   2. Card match: tells EyeScore how many pixels make a millimeter on this screen.
   3. Red dot (blind spot): tells EyeScore how far away you sit. Method after Li et al. 2020
      ("Virtual Chinrest", Scientific Reports), changed so nothing moves on its own: you move the
      dot yourself with the arrow keys and press Enter when it disappears. A typed distance
      (tape measure) is the fallback.
   Results are stored per screen, keyed by the screen's size in CSS pixels. */
(function (ES) {
  "use strict";
  const { h, store, keys, median } = ES;

  const CARD_W_MM = 85.6,
    CARD_H_MM = 53.98;
  const BLIND_SPOT_DEG = 13.5; // Li et al. 2020; varies 11.5-16° between people

  const screenKey = () => `${screen.width}x${screen.height}`;
  const isAutoName = (n) =>
    /^(Laptop|Monitor|This screen|Phone or tablet) \(\d+×\d+\)$/.test(n || "");
  // Default name; the user can rename it. Guessing "Laptop" or "Monitor" from the pixel ratio is
  // unreliable when browser zoom isn't 100%.
  function defaultName() {
    const k = `${screen.width}×${screen.height}`;
    return ES.isTouch ? `Phone or tablet (${k})` : `This screen (${k})`;
  }

  /* Browser zoom check. Inside the extension we can read the real zoom; on the website we can only
     guess from a fractional pixel ratio (e.g. 1.8 on a Retina screen at 90%). */
  async function zoomLevel() {
    try {
      if (ES.isExtensionPage && chrome.tabs && chrome.tabs.getCurrent) {
        const tab = await chrome.tabs.getCurrent();
        if (tab && tab.id !== undefined)
          return { zoom: await chrome.tabs.getZoom(tab.id), tabId: tab.id, exact: true };
      }
    } catch (e) {
      /* fall through */
    }
    const dpr = window.devicePixelRatio || 1;
    return { zoom: Math.abs(dpr - Math.round(dpr)) > 0.01 ? null : 1, exact: false, dpr };
  }

  // Older auto-generated names ("Monitor (...)", "Laptop (...)") are shown as the plain default instead.
  function all() {
    const a = store.get("screens", {}) || {};
    for (const r of Object.values(a))
      if (r && isAutoName(r.name)) r.name = `This screen (${r.w}×${r.h})`;
    return a;
  }
  const get = (key = screenKey()) => all()[key] || null;
  function save(rec) {
    const a = all();
    a[rec.key] = rec;
    store.set("screens", a);
  }

  /* Visual angle helpers for a calibrated screen. */
  const mmFromCss = (px, rec) => px / rec.pxPerMm;
  const arcminFromCss = (px, rec) =>
    ((Math.atan(mmFromCss(px, rec) / rec.distanceMm) * 180) / Math.PI) * 60;

  /* ---------- 1. checklist ---------- */
  function checklist(root, rec) {
    return new Promise((resolve) => {
      const name = h("input", {
        type: "text",
        value: rec && rec.name && !isAutoName(rec.name) ? rec.name : defaultName(),
        "aria-label": "Name for this screen",
        class: "text-input",
        placeholder: "e.g. MacBook Air",
      });
      const zoomNote = h("div");
      zoomLevel().then((z) => {
        if (z.exact && Math.abs(z.zoom - 1) > 0.01) {
          zoomNote.replaceChildren(
            h(
              "p",
              { class: "small callout warn" },
              `Browser zoom is ${Math.round(z.zoom * 100)}% on this page. The tests need 100%. `,
              h(
                "button",
                {
                  class: "btn btn-small",
                  onclick: async () => {
                    await chrome.tabs.setZoom(z.tabId, 1);
                    location.reload();
                  },
                },
                "Set zoom to 100%",
              ),
            ),
          );
        } else if (!z.exact && z.zoom === null) {
          zoomNote.replaceChildren(
            h(
              "p",
              { class: "small callout warn" },
              "Browser zoom might not be 100%. Press ",
              h("span", { class: "kbd" }, "⌘"),
              " or ",
              h("span", { class: "kbd" }, "Ctrl"),
              " + ",
              h("span", { class: "kbd" }, "0"),
              " to reset it, then reload.",
            ),
          );
        }
      });
      const go = () => {
        keys.clear();
        resolve(name.value.trim().slice(0, 40) || defaultName());
      };
      root.replaceChildren(
        h(
          "div",
          { class: "card narrow" },
          h("div", { class: "eyebrow" }, "Screen setup · 1 of 3"),
          h("h2", null, "Get set up"),
          h(
            "p",
            { class: "muted" },
            "EyeScore measures you on this screen, at your usual distance, so the results fit how you actually read.",
          ),
          h(
            "ul",
            { class: "checklist" },
            h(
              "li",
              null,
              h("strong", null, "Screen brightness all the way up. "),
              "Every test runs at full brightness, so results compare from day to day. EyeScore dims pages itself when needed.",
            ),
            h("li", null, "Wear the glasses or contacts you normally use at this screen."),
            h("li", null, "Sit at your normal distance and stay there for the whole test."),
            h("li", null, "Turn off Night Shift, True Tone and blue-light filters for now."),
            h(
              "li",
              null,
              "Browser zoom at 100% (",
              h("span", { class: "kbd" }, "Ctrl"),
              " or ",
              h("span", { class: "kbd" }, "⌘"),
              " + ",
              h("span", { class: "kbd" }, "0"),
              ").",
            ),
          ),
          zoomNote,
          h("label", { class: "field" }, h("span", { class: "small" }, "Name this screen"), name),
          h(
            "p",
            { class: "tiny" },
            "Results are saved for this screen. Set up each screen you read on (laptop, monitor) separately.",
          ),
          h(
            "div",
            { class: "row end" },
            h("button", { class: "btn btn-primary btn-lg", onclick: go }, "Next"),
          ),
        ),
      );
      keys.set((e) => {
        if (e.key === "Enter" && document.activeElement !== name) {
          go();
          return true;
        }
        return false;
      });
    });
  }

  /* ---------- 2. card match ---------- */
  function cardStep(root, startPxPerMm) {
    return new Promise((resolve) => {
      let widthPx = Math.round((startPxPerMm || 4.4) * CARD_W_MM);
      const outline = h("div", { class: "card-outline" });
      const slider = h("input", {
        type: "range",
        min: 150,
        max: 800,
        step: 1,
        value: widthPx,
        "aria-label": "Card outline size",
      });
      const sync = () => {
        outline.style.width = widthPx + "px";
        outline.style.height = Math.round((widthPx * CARD_H_MM) / CARD_W_MM) + "px";
        slider.value = widthPx;
      };
      slider.addEventListener("input", () => {
        widthPx = +slider.value;
        sync();
      });
      const done = (ok) => {
        keys.clear();
        resolve(ok ? widthPx / CARD_W_MM : null);
      };
      keys.set((e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          widthPx = Math.min(800, widthPx + 1);
          sync();
          return true;
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          widthPx = Math.max(150, widthPx - 1);
          sync();
          return true;
        }
        if (e.key === "Enter") {
          done(true);
          return true;
        }
        return false;
      });
      root.replaceChildren(
        h(
          "div",
          { class: "card narrow" },
          h("div", { class: "eyebrow" }, "Screen setup · 2 of 3"),
          h("h2", null, "Match a card to your screen"),
          h(
            "p",
            { class: "muted" },
            "Hold any bank card, library card or ID flat against the screen. Move the slider until the blue outline is exactly the size of the card.",
          ),
          outline,
          slider,
          h(
            "p",
            { class: "tiny" },
            "Arrow keys fine-tune by one pixel. Press Enter when it matches.",
          ),
          h(
            "div",
            { class: "row end" },
            h(
              "button",
              { class: "btn btn-ghost", onclick: () => done(false) },
              "I don't have a card",
            ),
            h("button", { class: "btn btn-primary", onclick: () => done(true) }, "It matches"),
          ),
        ),
      );
      sync();
    });
  }

  /* ---------- 3. distance: self-paced red dot ---------- */
  function typedDistance(root, note) {
    return new Promise((resolve) => {
      const input = h("input", {
        type: "number",
        min: 20,
        max: 150,
        step: 1,
        value: 55,
        class: "text-input",
        "aria-label": "Distance in centimeters",
        style: { maxWidth: "120px" },
      });
      const go = () => {
        const cm = parseFloat(input.value);
        if (cm >= 20 && cm <= 150) {
          keys.clear();
          resolve({ distanceMm: cm * 10, method: "typed" });
        }
      };
      root.replaceChildren(
        h(
          "div",
          { class: "card narrow" },
          h("div", { class: "eyebrow" }, "Screen setup · 3 of 3"),
          h("h2", null, "How far away do you sit?"),
          note ? h("p", { class: "muted" }, note) : null,
          h(
            "p",
            { class: "muted" },
            "Measure from your eyes to the screen with a tape measure or ruler, sitting the way you normally do.",
          ),
          h("label", { class: "field" }, h("span", { class: "small" }, "Distance (cm)"), input),
          h(
            "div",
            { class: "row end" },
            h("button", { class: "btn btn-primary", onclick: go }, "Save"),
          ),
        ),
      );
      input.focus();
      keys.set((e) => {
        if (e.key === "Enter") {
          go();
          return true;
        }
        return false;
      });
    });
  }

  function blindSpot(root, pxPerMm) {
    if (window.innerWidth < 760 || ES.isTouch)
      return typedDistance(root, "This window is too narrow for the red-dot method.");
    return new Promise((resolve) => {
      const stage = h("div", { class: "stage blindspot-stage" });
      const status = h("p", { class: "small center", style: { margin: "12px 0 0" } });
      const samples = [];
      let sqX = 0,
        dotX = 0,
        square,
        dot;
      const STEP_MM = 1.5,
        FINE_MM = 0.5;
      function layout() {
        stage.replaceChildren();
        const w = stage.clientWidth;
        sqX = w - 50;
        square = h("div", { class: "bs-square", style: { left: sqX - 12 + "px" } });
        dot = h("div", { class: "bs-dot" });
        stage.append(square, dot);
        dotX = sqX - 40;
        place();
      }
      const place = () => {
        dot.style.left = dotX + "px";
      };
      function mark() {
        const dPx = sqX - dotX;
        const dist = dPx / pxPerMm / Math.tan((BLIND_SPOT_DEG * Math.PI) / 180);
        if (dist < 200 || dist > 1300) {
          status.textContent =
            "That reading looks off. Make sure your right eye is covered and you're looking at the black square. Let's do that one again.";
        } else {
          samples.push(dist);
          if (samples.length >= 3) {
            keys.clear();
            resolve({ distanceMm: median(samples), method: "blindspot", samples });
            return;
          }
          status.textContent = `Got it (${samples.length} of 3). The dot is back at the start. Do it again the same way.`;
        }
        dotX = sqX - 40;
        place();
      }
      const move = (mm) => {
        dotX = Math.max(10, Math.min(sqX - 20, dotX - mm * pxPerMm));
        place();
      };
      keys.set((e) => {
        if (e.key === "ArrowLeft") {
          move(e.shiftKey ? FINE_MM : STEP_MM);
          return true;
        }
        if (e.key === "ArrowRight") {
          move(-(e.shiftKey ? FINE_MM : STEP_MM));
          return true;
        }
        if (e.key === "Enter") {
          mark();
          return true;
        }
        return false;
      });
      root.replaceChildren(
        h(
          "div",
          { class: "card" },
          h("div", { class: "eyebrow" }, "Screen setup · 3 of 3"),
          h("h2", null, "Find your viewing distance"),
          h(
            "p",
            { class: "muted" },
            "Sit how you normally do. Cover your right eye and keep your left eye on the black square. Press ",
            h("span", { class: "kbd" }, "←"),
            " to move the red dot left, a little at a time. The moment it disappears completely (that's your blind spot, everyone has one), press ",
            h("span", { class: "kbd" }, "Enter"),
            ". Nothing moves on its own; take your time. We'll do this 3 times.",
          ),
          stage,
          status,
          h(
            "p",
            { class: "tiny" },
            "Hold Shift with the arrow keys for smaller steps. Went too far? ",
            h("span", { class: "kbd" }, "→"),
            " moves it back.",
          ),
          h(
            "div",
            { class: "row end" },
            h(
              "button",
              {
                class: "btn btn-ghost",
                onclick: () => {
                  keys.clear();
                  typedDistance(root).then(resolve);
                },
              },
              "Type my distance instead",
            ),
            h("button", { class: "btn", onclick: () => move(STEP_MM) }, "←"),
            h("button", { class: "btn", onclick: () => move(-STEP_MM) }, "→"),
            h("button", { class: "btn btn-primary", onclick: mark }, "It disappeared"),
          ),
        ),
      );
      requestAnimationFrame(layout);
    });
  }

  async function run(root) {
    const prev = get();
    const name = await checklist(root, prev);
    const pxPerMm = await cardStep(root, prev && prev.pxPerMm);
    const ppm =
      pxPerMm || (prev && prev.pxPerMm) || ((window.devicePixelRatio || 1) >= 2 ? 4.9 : 3.8);
    const d = await blindSpot(root, ppm);
    const rec = {
      key: screenKey(),
      name,
      at: new Date().toISOString(),
      pxPerMm: +ppm.toFixed(4),
      cardMatched: !!pxPerMm,
      distanceMm: Math.round(d.distanceMm),
      distanceMethod: d.method,
      dpr: +(window.devicePixelRatio || 1).toFixed(2),
      w: screen.width,
      h: screen.height,
    };
    save(rec);
    return rec;
  }

  ES.calib = {
    run,
    get,
    all,
    save,
    screenKey,
    defaultName,
    zoomLevel,
    arcminFromCss,
    mmFromCss,
    BLIND_SPOT_DEG,
  };
})(window.ES);
