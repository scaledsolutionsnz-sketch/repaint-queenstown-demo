/* Repaint Queenstown — site script */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  if (slides.length > 1 && !reduceMotion) {
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
      timer = window.setInterval(function () { show(index + 1); }, 5500);
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
  var track = document.getElementById("marquee-track");
  if (track) {
    var words = ["Exterior repaints", "Interior repaints", "Cedar staining", "Decks & fences",
                 "Queenstown", "Fernhill", "Frankton",
                 "Lake Hayes", "Arrowtown", "Jack's Point"];
    var half = words.map(function (w) { return '<span><i>/</i>' + w + "</span>"; }).join("");
    track.innerHTML = half + half;
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
  var rot = document.querySelector("[data-review-rotator]");
  if (rot && !reduceMotion) {
    var heroReviews = [
      { q: '"Washed it right back and it honestly looks like a different house."', w: "Hannah M. \u00b7 example review" },
      { q: '"Quote in writing the same week and the price didn\u0027t move."', w: "Dave R. \u00b7 example review" },
      { q: '"Worked around the holiday-house bookings without us losing a night."', w: "Priya S. \u00b7 example review" },
      { q: '"Careful with an awkward old cottage, swept and tidy every evening."', w: "Tom W. \u00b7 example review" }
    ];
    var rq = rot.querySelector(".rb-quote");
    var rw = rot.querySelector(".rb-who");
    var ri = 0;
    window.setInterval(function () {
      rot.classList.add("fading");
      window.setTimeout(function () {
        ri = (ri + 1) % heroReviews.length;
        rq.textContent = heroReviews[ri].q;
        rw.textContent = heroReviews[ri].w;
        rot.classList.remove("fading");
      }, 450);
    }, 6000);
  }

  /* ---------- Gmail compose links (address assembled in JS) ---------- */
  document.querySelectorAll("a[data-gmail]").forEach(function (a) {
    var to = a.getAttribute("data-user") + "@" + a.getAttribute("data-domain");
    a.href =
      "https://mail.google.com/mail/?view=cm&fs=1&to=" +
      encodeURIComponent(to) +
      "&su=" + (a.getAttribute("data-su") || "") +
      "&body=" + (a.getAttribute("data-body") || "");
    a.target = "_blank";
    a.rel = "noopener";
  });

  /* ---------- Current year ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
