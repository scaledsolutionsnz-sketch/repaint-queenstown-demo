/* ==========================================================================
   Repaint Queenstown — content overlay + in-place editor
   --------------------------------------------------------------------------
   View mode  (every visitor): reads repaint_site_content from Supabase over
                               plain REST and applies it to [data-cms] elements.
                               No dependencies, ~2KB of work.
   Edit mode  (?cms=edit + a signed-in session): loads supabase-js, adds the
                               toolbar and the side panel, uploads images.

   Element contract, written by tools/annotate.py:
     data-cms          stable key, e.g. "index.services.h3_2"
     data-cms-type     text | textnodes | image | attr:<name>
     data-cms-href     the href of this link (or of the link this label sits
                       in) is editable: tel:, mailto: and Gmail compose links
     data-cms-label    optional field label for the editor panel

   After every apply this fires `cms:applied` on document, so script.js can
   re-sync anything it derives from the page (service caption, rotating
   reviews, marquee, year). The HTML is always the fallback.
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.CMS_CONFIG || {};
  var TABLE = 'repaint_site_content';
  var BUCKET = CFG.bucket || 'repaint-site-images';
  var CACHE_KEY = 'repaint.cms.v1';
  var PAGES = ['index.html', 'terms.html', 'privacy.html'];
  var SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

  var configured = !!(CFG.url && CFG.anonKey && !/PASTE_/.test(CFG.anonKey));
  var elCache = null;

  /* ---------------------------------------------------------------- utils */

  function nodes() {
    if (!elCache) {
      elCache = [].slice.call(document.querySelectorAll('[data-cms]'));
    }
    return elCache;
  }

  function typeOf(el) {
    return el.getAttribute('data-cms-type') || 'text';
  }

  /** The <a> whose href travels with this element's content, if any. */
  function linkOf(el) {
    if (el.tagName === 'A') return el;
    if (el.hasAttribute('data-cms-href') && el.closest) return el.closest('a[href]');
    return null;
  }

  function hrefOf(el) {
    var a = linkOf(el);
    return a ? a.getAttribute('href') : null;
  }

  function setHref(el, href) {
    var a = linkOf(el);
    if (a && href && a.getAttribute('href') !== href) a.setAttribute('href', href);
  }

  function setAttr(el, name, value) {
    if (value == null) return;
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  /** Direct (non-nested) text of an element, ignoring icon children. */
  function directText(el) {
    var out = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.nodeValue.trim()) out += n.nodeValue.trim() + ' ';
    }
    return out.trim();
  }

  /** Write text back into the first real text node, leaving icons intact and
      keeping the whitespace that spaced the words from the icons. */
  function setDirectText(el, value) {
    var first = null;
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      if (!first) {
        first = n;
        var lead = n.nodeValue.match(/^\s*/)[0];
        var trail = n.nodeValue.match(/\s*$/)[0];
        var next = lead + value + trail;
        if (n.nodeValue !== next) n.nodeValue = next;
      } else if (n.nodeValue) {
        n.nodeValue = '';
      }
    }
    if (!first) el.appendChild(document.createTextNode(value));
  }

  function notify(source) {
    var ev;
    try { ev = new CustomEvent('cms:applied', { detail: { source: source } }); }
    catch (e) {
      ev = document.createEvent('CustomEvent');
      ev.initCustomEvent('cms:applied', false, false, { source: source });
    }
    document.dispatchEvent(ev);
  }

  /* ------------------------------------------------------------- defaults */

  function snapshotDefaults() {
    nodes().forEach(function (el) {
      if (el.__cmsDefault) return;
      var t = typeOf(el);
      if (t === 'image') {
        el.__cmsDefault = {
          src: el.getAttribute('src'),
          srcset: el.getAttribute('srcset'),
          sizes: el.getAttribute('sizes'),
          alt: el.getAttribute('alt') || ''
        };
      } else if (t.indexOf('attr:') === 0) {
        el.__cmsDefault = { v: el.getAttribute(t.slice(5)) || '' };
      } else if (t === 'textnodes') {
        el.__cmsDefault = { v: directText(el), href: hrefOf(el) };
      } else {
        el.__cmsDefault = { v: el.innerHTML, href: hrefOf(el) };
      }
    });
  }

  /* -------------------------------------------------------------- applying */

  function applyOne(el, rec) {
    var t = typeOf(el);
    if (t === 'image') {
      if (rec.src && el.getAttribute('src') !== rec.src) {
        // A replacement is a single file, so a responsive set no longer
        // describes it. Drop srcset/sizes or the browser keeps the original.
        el.removeAttribute('srcset');
        el.removeAttribute('sizes');
        el.setAttribute('src', rec.src);
      }
      setAttr(el, 'alt', rec.alt);
      return;
    }
    if (t.indexOf('attr:') === 0) {
      setAttr(el, t.slice(5), rec.v);
      return;
    }
    if (rec.v != null) {
      if (t === 'textnodes') setDirectText(el, rec.v);
      else if (el.innerHTML !== rec.v) el.innerHTML = rec.v;
    }
    if (rec.href) setHref(el, rec.href);
  }

  function restoreDefault(el) {
    var d = el.__cmsDefault;
    if (!d) return;
    var t = typeOf(el);
    if (t === 'image') {
      if (d.src != null && el.getAttribute('src') !== d.src) {
        el.setAttribute('src', d.src);
        if (d.srcset) el.setAttribute('srcset', d.srcset); else el.removeAttribute('srcset');
        if (d.sizes) el.setAttribute('sizes', d.sizes); else el.removeAttribute('sizes');
      }
      setAttr(el, 'alt', d.alt);
    } else if (t.indexOf('attr:') === 0) {
      setAttr(el, t.slice(5), d.v);
    } else if (t === 'textnodes') {
      setDirectText(el, d.v);
      setHref(el, d.href);
    } else {
      if (el.innerHTML !== d.v) el.innerHTML = d.v;
      setHref(el, d.href);
    }
  }

  /**
   * @param {Object} map        key -> record
   * @param {boolean} authoritative  when true, keys absent from the map are
   *                                 reset to their HTML default (so deleting
   *                                 a row in Supabase really does revert).
   */
  function applyAll(map, authoritative, source) {
    nodes().forEach(function (el) {
      var rec = map[el.getAttribute('data-cms')];
      if (rec) applyOne(el, rec);
      else if (authoritative) restoreDefault(el);
    });
    document.documentElement.setAttribute('data-cms-ready', '1');
    notify(source);
  }

  /* ------------------------------------------------------------- transport */

  function rowsToMap(rows) {
    var m = {};
    (rows || []).forEach(function (r) { m[r.key] = r.data || {}; });
    return m;
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || null; }
    catch (e) { return null; }
  }

  function writeCache(map) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(map)); } catch (e) { /* private mode */ }
  }

  function fetchContent() {
    if (!configured) return Promise.resolve(null);
    return fetch(CFG.url + '/rest/v1/' + TABLE + '?select=key,data', {
      headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + CFG.anonKey },
      cache: 'no-store'
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) { return Array.isArray(rows) ? rows : null; })
      .catch(function () { return null; });
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    snapshotDefaults();

    var cached = readCache();
    if (cached) applyAll(cached, false, 'cache');   // instant, avoids the flash
    else document.documentElement.setAttribute('data-cms-ready', '1');

    fetchContent().then(function (rows) {
      if (rows) {
        var map = rowsToMap(rows);
        writeCache(map);
        applyAll(map, true, 'network');             // network wins
      }
      if (/[?&]cms=edit\b/.test(location.search)) startEditor();
    });
  }

  /* ==========================================================================
     Edit mode
     ========================================================================== */

  var sb = null;            // supabase client
  var pending = {};         // key -> record  (null means "reset to default")
  var current = null;       // element being edited
  var currentGroup = null;  // all fields in the open panel (the SEO pair)

  function loadSDK() {
    return new Promise(function (resolve, reject) {
      if (window.supabase && window.supabase.createClient) return resolve();
      var s = document.createElement('script');
      s.src = SDK;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load supabase-js')); };
      document.head.appendChild(s);
    });
  }

  function startEditor() {
    if (!configured) {
      alert('CMS is not configured yet. Fill in assets/cms-config.js first.');
      return;
    }
    loadSDK().then(function () {
      sb = window.supabase.createClient(CFG.url, CFG.anonKey);
      return sb.auth.getSession();
    }).then(function (res) {
      if (!res || !res.data || !res.data.session) {
        location.href = 'admin.html?next=' + encodeURIComponent(location.pathname + location.search);
        return;
      }
      injectEditorCSS();
      buildToolbar(res.data.session.user);
      armElements();
      notify('editor');
    }).catch(function (err) {
      alert('Editor failed to start: ' + err.message);
    });
  }

  function injectEditorCSS() {
    var css = [
      ':root{--cms-accent:#02abe7;--cms-accent-deep:#0289ba;--cms-ink:#191919;--cms-paper:#ecf3f7}',
      'html.cms-on{scroll-padding-top:140px}',
      'body.cms-on{padding-top:56px!important}',
      '.cms-bar{position:fixed;inset:0 0 auto 0;height:56px;z-index:2147483000;',
      '  background:var(--cms-ink);color:var(--cms-paper);display:flex;align-items:center;gap:14px;',
      '  padding:0 16px;font:500 14px/1.2 Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      '  box-shadow:0 2px 18px rgba(0,0,0,.28);overflow-x:auto;white-space:nowrap}',
      '.cms-bar__brand{font:700 15px/1 Outfit,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.01em;margin-right:4px}',
      '.cms-bar__brand span{color:var(--cms-accent)}',
      '.cms-bar__pages{display:flex;gap:10px;margin-left:6px}',
      '.cms-bar__pages a{color:rgba(236,243,247,.66);text-decoration:none;font-size:13px}',
      '.cms-bar__pages a:hover,.cms-bar__pages a.on{color:#fff}',
      '.cms-bar__sp{flex:1}',
      '.cms-bar__hint{color:rgba(236,243,247,.55);font-size:12.5px}',
      '.cms-btn{border:0;border-radius:4px;padding:9px 15px;font:600 13px/1 inherit;cursor:pointer;',
      '  background:rgba(236,243,247,.12);color:var(--cms-paper);transition:background .15s;flex:none}',
      '.cms-btn:hover{background:rgba(236,243,247,.2)}',
      '.cms-btn--go{background:var(--cms-accent);color:var(--cms-ink)}',
      '.cms-btn--go:hover{background:var(--cms-accent-deep);color:#fff}',
      '.cms-btn[disabled]{opacity:.45;cursor:default}',
      '[data-cms].cms-hot{outline:2px dashed rgba(2,137,186,.55);outline-offset:2px;cursor:pointer}',
      '[data-cms].cms-hot:hover{outline:2px solid var(--cms-accent-deep);background:rgba(2,171,231,.07)}',
      '[data-cms].cms-live{outline:2px solid #C27C0E!important}',
      '[data-cms].cms-sel{outline:3px solid var(--cms-accent-deep)!important;outline-offset:3px}',
      '.cms-panel{position:fixed;top:56px;right:0;bottom:0;width:380px;max-width:92vw;z-index:2147482999;',
      '  background:#fff;border-left:1px solid #D3DEE5;box-shadow:-18px 0 44px -30px rgba(25,25,25,.5);',
      '  display:flex;flex-direction:column;font:400 14px/1.5 Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      '  transform:translateX(100%);transition:transform .25s cubic-bezier(.16,1,.3,1)}',
      '.cms-panel.on{transform:none}',
      '.cms-panel__hd{padding:16px 18px 12px;border-bottom:1px solid #E3EBF0}',
      '.cms-panel__hd h3{margin:0 0 4px;font:700 15px/1.3 Outfit,-apple-system,"Segoe UI",sans-serif;color:var(--cms-ink);letter-spacing:0}',
      '.cms-panel__key{font:400 11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#7A858C;word-break:break-all}',
      '.cms-panel__bd{padding:16px 18px;overflow:auto;flex:1}',
      '.cms-panel__ft{padding:12px 18px;border-top:1px solid #E3EBF0;display:flex;gap:8px}',
      '.cms-f{margin-bottom:16px}',
      '.cms-f label{display:block;font:600 12px/1.4 inherit;color:#4A545B;margin-bottom:6px;',
      '  text-transform:uppercase;letter-spacing:.06em}',
      '.cms-f textarea,.cms-f input[type=text]{width:100%;box-sizing:border-box;border:1px solid #CBD7DF;border-radius:4px;',
      '  padding:10px 12px;font:400 14px/1.55 inherit;color:var(--cms-ink);background:#fff;resize:vertical}',
      '.cms-f textarea:focus,.cms-f input:focus{outline:2px solid var(--cms-accent-deep);outline-offset:-1px;border-color:transparent}',
      '.cms-f textarea{min-height:110px}',
      '.cms-drop{border:2px dashed #CBD7DF;border-radius:6px;padding:18px;text-align:center;color:#4A545B;cursor:pointer}',
      '.cms-drop.over{border-color:var(--cms-accent-deep);background:rgba(2,171,231,.06)}',
      '.cms-thumb{width:100%;border-radius:4px;border:1px solid #E3EBF0;margin-bottom:10px;display:block}',
      '.cms-note{font-size:12.5px;color:#7A858C;margin:-8px 0 14px}',
      '.cms-btn2{border:1px solid #CBD7DF;background:#fff;border-radius:4px;padding:9px 14px;',
      '  font:600 13px/1 inherit;color:var(--cms-ink);cursor:pointer}',
      '.cms-btn2:hover{border-color:var(--cms-ink)}',
      '.cms-btn2--warn{color:#9A3412;border-color:#F1C9B5}',
      '.cms-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483001;',
      '  background:var(--cms-ink);color:var(--cms-paper);padding:11px 18px;border-radius:999px;font:600 13px/1 Manrope,-apple-system,sans-serif;',
      '  opacity:0;transition:opacity .2s;pointer-events:none}',
      '.cms-toast.on{opacity:1}',
      /* Repaint layout in edit mode: keep the sticky nav and the mobile menu
         below the toolbar, and let clicks reach the photo that is actually on
         show in the stacked hero and services slides. */
      'body.cms-on .nav{top:56px}',
      '@media (max-width:760px){body.cms-on .mobile-menu{top:124px}}',
      'body.cms-on .hero-slide:not(.is-active),body.cms-on .service-media-frame img:not(.is-active){pointer-events:none}',
      'body.cms-on .marquee-track{animation-play-state:paused}',
      /* The open panel covers the right 380px; slide the hero dots clear of it. */
      '@media (min-width:720px){html.cms-panel-open .hero-dots{right:calc(380px + 24px)}}'
    ].join('');
    var s = document.createElement('style');
    s.id = 'cms-editor-css';
    s.textContent = css;
    document.head.appendChild(s);
    document.documentElement.classList.add('cms-on');
    document.body.classList.add('cms-on');
  }

  var bar, saveBtn, panel, toast;

  function buildToolbar(user) {
    bar = document.createElement('div');
    bar.className = 'cms-bar';
    var here = location.pathname.split('/').pop() || 'index.html';
    bar.innerHTML =
      '<div class="cms-bar__brand">Repaint <span>CMS</span></div>' +
      '<nav class="cms-bar__pages">' + PAGES.map(function (p) {
        return '<a href="' + p + '?cms=edit"' + (p === here ? ' class="on"' : '') + '>' +
          p.replace('.html', '') + '</a>';
      }).join('') + '</nav>' +
      '<span class="cms-bar__hint">Click any text or image to edit</span>' +
      '<div class="cms-bar__sp"></div>' +
      '<button class="cms-btn" id="cmsDiscard">Discard</button>' +
      '<button class="cms-btn cms-btn--go" id="cmsSave" disabled>Save</button>' +
      '<button class="cms-btn" id="cmsExit">Exit</button>' +
      '<button class="cms-btn" id="cmsOut">Sign out</button>';
    document.body.appendChild(bar);
    if (user && user.email) bar.querySelector('#cmsOut').setAttribute('title', user.email);

    saveBtn = bar.querySelector('#cmsSave');
    saveBtn.addEventListener('click', save);
    bar.querySelector('#cmsDiscard').addEventListener('click', discard);
    bar.querySelector('#cmsExit').addEventListener('click', function () {
      if (Object.keys(pending).length && !confirm('You have unsaved changes. Leave anyway?')) return;
      pending = {};
      location.href = location.pathname;
    });
    bar.querySelector('#cmsOut').addEventListener('click', function () {
      if (Object.keys(pending).length && !confirm('You have unsaved changes. Sign out anyway?')) return;
      pending = {};
      sb.auth.signOut().then(function () { location.href = location.pathname; });
    });

    panel = document.createElement('aside');
    panel.className = 'cms-panel';
    panel.innerHTML =
      '<div class="cms-panel__hd"><h3 id="cmsTitle">Nothing selected</h3>' +
      '<div class="cms-panel__key" id="cmsKey"></div></div>' +
      '<div class="cms-panel__bd" id="cmsBody"></div>' +
      '<div class="cms-panel__ft">' +
      '<button class="cms-btn2 cms-btn2--warn" id="cmsReset">Reset to original</button>' +
      '<div style="flex:1"></div>' +
      '<button class="cms-btn2" id="cmsClose">Close</button></div>';
    document.body.appendChild(panel);
    panel.querySelector('#cmsClose').addEventListener('click', closePanel);
    panel.querySelector('#cmsReset').addEventListener('click', resetCurrent);

    toast = document.createElement('div');
    toast.className = 'cms-toast';
    document.body.appendChild(toast);

    window.addEventListener('beforeunload', function (e) {
      if (Object.keys(pending).length) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function say(msg) {
    toast.textContent = msg;
    toast.classList.add('on');
    clearTimeout(say._t);
    say._t = setTimeout(function () { toast.classList.remove('on'); }, 2200);
  }

  function armElements() {
    nodes().forEach(function (el) {
      if (el.closest && el.closest('.cms-bar, .cms-panel')) return;
      el.classList.add('cms-hot');
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openPanel(el);
      }, true);
    });
    // <title> and <meta> live in the head, and the opening splash is gone
    // from the page within two seconds; surface both from the toolbar.
    function barButton(label, pattern, grouped) {
      var els = nodes().filter(function (el) {
        return pattern.test(el.getAttribute('data-cms'));
      });
      if (!els.length) return;
      var b = document.createElement('button');
      b.className = 'cms-btn';
      b.textContent = label;
      b.addEventListener('click', function () { openPanel(els[0], grouped ? els : null); });
      bar.insertBefore(b, bar.querySelector('#cmsDiscard'));
    }
    barButton('SEO', /\.meta\./, true);
    barButton('Intro', /\.intro\./, false);
  }

  function markDirty() {
    var n = Object.keys(pending).length;
    saveBtn.disabled = !n;
    saveBtn.textContent = n ? 'Save (' + n + ')' : 'Save';
  }

  function record(el, rec) {
    var key = el.getAttribute('data-cms');
    pending[key] = rec;
    el.classList.add('cms-live');
    markDirty();
  }

  /** Apply an edit to the page as it is typed, and let script.js catch up. */
  function live(el, rec) {
    applyOne(el, rec);
    record(el, rec);
    notify('editor');
  }

  function closePanel() {
    panel.classList.remove('on');
    document.documentElement.classList.remove('cms-panel-open');
    if (current) current.classList.remove('cms-sel');
    current = null;
    currentGroup = null;
  }

  /** Reset every field in the open panel (both SEO fields, or the one element). */
  function resetCurrent() {
    if (!current) return;
    var group = currentGroup;
    (group || [current]).forEach(function (el) {
      restoreDefault(el);
      pending[el.getAttribute('data-cms')] = null;   // null = delete the row on save
      el.classList.add('cms-live');
    });
    notify('editor');
    markDirty();
    openPanel(group ? group[0] : current, group);   // refresh the fields
    say('Reset — save to publish');
  }

  function discard() {
    if (!Object.keys(pending).length) return;
    if (!confirm('Discard all unsaved changes on this page?')) return;
    pending = {};
    location.reload();
  }

  /* ------------------------------------------------------------ the panel */

  function openPanel(el, group) {
    if (current) current.classList.remove('cms-sel');
    current = el;
    currentGroup = group || null;
    el.classList.add('cms-sel');
    panel.classList.add('on');
    document.documentElement.classList.add('cms-panel-open');

    var key = el.getAttribute('data-cms');
    var t = typeOf(el);
    panel.querySelector('#cmsKey').textContent = key;
    panel.querySelector('#cmsTitle').textContent =
      /\.intro\./.test(key) ? 'Opening splash' :
      t === 'image' ? 'Image' : /\.meta\./.test(key) ? 'Page SEO' :
      t.indexOf('attr:') === 0 ? 'List' : 'Text';

    var body = panel.querySelector('#cmsBody');
    body.innerHTML = '';

    if (t === 'image') buildImageFields(body, el);
    else if (group) group.forEach(function (g) { buildTextField(body, g, true); });
    else buildTextField(body, el, false);

    if (!/\.meta\./.test(key)) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function fieldWrap(parent, label) {
    var f = document.createElement('div');
    f.className = 'cms-f';
    var l = document.createElement('label');
    l.textContent = label;
    f.appendChild(l);
    parent.appendChild(f);
    return f;
  }

  function note(parent, text) {
    var p = document.createElement('p');
    p.className = 'cms-note';
    p.textContent = text;
    parent.appendChild(p);
  }

  function currentRecord(el) {
    var key = el.getAttribute('data-cms');
    if (pending[key]) return pending[key];
    var t = typeOf(el);
    if (t === 'image') return { src: el.getAttribute('src'), alt: el.getAttribute('alt') || '' };
    if (t.indexOf('attr:') === 0) return { v: el.getAttribute(t.slice(5)) || '' };
    if (t === 'textnodes') return { v: directText(el), href: hrefOf(el) };
    return { v: el.innerHTML, href: hrefOf(el) };
  }

  function linkHelp(el, href) {
    var a = linkOf(el);
    if ((a && a.hasAttribute('data-gmail')) || /^https:\/\/mail\.google\.com\//.test(href)) {
      return 'Opens a Gmail draft. The address comes after to= (the @ is written %40).';
    }
    if (/^tel:/.test(href)) return 'Phone link. Keep the tel: in front, e.g. tel:+64226947311';
    if (/^mailto:/.test(href)) return 'Email link, e.g. mailto:hello@example.com';
    return 'Where the link goes.';
  }

  function buildTextField(parent, el, labelled) {
    var t = typeOf(el);
    var rec = currentRecord(el);
    var key = el.getAttribute('data-cms');
    var label = labelled
      ? (key.indexOf('.title') > -1 ? 'Browser / search title' : 'Search description')
      : (el.getAttribute('data-cms-label') || 'Text');

    var f = fieldWrap(parent, label);
    var ta = document.createElement('textarea');
    ta.value = rec.v == null ? '' : rec.v;
    if (t === 'text' && /<[a-z]/i.test(ta.value)) {
      note(f, 'This block contains formatting tags — keep them if you want the styling.');
    }
    f.appendChild(ta);

    var hrefInput = null;
    ta.addEventListener('input', function () {
      var next = { v: ta.value };
      if (hrefInput && hrefInput.value) next.href = hrefInput.value;
      live(el, next);
    });

    if (el.hasAttribute('data-cms-href')) {
      var href = rec.href || hrefOf(el) || '';
      var hf = fieldWrap(parent, 'Link');
      hrefInput = document.createElement('input');
      hrefInput.type = 'text';
      hrefInput.value = href;
      hf.appendChild(hrefInput);
      note(parent, linkHelp(el, href));
      hrefInput.addEventListener('input', function () {
        var next = { v: ta.value };
        if (hrefInput.value) next.href = hrefInput.value;
        live(el, next);
      });
    }
  }

  function buildImageFields(parent, el) {
    var rec = currentRecord(el);

    var thumb = document.createElement('img');
    thumb.className = 'cms-thumb';
    thumb.src = el.getAttribute('src');
    // The splash logo is white; show it on the splash's own dark ground.
    if (/\.intro\./.test(el.getAttribute('data-cms'))) thumb.style.background = '#191919';
    parent.appendChild(thumb);

    var f = fieldWrap(parent, 'Replace image');
    var drop = document.createElement('div');
    drop.className = 'cms-drop';
    drop.textContent = 'Drop an image here, or click to choose';
    f.appendChild(drop);

    note(parent, 'JPG, PNG or WebP. Photos are uploaded as-is, so save them at about 1600px wide and under 1MB first.');

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    parent.appendChild(input);

    drop.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) upload(input.files[0], el, thumb, drop);
    });
    ['dragenter', 'dragover'].forEach(function (n) {
      drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (n) {
      drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) upload(file, el, thumb, drop);
    });

    var af = fieldWrap(parent, 'Alt text (describes the photo)');
    var alt = document.createElement('input');
    alt.type = 'text';
    alt.value = rec.alt || el.getAttribute('alt') || '';
    af.appendChild(alt);
    alt.addEventListener('input', function () {
      var next = currentRecord(el);
      next = { src: next.src, alt: alt.value };
      live(el, next);
    });
  }

  function upload(file, el, thumb, drop) {
    if (!/^image\//.test(file.type)) { say('That is not an image'); return; }
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    var name = el.getAttribute('data-cms').replace(/[^a-z0-9._-]/gi, '_') +
      '-' + Date.now() + '.' + ext;
    drop.textContent = 'Uploading…';
    sb.storage.from(BUCKET)
      .upload(name, file, { cacheControl: '31536000', upsert: false })
      .then(function (res) {
        if (res.error) throw res.error;
        var url = sb.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
        var prev = currentRecord(el);
        live(el, { src: url, alt: prev.alt });
        thumb.src = url;
        drop.textContent = 'Drop an image here, or click to choose';
        say('Image uploaded — save to publish');
      })
      .catch(function (err) {
        drop.textContent = 'Drop an image here, or click to choose';
        say('Upload failed: ' + (err.message || err));
      });
  }

  /* -------------------------------------------------------------- saving */

  function save() {
    var keys = Object.keys(pending);
    if (!keys.length) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    var upserts = [];
    var deletes = [];
    keys.forEach(function (k) {
      if (pending[k] === null) deletes.push(k);
      else {
        // From the boot-time list, not the live DOM: the splash is removed
        // from the page a second or two after load.
        var el = nodes().filter(function (n) { return n.getAttribute('data-cms') === k; })[0];
        upserts.push({ key: k, data: pending[k], type: el ? typeOf(el) : 'text' });
      }
    });

    var jobs = [];
    if (upserts.length) jobs.push(sb.from(TABLE).upsert(upserts, { onConflict: 'key' }));
    if (deletes.length) jobs.push(sb.from(TABLE).delete().in('key', deletes));

    Promise.all(jobs).then(function (results) {
      var bad = results.filter(function (r) { return r && r.error; });
      if (bad.length) throw bad[0].error;
      pending = {};
      nodes().forEach(function (el) { el.classList.remove('cms-live'); });
      markDirty();
      try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
      say('Saved — the live site is updated');
    }).catch(function (err) {
      markDirty();
      say('Save failed: ' + (err.message || err));
    });
  }

  /* ------------------------------------------------------------------ go */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
