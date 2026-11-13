// Runs before the page paints (classic script in <head>): applies the saved colour scheme from the last visit,
// so a non-amber theme doesn't flash amber first. prefs.js keeps amber.themeVars up to date.
(function () {
  try {
    var s = JSON.parse(localStorage.getItem("amber.themeVars") || "null");
    if (!s || !s.vars) return;
    for (var k in s.vars) if (/^--amber/.test(k)) document.documentElement.style.setProperty(k, s.vars[k]);
    if (s.title) document.title = s.title;
    if (s.name) document.addEventListener("DOMContentLoaded", function () {
      var l = document.querySelector(".brand .logo");
      if (l) l.textContent = s.name;
    });
  } catch (e) { /* no storage: defaults */ }
})();
