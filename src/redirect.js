/* The Korean page (the site root) sends a first-time visitor to en/. scripts/build.py inlines this file as the first script in its head. Plain ES5. */
(function () {
  if (/[?&]lang=ko(&|$)/.test(location.search)) return;  // the toggle's link: Korean was just chosen, even if storage is blocked
  var stored;
  try { stored = localStorage.getItem('nocturne.lang'); } catch (e) {}
  var language = (navigator.languages && navigator.languages[0]) || navigator.language || '';
  if (stored === 'en' || (!stored && !/^ko/i.test(language))) location.replace('en/' + location.hash);
})();
