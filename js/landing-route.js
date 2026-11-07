/* The test used to live on this page (index.html#start, #results, ...). Those links, and an older
   extension's buttons, now go on to the test page. Runs before anything is drawn. */
(function () {
  var r = location.hash.replace("#", "");
  if (["start", "results", "prescription", "profile", "night", "noglasses", "tired", "comfort"].indexOf(r) >= 0) {
    location.replace("app.html" + location.hash);
  }
})();
