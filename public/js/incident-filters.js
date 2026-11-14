// Client-side filtering of the incident list. Filters are mirrored in the URL query string.
(function () {
  var form = document.getElementById('filters');
  var items = Array.prototype.slice.call(document.querySelectorAll('#incident-list > li'));
  var count = document.getElementById('result-count');
  var empty = document.getElementById('no-results');
  if (!form) return;
  var fields = ['track', 'category', 'year', 'severity'];
  var params = new URLSearchParams(location.search);
  fields.forEach(function (f) { if (params.get(f)) form.elements[f].value = params.get(f); });

  function apply() {
    var shown = 0, q = new URLSearchParams();
    items.forEach(function (li) {
      var ok = fields.every(function (f) {
        var v = form.elements[f].value;
        return !v || li.getAttribute('data-' + f) === v;
      });
      li.hidden = !ok;
      if (ok) shown++;
    });
    fields.forEach(function (f) { if (form.elements[f].value) q.set(f, form.elements[f].value); });
    var qs = q.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    count.textContent = shown + ' of ' + items.length + ' incidents';
    empty.hidden = shown !== 0;
  }
  form.addEventListener('change', apply);
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  apply();
})();
