// Classic (non-module) script so it still runs when the module graph cannot load, e.g. when the page is opened from file://.
(function () {
  function show() {
    var box = document.getElementById('runtime-warning');
    if (!box) return;
    box.hidden = false;
    var local = location.protocol === 'file:';
    box.querySelector('[data-http]').hidden = !local;
    box.querySelector('[data-retry]').hidden = local;
  }
  window.addEventListener('load', function () {
    if (document.documentElement.dataset.survReady !== 'true') show();
  });
  window.addEventListener('error', function () {
    if (document.documentElement.dataset.survReady !== 'true') show();
  });
})();
