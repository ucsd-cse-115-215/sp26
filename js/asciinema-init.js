// Auto-initialize asciinema players from <div class="cast" data-src="...">
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("div.cast[data-src]").forEach(function (el) {
    var src = el.getAttribute("data-src");
    var opts = {};
    if (el.dataset.cols) opts.cols = parseInt(el.dataset.cols);
    if (el.dataset.rows) opts.rows = parseInt(el.dataset.rows);
    if (el.dataset.speed) opts.speed = parseFloat(el.dataset.speed);
    if (el.dataset.idleTimeLimit) opts.idleTimeLimit = parseFloat(el.dataset.idleTimeLimit);
    if (el.dataset.fit) opts.fit = el.dataset.fit;
    if (el.dataset.poster) opts.poster = el.dataset.poster;

    var clipStart = el.dataset.startAt ? parseFloat(el.dataset.startAt) : null;
    var clipEnd = el.dataset.endAt ? parseFloat(el.dataset.endAt) : null;

    if (clipStart !== null || clipEnd !== null) {
      fetch(src).then(function (r) { return r.text(); }).then(function (text) {
        var lines = text.trim().split("\n");
        var header = JSON.parse(lines[0]);
        var events = lines.slice(1).map(JSON.parse);

        // Build cumulative times
        var cum = 0;
        var times = events.map(function (e) { cum += e[0]; return cum; });

        // Find slice bounds
        var lo = 0, hi = events.length;
        if (clipStart !== null) {
          for (var i = 0; i < times.length; i++) {
            if (times[i] >= clipStart) { lo = i; break; }
          }
        }
        if (clipEnd !== null) {
          for (var i = 0; i < times.length; i++) {
            if (times[i] > clipEnd) { hi = i; break; }
          }
        }

        // Rebuild with relative deltas starting at 0
        var sliced = events.slice(lo, hi);
        var prev = times[lo];
        var rebuilt = sliced.map(function (e, i) {
          var idx = lo + i;
          var delta = i === 0 ? 0 : times[idx] - prev;
          prev = times[idx];
          return [Math.round(delta * 1000) / 1000, e[1], e[2]];
        });

        // Reassemble as text for the player
        var data = JSON.stringify(header) + "\n" +
          rebuilt.map(JSON.stringify).join("\n") + "\n";

        AsciinemaPlayer.create({ data: data }, el, opts);
      });
    } else {
      AsciinemaPlayer.create(src, el, opts);
    }
  });
});
