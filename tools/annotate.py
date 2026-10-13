#!/usr/bin/env python3
"""Inject stable data-cms keys into the Repaint Queenstown static pages.

Works on the raw source text: bs4 is used only to locate elements, then the
attribute is spliced in at the recorded source offset. Nothing else in the file
moves, so the diff is only ever ' data-cms="..."' insertions.

Keys read  <page>.<section>.<tag>_<n>,  e.g. index.services.h3_2:
  page     the file name without .html
  section  the id of the enclosing <section>/<header>/<footer> (or of a
           top-level block such as #intro or #mobile-menu); `top` is called
           `hero`. A block with no id is named after its own class
           (review-banner, page-head) or, failing that, the HTML comment
           just above it (<!-- Map --> -> map). Anything else is `content`.
  tag_n    the element's tag and its running count inside that section.

Idempotent: elements that already carry data-cms are left alone, and so is
everything inside them. That is how the two hand-keyed lists in index.html
(the marquee words and the rotating hero reviews) stay as they are. A new
element in an already-keyed section is numbered after the highest key there,
so it never reuses a key; on a re-run the numbers need not follow page order.

Usage:  python3 tools/annotate.py index.html terms.html privacy.html
"""
import sys, re
from bs4 import BeautifulSoup, Tag, NavigableString, Comment

SKIP_TREE   = {"script", "style", "svg", "noscript", "template", "head", "iframe"}
INLINE_OK   = {"b", "strong", "em", "i", "u", "span", "br", "small", "sup",
               "sub", "mark", "abbr", "time", "wbr", "s"}
# Containers we always descend into rather than treat as one editable blob.
NEVER_LEAF  = {"body", "main", "header", "footer", "nav", "section", "article",
               "aside", "form", "ul", "ol", "dl", "table", "thead", "tbody",
               "tr", "picture", "figure", "video", "audio"}

# Never keyed, by id: filled in or mirrored by script.js at runtime, so a saved
# value would only ever be overwritten.
#   lightbox         the zoomed gallery photo and its caption (copied on open)
#   service-caption  mirrors the active service heading
#   marquee-track    built from its data-words list (keyed by hand)
SKIP_IDS    = {"lightbox", "service-caption", "marquee-track"}

# Elements whose id names a section.
LANDMARKS   = {"section", "header", "footer", "nav", "main", "article", "aside"}
SECTION_ALIAS = {"top": "hero"}
GENERIC_CLASSES = {"section", "container", "reveal"}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def el_text(el):
    return el.get_text(" ", strip=True)


def classify(el):
    """Return 'text', 'textnodes', or None for an element."""
    if el.name in NEVER_LEAF or not el_text(el):
        return None
    # Descendants, ignoring everything inside an <svg> (paths, groups, uses).
    kids = [k for k in el.find_all(True)
            if not any(a.name == "svg" for a in k.parents)]
    if any(k.name in SKIP_TREE - {"svg"} for k in kids):
        return None
    has_opaque = any(k.name in ("svg", "img", "canvas", "picture") for k in kids)
    direct = [c for c in el.children
              if isinstance(c, NavigableString) and not isinstance(c, Comment)
              and c.strip()]
    # <a> counts as inline only inside prose, i.e. when the element also has
    # bare text of its own. A container of nothing but links is descended into
    # so each link stays separately editable.
    inline = INLINE_OK | ({"a"} if direct else set())
    others = [k for k in kids if k.name not in inline
              and k.name not in ("svg", "img", "canvas", "picture")]
    if others:
        return None                      # real block children -> descend
    if not direct and any(k.name not in ("svg", "img", "canvas", "picture")
                          for k in el.find_all(True, recursive=False)):
        # Pure wrapper: every scrap of text lives inside child elements.
        # Key the children so the editor offers plain sentences, not markup.
        return None
    if has_opaque:
        # Icon + label. Only the bare text nodes are editable, icons survive.
        return "textnodes" if direct else None
    return "text"


def is_top_level(el):
    return el.parent is not None and el.parent.name == "body"


def section_of(el):
    top = None
    for p in el.parents:
        if p.name in ("body", "html", "[document]"):
            break
        pid = p.get("id")
        if pid and (p.name in LANDMARKS or is_top_level(p)):
            s = slug(pid)
            return SECTION_ALIAS.get(s, s)
        if p.name in ("header", "footer"):
            return p.name
        top = p
    if top is None:
        return "content"
    # A top-level block with no id: its own class, else the comment above it.
    for c in top.get("class", []):
        if c not in GENERIC_CLASSES and not c.startswith("section--"):
            return slug(c)
    prev = top.previous_sibling
    while isinstance(prev, NavigableString) and not isinstance(prev, Comment) \
            and not prev.strip():
        prev = prev.previous_sibling
    if isinstance(prev, Comment) and slug(prev):
        return slug(prev)
    return "content"


def editable_link(el):
    """The <a> whose href the editor may change for this element, if any.

    tel: and mailto: links, plus the Gmail compose links (data-gmail, whose
    href script.js builds at load). The element can be the link itself or a
    label inside it (the nav phone number is a <span> in a tel: link)."""
    a = el if el.name == "a" else el.find_parent("a")
    if a is None:
        return None
    href = a.get("href", "")
    if href.startswith(("tel:", "mailto:")) or a.has_attr("data-gmail"):
        return a
    return None


def collect(soup, page):
    """Yield (element, key, kind) in document order."""
    hits = []
    counters = {}

    # Start every count after the highest number already in the file, so a
    # new element in an existing section gets a fresh key (img_9, not a second
    # img_1) and keys that already hold saved content never move.
    seen = {}
    for el in soup.select("[data-cms]"):
        key = el["data-cms"]
        seen[key] = seen.get(key, 0) + 1
        m = re.match(r"^(.+\..+\.[a-z0-9]+)_(\d+)$", key)
        if m:
            counters[m.group(1)] = max(counters.get(m.group(1), 0), int(m.group(2)))
    for key, n in seen.items():
        if n > 1:
            print(f"  !! {key} appears {n} times (an element copied with its "
                  f"data-cms?). Delete data-cms and data-cms-type from the copy "
                  f"and run this again.", file=sys.stderr)

    def key_for(el, tag):
        slot = f"{page}.{section_of(el)}.{tag}"
        counters[slot] = counters.get(slot, 0) + 1
        return f"{slot}_{counters[slot]}"

    def visit(el):
        if el.name in SKIP_TREE:
            return
        if el.get("data-cms") or el.get("id") in SKIP_IDS:
            return
        if el.name == "img":
            if el.get("src"):            # an <img> with no src is a JS slot
                hits.append((el, key_for(el, "img"), "image"))
            return
        kind = classify(el)
        if kind:
            hits.append((el, key_for(el, el.name), kind))
            return
        for child in el.children:
            if isinstance(child, Tag):
                visit(child)

    visit(soup.body)
    return hits


def line_offsets(src):
    offs, pos = [0], 0
    for line in src.splitlines(keepends=True):
        pos += len(line)
        offs.append(pos)
    return offs


def annotate(path, page):
    src = open(path, encoding="utf-8").read()
    soup = BeautifulSoup(src, "html.parser")
    offs = line_offsets(src)

    inserts = []          # (absolute_offset, text_to_insert)
    stats = {"text": 0, "textnodes": 0, "image": 0, "href": 0}
    linked = set()        # one editable href per link

    for el, key, kind in collect(soup, page):
        if el.sourceline is None:
            continue
        start = offs[el.sourceline - 1] + el.sourcepos
        # splice directly after "<tagname"
        at = start + 1 + len(el.name)
        if src[start] != "<" or not src.startswith(el.name, start + 1):
            print(f"  !! offset mismatch for {key}, skipped", file=sys.stderr)
            continue
        attrs = f' data-cms="{key}" data-cms-type="{kind}"'
        stats[kind] += 1
        if kind != "image":
            a = editable_link(el)
            if a is not None and id(a) not in linked:
                linked.add(id(a))
                attrs += ' data-cms-href="1"'
                stats["href"] += 1
        inserts.append((at, attrs))

    # <title> and <meta name="description">
    head_extras = []
    t = soup.find("title")
    if t is not None and not t.get("data-cms") and t.sourceline:
        at = offs[t.sourceline - 1] + t.sourcepos + len("<title")
        head_extras.append((at, f' data-cms="{page}.meta.title" data-cms-type="text"'))
    m = soup.find("meta", attrs={"name": "description"})
    if m is not None and not m.get("data-cms") and m.sourceline:
        at = offs[m.sourceline - 1] + m.sourcepos + len("<meta")
        head_extras.append((at, f' data-cms="{page}.meta.description" data-cms-type="attr:content"'))
    inserts += head_extras

    for at, text in sorted(inserts, key=lambda x: -x[0]):
        src = src[:at] + text + src[at:]

    open(path, "w", encoding="utf-8").write(src)
    print(f"{path:16s} text={stats['text']:3d} textnodes={stats['textnodes']:3d} "
          f"images={stats['image']:3d} links={stats['href']:3d} "
          f"meta={len(head_extras)}")


if __name__ == "__main__":
    for path in sys.argv[1:]:
        annotate(path, path.rsplit("/", 1)[-1].replace(".html", ""))
