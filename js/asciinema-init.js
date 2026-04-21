// Auto-initialize asciinema players from <div class="cast" data-src="...">
document.addEventListener("DOMContentLoaded", function () {
  // Cache: src URL -> Promise<{ text, header, events, castCols }>
  var castCache = {};
  function loadCast(src) {
    if (!castCache[src]) {
      castCache[src] = fetch(src).then(function (r) { return r.text(); }).then(function (text) {
        var lines = text.trim().split("\n");
        var header = JSON.parse(lines[0]);
        var castCols = header.term ? header.term.cols : (header.width || 120);
        var events = lines.slice(1).map(JSON.parse);
        return { text: text, header: header, events: events, castCols: castCols };
      });
    }
    return castCache[src];
  }

  document.querySelectorAll("div.cast[data-src]").forEach(function (el) {
    var src = el.getAttribute("data-src");
    var opts = {};
    if (el.dataset.speed) opts.speed = parseFloat(el.dataset.speed);
    if (el.dataset.idleTimeLimit) opts.idleTimeLimit = parseFloat(el.dataset.idleTimeLimit);
    if (el.dataset.poster) opts.poster = el.dataset.poster;

    var startAt = el.dataset.startAt ? parseFloat(el.dataset.startAt) : null;
    var clipEnd = el.dataset.endAt ? parseFloat(el.dataset.endAt) : null;

    loadCast(src).then(function (cast) {
      var header = cast.header;
      var events = cast.events;
      var castCols = cast.castCols;
      var text = cast.text;
      var idleLimit = opts.idleTimeLimit || Infinity;

      // Player-displayed time is idle-capped cast time. asciinema-player's
      // startAt and npt posters are raw cast time (pre-cap). Convert so markup
      // can use the time shown in the scrubber.
      function playerToRaw(playerTime) {
        var raw = 0, capped = 0;
        for (var i = 0; i < events.length; i++) {
          var d = events[i][0];
          raw += d;
          capped += Math.min(d, idleLimit);
          if (capped >= playerTime) break;
        }
        return raw;
      }

      if (startAt !== null) opts.startAt = playerToRaw(startAt);
      if (opts.poster && opts.poster.indexOf("npt:") === 0) {
        opts.poster = "npt:" + playerToRaw(parseFloat(opts.poster.slice(4)));
      }

      if (clipEnd !== null) {
        var cum = 0;
        var trimmed = events.filter(function (e) {
          cum += Math.min(e[0], idleLimit);
          return cum <= clipEnd;
        });
        var data = JSON.stringify(header) + "\n" +
          trimmed.map(JSON.stringify).join("\n") + "\n";
        AsciinemaPlayer.create({ data: data }, el, opts);
      } else {
        AsciinemaPlayer.create({ data: text }, el, opts);
      }

      // Shrink font for wide casts so they don't overflow the container
      if (castCols > 120) {
        setTimeout(function () {
          var player = el.querySelector(".ap-player");
          if (!player) return;
          player.style.setProperty("font-size", "14.3px", "important");
        }, 100);
      }
    });
  }); // end forEach
}); // end DOMContentLoaded
