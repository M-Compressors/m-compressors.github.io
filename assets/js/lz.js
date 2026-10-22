// Runs a greedy LZ77 pass over the home page heading and shows the result:
// repeated text is replaced by a copy token (distance back, length).
// The heading's text stays in the DOM, so crawlers and screen readers read it unchanged.
(function () {
  "use strict";

  var MIN_MATCH = 5;
  var heading = document.querySelector("[data-lz]");
  if (!heading) return;

  var text = heading.textContent.replace(/\s+/g, " ").trim();
  var bytes = new TextEncoder().encode(text).length;

  // Greedy LZ77 with an unbounded window: at each position take the longest
  // earlier match of at least MIN_MATCH characters, otherwise emit a literal.
  function lz77(s) {
    var out = [];
    var i = 0;
    while (i < s.length) {
      var bestLen = 0;
      var bestDist = 0;
      for (var j = 0; j < i; j++) {
        var len = 0;
        while (i + len < s.length && s[j + len] === s[i + len]) len++;
        if (len > bestLen) {
          bestLen = len;
          bestDist = i - j;
        }
      }
      if (bestLen >= MIN_MATCH) {
        out.push({ match: true, at: i, dist: bestDist, len: bestLen });
        i += bestLen;
      } else {
        var last = out[out.length - 1];
        if (last && !last.match) last.len++;
        else out.push({ match: false, at: i, len: 1 });
        i++;
      }
    }
    return out;
  }

  var tokens = lz77(text);
  var matches = tokens.filter(function (t) { return t.match; });
  if (!matches.length) return;

  // Split literal runs where a match's source starts or ends, so the source
  // can be highlighted when its copy token is hovered.
  var cuts = {};
  matches.forEach(function (m) {
    cuts[m.at - m.dist] = true;
    cuts[m.at - m.dist + m.len] = true;
  });

  function span(cls, content) {
    var el = document.createElement("span");
    el.className = cls;
    el.textContent = content;
    return el;
  }

  var frag = document.createDocumentFragment();
  tokens.forEach(function (t) {
    if (!t.match) {
      var start = t.at;
      for (var k = t.at + 1; k <= t.at + t.len; k++) {
        if (k === t.at + t.len || cuts[k]) {
          var piece = span("lz-lit", text.slice(start, k));
          piece.dataset.from = start;
          piece.dataset.to = k;
          frag.appendChild(piece);
          start = k;
        }
      }
      return;
    }
    var wrap = document.createElement("span");
    wrap.className = "lz-match";
    wrap.dataset.src = t.at - t.dist;
    wrap.dataset.len = t.len;
    wrap.appendChild(span("lz-text", text.slice(t.at, t.at + t.len)));
    var tok = span("lz-tok", t.dist + "," + t.len);
    tok.setAttribute("aria-hidden", "true");
    tok.title = "Go back " + t.dist + " characters and copy " + t.len;
    wrap.appendChild(tok);
    frag.appendChild(wrap);
  });

  heading.textContent = "";
  heading.appendChild(frag);
  heading.classList.add("lz-ready");

  function highlight(wrap, on) {
    var from = +wrap.dataset.src;
    var to = from + +wrap.dataset.len;
    heading.querySelectorAll(".lz-lit").forEach(function (el) {
      var inside = +el.dataset.from >= from && +el.dataset.to <= to;
      el.classList.toggle("lz-source", on && inside);
    });
    wrap.classList.toggle("lz-active", on);
  }

  heading.querySelectorAll(".lz-match").forEach(function (wrap) {
    wrap.addEventListener("mouseenter", function () { highlight(wrap, true); });
    wrap.addEventListener("mouseleave", function () { highlight(wrap, false); });
  });

  var literals = tokens.reduce(function (n, t) { return t.match ? n : n + t.len; }, 0);
  var copied = text.length - literals;
  var first = matches[0];

  var controls = document.querySelector("[data-lz-controls]");
  var caption = document.querySelector("[data-lz-caption]");
  var toggle = document.querySelector("[data-lz-toggle]");

  var packedText =
    "LZ77 ran on this heading in your browser: " + copied + " of its " + bytes +
    " characters are copies of text it already contains. A box like " + first.dist + "," +
    first.len + " means go back " + first.dist + " characters and copy " + first.len + ".";
  var plainText = "The heading as written: " + bytes + " bytes.";

  function setPacked(packed) {
    heading.classList.toggle("lz-packed", packed);
    heading.classList.remove("lz-marking");
    caption.textContent = packed ? packedText : plainText;
    toggle.textContent = packed ? "Decompress" : "Compress";
  }

  controls.hidden = false;
  caption.textContent = plainText;
  toggle.textContent = "Compress";
  toggle.addEventListener("click", function () {
    setPacked(!heading.classList.contains("lz-packed"));
  });

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    setPacked(true);
    return;
  }

  // One orchestrated moment on load: mark the repeats, then fold them into tokens.
  setTimeout(function () {
    heading.classList.add("lz-marking");
    matches.forEach(function (m, n) {
      var wrap = heading.querySelectorAll(".lz-match")[n];
      highlight(wrap, true);
      setTimeout(function () { highlight(wrap, false); }, 900);
    });
  }, 700);
  setTimeout(function () { setPacked(true); }, 1700);
})();
