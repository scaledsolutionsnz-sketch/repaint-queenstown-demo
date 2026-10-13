/* Repaint Queenstown — site script */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* The CMS editor (assets/cms.js, ?cms=edit) puts .cms-on on <html>. While it
     is on, the automatic rotations hold still so the thing being edited stays
     in view. assets/cms.js also fires "cms:applied" whenever it changes the
     page; the handlers below re-sync whatever this script derives from it. */
  var editing = function () {
    return document.documentElement.classList.contains("cms-on");
  };
  var onCms = function (fn) { document.addEventListener("cms:applied", fn); };

  /* ---------- Opening animation ---------- */
  var intro = document.getElementById("intro");
  if (intro) {
    document.body.classList.add("intro-lock");
    var close = function () {
      document.body.classList.add("intro-done");
      document.body.classList.remove("intro-lock");
      window.setTimeout(function () {
        if (intro && intro.parentNode) intro.parentNode.removeChild(intro);
      }, 700);
    };
    window.setTimeout(close, reduceMotion ? 150 : 1250);
  }

  /* ---------- Nav ---------- */
  var nav = document.querySelector(".nav");
  var toggle = document.querySelector(".nav-toggle");
  var menu = document.querySelector(".mobile-menu");

  var onScroll = function () {
    if (!nav) return;
    if (window.scrollY > 40) nav.classList.add("is-solid");
    else nav.classList.remove("is-solid");
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var open = menu.classList.toggle("is-open");
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    menu.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        menu.classList.remove("is-open");
        toggle.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---------- Hero rotation ---------- */
  var slides = Array.prototype.slice.call(document.querySelectorAll(".hero-slide"));
  var dots = Array.prototype.slice.call(document.querySelectorAll(".hero-dots button"));
  /* The dots always work; only the automatic advance is skipped under reduced
     motion. (The CMS editor relies on the dots to reach photos 2 and 3.) */
  if (slides.length > 1) {
    var index = 0;
    var timer = null;
    var show = function (next) {
      slides[index].classList.remove("is-active");
      if (dots[index]) dots[index].classList.remove("is-active");
      index = (next + slides.length) % slides.length;
      slides[index].classList.add("is-active");
      if (dots[index]) dots[index].classList.add("is-active");
    };
    var start = function () {
      if (reduceMotion) return;
      timer = window.setInterval(function () { if (!editing()) show(index + 1); }, 5500);
    };
    dots.forEach(function (dot, i) {
      dot.addEventListener("click", function () {
        window.clearInterval(timer);
        show(i);
        start();
      });
    });
    start();
  }

  /* ---------- Scroll reveal ---------- */
  var revealables = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if (revealables.length) {
    if ("IntersectionObserver" in window && !reduceMotion) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
      revealables.forEach(function (el, i) {
        el.style.transitionDelay = (i % 4) * 70 + "ms";
        io.observe(el);
      });
    } else {
      revealables.forEach(function (el) { el.classList.add("is-in"); });
    }
  }

  /* ---------- Marquee ---------- */
  /* Words come from the track's data-words (one per line, editable in the
     CMS); the list here is only the fallback. */
  var track = document.getElementById("marquee-track");
  if (track) {
    var fallbackWords = ["Exterior repaints", "Interior repaints", "Cedar staining", "Decks & fences",
                         "Queenstown", "Fernhill", "Frankton",
                         "Lake Hayes", "Arrowtown", "Jack's Point"];
    var escapeHtml = function (t) {
      return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    };
    var strip = track.parentNode;
    var builtFrom = null;
    // The animation slides the track by half its width, so each half has to
    // be at least as wide as the strip or the end of every loop shows a gap.
    var covers = function () { return track.scrollWidth / 2 >= strip.clientWidth; };
    var buildMarquee = function () {
      var raw = track.getAttribute("data-words");
      if (raw === builtFrom && covers()) return;
      builtFrom = raw;
      var words = (raw || "").split("\n").map(function (w) { return w.trim(); })
        .filter(function (w) { return w; });
      if (!words.length) words = fallbackWords;
      // A short list is repeated so the strip still runs edge to edge.
      var base = words;
      while (words.length < fallbackWords.length) words = words.concat(base);
      var render = function () {
        var half = words.map(function (w) { return "<span><i>/</i>" + escapeHtml(w) + "</span>"; }).join("");
        track.innerHTML = half + half;
      };
      render();
      for (var n = 0; n < 50 && !covers(); n++) {
        words = words.concat(base);
        render();
      }
    };
    buildMarquee();
    onCms(buildMarquee);
    // Re-check once the web font is in (it sets the width) and on resize.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(buildMarquee);
    window.addEventListener("resize", buildMarquee, { passive: true });
  }

  /* ---------- Services index: one row lights up, the image follows ---------- */
  var rows = Array.prototype.slice.call(document.querySelectorAll(".service-row"));
  var shots = Array.prototype.slice.call(document.querySelectorAll("#service-media img"));
  var caption = document.getElementById("service-caption");
  if (rows.length && shots.length) {
    var pick = function (row) {
      var i = parseInt(row.getAttribute("data-img"), 10) || 0;
      rows.forEach(function (r) {
        var on = r === row;
        r.classList.toggle("is-active", on);
        r.setAttribute("aria-expanded", on ? "true" : "false");
      });
      shots.forEach(function (img, n) { img.classList.toggle("is-active", n === i); });
      var heading = row.querySelector("h3");
      if (caption && heading) caption.textContent = heading.textContent;
    };
    rows.forEach(function (row) {
      row.addEventListener("click", function () { pick(row); });
      row.addEventListener("mouseenter", function () { pick(row); });
      row.addEventListener("focus", function () { pick(row); });
    });
    // The caption mirrors the active heading, so follow edits to it.
    onCms(function () {
      var active = rows.filter(function (r) { return r.classList.contains("is-active"); })[0] || rows[0];
      var heading = active.querySelector("h3");
      if (caption && heading && caption.textContent !== heading.textContent) {
        caption.textContent = heading.textContent;
      }
    });
  }

  /* ---------- Gallery filters ---------- */
  var filters = Array.prototype.slice.call(document.querySelectorAll(".filter-btn"));
  var shotsAll = Array.prototype.slice.call(document.querySelectorAll("#gallery figure"));
  if (filters.length && shotsAll.length) {
    filters.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var want = btn.getAttribute("data-filter");
        filters.forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        shotsAll.forEach(function (fig) {
          fig.hidden = !(want === "all" || fig.getAttribute("data-cat") === want);
        });
      });
    });
  }

  /* ---------- Lightbox ---------- */
  var box = document.getElementById("lightbox");
  var boxImg = document.getElementById("lightbox-img");
  var boxCap = document.getElementById("lightbox-cap");
  var boxClose = document.getElementById("lightbox-close");
  if (box && boxImg) {
    var openBox = function (fig) {
      var img = fig.querySelector("img");
      var cap = fig.querySelector("figcaption");
      if (!img) return;
      boxImg.src = img.getAttribute("src");
      boxImg.alt = img.getAttribute("alt") || "";
      if (boxCap) boxCap.textContent = cap ? cap.textContent : "";
      box.classList.add("is-open");
      document.body.style.overflow = "hidden";
      if (boxClose) boxClose.focus();
    };
    var closeBox = function () {
      box.classList.remove("is-open");
      document.body.style.overflow = "";
      boxImg.removeAttribute("src");
    };
    shotsAll.forEach(function (fig) {
      fig.addEventListener("click", function () { openBox(fig); });
    });
    box.addEventListener("click", function (e) { if (e.target !== boxImg) closeBox(); });
    if (boxClose) boxClose.addEventListener("click", closeBox);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && box.classList.contains("is-open")) closeBox();
    });
  }

  /* ---------- Hero review rotation ---------- */
  /* Reviews come from data-reviews, one per line as  quote | name  (editable
     in the CMS); the list here is only the fallback. */
  var rot = document.querySelector("[data-review-rotator]");
  var rq = rot && rot.querySelector(".rb-quote");
  var rw = rot && rot.querySelector(".rb-who");
  if (rot && rq && rw) {
    var fallbackReviews = [
      { q: '"Sam painted our door and did a fantastic job. Highly recommend!"', w: "Annekarien \u00b7 Google review" },
      { q: '"He never fails to deliver, and is great to communicate with."', w: "Liz Lane \u00b7 Google review" },
      { q: '"Beautifully and neatly painted. Turned up on time."', w: "Chris Bishop \u00b7 Google review" },
      { q: '"We needed someone we could trust as we were living overseas."', w: "Catherine Barrette \u00b7 Google review" }
    ];
    var heroReviews = function () {
      var list = (rot.getAttribute("data-reviews") || "").split("\n").map(function (line) {
        var cut = line.indexOf("|");
        return cut < 0 ? { q: line.trim(), w: "" }
                       : { q: line.slice(0, cut).trim(), w: line.slice(cut + 1).trim() };
      }).filter(function (r) { return r.q; });
      return list.length ? list : fallbackReviews;
    };
    var ri = 0;
    var paintReview = function () {
      var list = heroReviews();
      ri = ri % list.length;
      if (rq.textContent !== list[ri].q) rq.textContent = list[ri].q;
      if (rw.textContent !== list[ri].w) rw.textContent = list[ri].w;
    };
    if (!reduceMotion) {
      window.setInterval(function () {
        if (editing()) return;
        rot.classList.add("fading");
        window.setTimeout(function () {
          ri = (ri + 1) % heroReviews().length;
          paintReview();
          rot.classList.remove("fading");
        }, 450);
      }, 6000);
    }
    onCms(paintReview);
  }

  /* ---------- Gmail compose links (address assembled in JS) ---------- */
  /* A link the CMS has given its own href is left alone; only links still
     pointing at "#" are built. */
  var wireGmail = function () {
    document.querySelectorAll("a[data-gmail]").forEach(function (a) {
      var current = a.getAttribute("href");
      if (current && current !== "#") return;
      var to = a.getAttribute("data-user") + "@" + a.getAttribute("data-domain");
      a.href =
        "https://mail.google.com/mail/?view=cm&fs=1&to=" +
        encodeURIComponent(to) +
        "&su=" + (a.getAttribute("data-su") || "") +
        "&body=" + (a.getAttribute("data-body") || "");
      a.target = "_blank";
      a.rel = "noopener";
    });
  };
  wireGmail();
  onCms(wireGmail);

  /* ---------- Current year ---------- */
  /* Re-run after CMS edits too: a saved footer line carries the year it was
     saved in. */
  var fillYear = function () {
    var year = String(new Date().getFullYear());
    document.querySelectorAll("[data-year]").forEach(function (el) {
      if (el.textContent !== year) el.textContent = year;
    });
  };
  fillYear();
  onCms(fillYear);
})();
