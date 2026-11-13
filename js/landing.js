/* Home page behavior: the before/after demo in the hero, the rule demo, current-section highlighting in
   the nav, and the Chrome Web Store link (from config.js). Menus, hover and focus are handled by the
   shared scripts in assets/. */
(function () {
  "use strict";
  // Demo: the button shows the article as the site made it, and back.
  var btn = document.querySelector("[data-es-toggle]");
  var page = document.querySelector("[data-es-page]");
  var state = document.querySelector("[data-es-state]");
  if (btn && page) {
    btn.addEventListener("click", function () {
      var original = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(original));
      page.classList.toggle("is-original", original);
      btn.textContent = original ? "Show with EyeScore" : "Preview the original page";
      if (state) state.textContent = original ? "Paused" : "Active";
      if (state) state.classList.toggle("is-off", original);
    });
  }
  // Rule demo: the smallest E you can read sets the text minimum (x-height twice the E, shown as an
  // Arial-equivalent size, as on the results page; js/rx.js has the real rule).
  var rule = document.querySelector("[data-es-rule]");
  if (rule) {
    var XH = 0.519,
      TYP = 16 * XH;
    var range = rule.querySelector("input[type=range]");
    var q = function (k) {
      return rule.querySelector("[data-es-" + k + "]");
    };
    var eOut = q("e"),
      eSvg = q("e-svg"),
      minOut = q("min"),
      sample = q("sample"),
      verdict = q("verdict");
    var update = function () {
      var e = +range.value,
        xh = 2 * e,
        px = Math.round(xh / XH),
        reserve = TYP / e;
      eOut.textContent = e.toFixed(1) + "px";
      eSvg.style.width = eSvg.style.height = e + "px";
      minOut.textContent = px + "px";
      sample.style.fontSize = Math.max(16, px) + "px";
      verdict.textContent =
        xh > TYP + 0.05
          ? "Typical 16px text is only " +
            reserve.toFixed(1) +
            "\u00d7 your limit, so EyeScore enlarges it to " +
            px +
            "px."
          : "Typical 16px text is " +
            reserve.toFixed(1) +
            "\u00d7 your limit, past the 2\u00d7 the rule needs, so pages stay as they are.";
    };
    range.addEventListener("input", update);
    update();
  }
  // The bar marks the section in the middle of the screen (read on scroll, no observer).
  var links = Array.prototype.slice.call(
    document.querySelectorAll(".nav__links > .nav__item > .nav__link[href^='#']"),
  );
  var secs = Array.prototype.slice.call(
    document.querySelectorAll("main > section, footer.closing"),
  );
  if (links.length && secs.length) {
    var current = null,
      queued = false;
    var mark = function () {
      queued = false;
      var mid = window.innerHeight / 2,
        id = null;
      for (var i = 0; i < secs.length; i++) {
        var r = secs[i].getBoundingClientRect();
        if (r.top <= mid && r.bottom > mid) {
          id = secs[i].id || null;
          break;
        }
      }
      if (id === current) return;
      current = id;
      links.forEach(function (a) {
        if (a.getAttribute("href") === "#" + id) a.setAttribute("aria-current", "location");
        else a.removeAttribute("aria-current");
      });
    };
    window.addEventListener(
      "scroll",
      function () {
        if (!queued) {
          queued = true;
          requestAnimationFrame(mark);
        }
      },
      { passive: true },
    );
    mark();
  }
  // The store link replaces "See the extension" once there is one.
  var url = window.ES_CONFIG && window.ES_CONFIG.chromeStoreUrl;
  if (url) {
    document.querySelectorAll("[data-store-link]").forEach(function (a) {
      a.href = url;
      a.textContent = "Add to Chrome";
      a.target = "_blank";
      a.rel = "noopener";
    });
  }
})();
