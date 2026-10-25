"""Maps the Previewer's inspector tree (UIContext.getFilteredInspectorTree) to the parity layout schema (docs/parity/LAYOUT.md).

Everything here comes from what the app drew: the inspector's boxes and fills, the app's own accessible names (`px:<role>:<name>` ids) and
the text lines the framework's measurer reports for each Text node (`$measured`, written by patch_route.py's dumplayout). Nothing is
derived from the web references: no page-shell counts, no web glyph advances, no substituted geometry. A Text node without `$measured`
fails the export, because a rect built from font constants would not be a measurement."""
import json
import os
import re
import struct

_NUM = re.compile(r"-?\d+(?:\.\d+)?")
WEIGHT_NAMES = {"lighter": 300, "regular": 400, "normal": 400, "medium": 500, "bold": 700, "bolder": 800}
SYSTEM = ("Navigation", "NavDestination", "root")
CLIP_KINDS = ("Scroll", "List", "Grid", "WaterFlow", "Swiper")


# ArkUI lays a line out with its own (system) font metrics even when the glyphs come from a bundled font: its line box is 1.167 em and the
# baseline sits 0.821 of that box below the line top. Calibrated against the screenshots with inkcheck.py (ink bottoms of descender-free
# texts); the glyph content area is then taken from the bundled font file's own ascent and descent, the way a browser reports a text range.
NATIVE_ASCENT_RATIO = 0.821
FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "clients", "harmony", "entry", "src", "main", "resources", "rawfile", "fonts")
_FONT_METRICS = {}


class ExportError(Exception):
    pass


def font_metrics(family):
    """(ascent, descent) in em from the bundled font file's hhea table, or None for a system font. A family list uses its first family,
    the primary font a browser takes a text's line metrics from; later families only supply glyphs the first lacks."""
    family = str(family).split(",")[0].strip()
    m = re.fullmatch(r"NunitoSansW(\d+)", family)
    name = f"NunitoSans-W{m.group(1)}.ttf" if m else (family + ".ttf" if family.startswith("PlayarrArrows") else None)
    if name is None:
        return None
    if name not in _FONT_METRICS:
        path = os.path.join(FONT_DIR, name)
        if not os.path.exists(path):
            raise ExportError(f"font file {name} is not bundled")
        d = open(path, "rb").read()
        tabs = {}
        for i in range(struct.unpack(">H", d[4:6])[0]):
            tag, _, off, _ = struct.unpack(">4sIII", d[12 + 16 * i:28 + 16 * i])
            tabs[tag.decode()] = off
        upm = struct.unpack(">H", d[tabs["head"] + 18:tabs["head"] + 20])[0]
        asc, desc = struct.unpack(">hh", d[tabs["hhea"] + 4:tabs["hhea"] + 8])
        _FONT_METRICS[name] = (asc / upm, -desc / upm)
    return _FONT_METRICS[name]


def shown(text):
    """The text as displayed: variation selectors only choose a glyph style, they are not drawn."""
    return str(text).replace("\ufe0e", "").replace("\ufe0f", "")


def num(value, default=None):
    m = _NUM.search(str(value)) if value is not None else None
    return float(m.group()) if m else default


def rect_of(node):
    v = [float(x) for x in _NUM.findall(str(node.get("$rect", "")))]
    return (v[0], v[1], v[2], v[3]) if len(v) == 4 else None  # px: x, y, width, height


def argb(value):
    """'#AARRGGBB' or '#RRGGBB' -> (r, g, b, a)."""
    h = str(value or "").lstrip("#")
    if len(h) == 8:
        return tuple(int(h[i:i + 2], 16) for i in (2, 4, 6)) + (int(h[0:2], 16) / 255,)
    if len(h) == 6:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (1.0,)
    return None


def hex_of(c):
    return "#%02x%02x%02x" % tuple(round(v) for v in c[:3]) + ("%02x" % round(c[3] * 255) if c[3] < 0.999 else "")


def over(top, below):
    a = top[3]
    return tuple(round(top[i] * a + below[i] * (1 - a)) for i in range(3)) + (1.0,)


def attrs_of(node):
    return node.get("$attrs") or node


def weight_of(attrs):
    fam = str(attrs.get("fontFamily", ""))
    m = re.search(r"NunitoSansW(\d+)", fam)
    if m:
        return int(m.group(1))
    if "PlayarrArrowsRegular" in fam:
        return 400
    if "PlayarrArrows" in fam:
        return 720
    raw = str(attrs.get("fontWeight", "")).split(".")[-1].lower()
    return WEIGHT_NAMES.get(raw) or int(num(raw, 400))


def radius_of(attrs):
    r = attrs.get("borderRadius")
    if isinstance(r, dict):
        r = r.get("topLeft")
    return num(r, 0.0) or 0.0


def padding_of(attrs, dpr):
    """(left, top, right, bottom) of a node's padding in inspector px."""
    raw = attrs.get("padding")
    if isinstance(raw, str) and raw.startswith("{"):
        try:
            p = json.loads(raw)
        except ValueError:
            return (0.0, 0.0, 0.0, 0.0)
        return tuple((num(p.get(k), 0.0) or 0.0) * dpr for k in ("left", "top", "right", "bottom"))
    v = (num(raw, 0.0) or 0.0) * dpr
    return (v, v, v, v)


def has_gradient(attrs):
    for key in ("linearGradient", "radialGradient", "sweepGradient"):
        g = attrs.get(key)
        if isinstance(g, dict) and g.get("colors"):
            return True
    return False


def all_texts(node):
    found = []
    for child in node.get("$children") or []:
        a = attrs_of(child)
        if child.get("$type") == "Text" and (a.get("content") or a.get("text")):
            found.append(str(a.get("content") or a.get("text")))
        found.extend(all_texts(child))
    return found


def export(tree, screen, theme, viewport, clock_pinned=False, image=None):
    """tree: the parsed inspector JSON with `$measured` on its Text nodes; viewport: (w, h, dpr). Returns the schema document."""
    vw, vh, dpr = viewport
    out = []
    px = lambda v: v / dpr  # noqa: E731  (inspector px -> CSS px of the app viewport)

    def scale_k(chain):
        """The product of the declared scales of a node and its ancestors. The inspector's `$rect` is the box after those transforms
        (a 64 px tile at scale 1.05 reports 67.2), so boxes are used as they are; only the text measurer, which knows nothing of the
        transforms, has its unscaled metrics multiplied by this."""
        k = 1.0
        for _, _, kk in chain:
            k *= kk
        return k

    def box_scale(a, raw, chain):
        """How much the drawn box is larger than the box the app declared (a transform on a parent component is not on the node itself):
        the reported width over the declared width, else the declared scales."""
        declared = num(a.get("width"))
        if raw is not None and declared and str(a.get("width", "")).endswith("vp"):
            ratio = raw[2] / (declared * dpr)
            if 0.5 < ratio < 2:
                return ratio if abs(ratio - 1) > 0.01 else 1.0
        return scale_k(chain)

    def scale_of(a):
        s = a.get("scale")
        if isinstance(s, dict):
            k = num(s.get("x"), 1.0)
            if k is not None and abs(k - 1.0) > 1e-6:
                return k
        return 1.0

    def emit(role, text, box, background, radius=0.0, colour=None, size=None, weight=None, opacity=1.0):
        x, y, w, h = (px(v) for v in box)
        if w < 0.5 or h < 0.5:
            return
        el = {"text": shown(text), "role": role, "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
              "color": colour, "background": hex_of(background), "fontSize": size, "fontWeight": weight}
        if radius:
            el["radius"] = radius
        if opacity < 0.999:
            el["opacity"] = round(opacity, 3)
        out.append(el)

    def visible(box, clip):
        x, y, w, h = box
        cx0, cy0, cx1, cy1 = clip
        return x < cx1 and y < cy1 and x + w > cx0 and y + h > cy0

    def text_lines(node, a, box, under, opacity, chain, clip, radius=0.0):
        measured = node.get("$measured")
        content = str(a.get("content") if a.get("content") is not None else a.get("text") or "")
        if not content.strip():
            return
        if measured is None:
            raise ExportError(f"Text {content[:30]!r} has no native measurement ({node.get('$measureError', 'no $measured')})")
        x, y, w, h = box
        k = scale_k(chain)
        pl, pt, pr, pb = (v * k for v in padding_of(a, dpr))  # the Text's box includes its padding; its lines sit in the content box
        x, y, w, h = x + pl, y + pt, w - pl - pr, h - pt - pb
        align = str(a.get("textAlign", "")).lower()
        weight, size = weight_of(a), num(a.get("fontSize"), 16.0)
        col = argb(a.get("fontColor")) or (0, 0, 0, 1.0)
        colour = hex_of(over(col, under))
        total = sum(line["lineH"] for line in measured) * k
        top = y + (h - total) / 2 if total <= h else y  # ArkUI centres the laid-out lines in the Text box
        metrics = font_metrics(str(a.get("fontFamily", "")))
        size_px = size * dpr * k
        runs = []  # one run per laid-out line, as web reports a wrapped paragraph: each line's text and glyph bounds
        for i, line in enumerate(measured):
            lw, nat, lh = line["w"] * k, line["h"] * k, line["lineH"] * k
            lx = x + (w - lw) / 2 if "center" in align else (x + w - lw if "end" in align or "right" in align else x)
            baseline = top + i * lh + (lh - nat) / 2 + NATIVE_ASCENT_RATIO * nat  # the baseline ArkUI draws on
            asc, desc = metrics if metrics is not None else (NATIVE_ASCENT_RATIO * nat / size_px, (1 - NATIVE_ASCENT_RATIO) * nat / size_px)
            above, below = round(asc * size * k) * dpr, round(desc * size * k) * dpr  # the content area's ascent and descent in whole CSS px, the unit a text box is measured in
            rect = (lx, baseline - above, lw, above + below)
            if visible(rect, clip):
                runs.append((rect, str(line["text"])))
        for rect, line_text in runs:
            emit("text", " ".join(shown(line_text).split()), rect, under, radius, colour, size, weight, opacity)

    def walk(node, under, opacity, chain, clip):
        a = attrs_of(node)
        kind = str(node.get("$type", ""))
        if str(a.get("visibility", "")).lower().endswith(("hidden", "none")):
            return
        op = num(a.get("opacity"), 1.0)
        opacity *= 1.0 if op is None else op
        if opacity <= 0.0:
            return
        raw = rect_of(node)
        fill = argb(a.get("backgroundColor"))
        here = under
        if kind in SYSTEM:
            fill = None
        k = scale_of(a)
        mychain = chain
        if raw is not None and k != 1.0:
            mychain = chain + [((raw[0] + raw[2] / 2), (raw[1] + raw[3] / 2), k)]
        nid = str(a.get("id", ""))
        pxid = nid.split(":", 2) if nid.startswith(("px:", "pxt:")) and nid.count(":") >= 2 else None
        own_text = nid.startswith("pxt:")  # a control that owns its text (web's button with a text node): one element, the text's Range
        box = raw
        if box is not None and (box[2] < 0.5 or box[3] < 0.5) and kind != "Text":
            box = None
        if box is not None and fill is not None and fill[3] > 0.001:
            here = over(fill, under)
        if box is not None and visible(box, clip):
            fills = fill is not None and fill[3] > 0.01
            if pxid is not None:
                _, role, name = pxid
                if kind == "Text" and (own_text or role in ("heading", "text", "container")):
                    pass  # the Text's own lines carry this role below
                else:
                    emit(role, name, box, here, radius_of(a) * box_scale(a, raw, mychain), opacity=opacity)
            elif nid == "pcard":
                texts = all_texts(node)
                name = str(a.get("accessibilityText") or "").strip()  # the card's own accessible name, when the inspector reports one
                emit("link", name or (" ".join(texts) if len(texts) >= 2 else "Open " + (texts[0] if texts else "")), box, here, radius_of(a) * box_scale(a, raw, mychain), opacity=opacity)
            elif nid.endswith("-nav-tile"):
                texts = all_texts(node)
                label = texts[0] if texts else ""
                emit("link", ("Signed in as " + label + ". Open profiles.") if nid.startswith("profile") else label, box, here, radius_of(a) * box_scale(a, raw, mychain), opacity=opacity)
            elif kind in ("Image", "Button", "Toggle", "TextInput"):
                role = {"Image": "image", "Button": "button", "Toggle": "switch", "TextInput": "textbox"}[kind]
                emit(role, "", box, here, radius_of(a) * box_scale(a, raw, mychain), opacity=opacity)
            elif kind != "Text" and (fills or has_gradient(a) or (num(a.get("borderWidth"), 0.0) or 0.0) >= 1.0 and argb(a.get("borderColor"))[3] > 0.01):
                emit("container", "", box, here, radius_of(a) * box_scale(a, raw, mychain), opacity=opacity)
            if kind == "Text":
                lines_role = pxid[1] if pxid is not None and (own_text or pxid[1] in ("heading", "text", "container")) else None
                start = len(out)
                text_lines(node, a, tuple(raw), here, opacity, mychain, clip, radius_of(a) if own_text else 0.0)
                if lines_role is not None:
                    for el in out[start:]:
                        el["role"] = lines_role
        kids = node.get("$children") or []
        pages = [c for c in kids if c.get("$type") == "NavDestination"]
        nclip = clip
        if raw is not None and (kind in CLIP_KINDS or str(a.get("clip", "")).lower() == "true"):
            nclip = (max(clip[0], raw[0]), max(clip[1], raw[1]), min(clip[2], raw[0] + raw[2]), min(clip[3], raw[1] + raw[3]))
        sheet = 0
        for i, c in enumerate(kids):  # an opaque full-viewport sibling hides everything drawn before it (web drops occluded elements)
            cf, cr = argb(attrs_of(c).get("backgroundColor")), rect_of(c)
            if cf is not None and cf[3] > 0.99 and cr is not None and cr[2] >= vw * dpr - 1 and cr[3] >= vh * dpr - 1 and c.get("$type") in ("Column", "Stack", "Row"):
                sheet = i
        for i, c in enumerate(kids):
            if i < sheet:
                continue
            if c.get("$type") == "NavDestination" and c is not pages[-1]:
                continue  # a page below the top one stays in the tree while hidden
            walk(c, here, opacity, list(mychain), nclip)

    walk(tree, (255, 255, 255, 1.0), 1.0, [], (0, 0, vw * dpr, vh * dpr))  # chain: (cx, cy, k) outermost first; clip: the app viewport in px
    doc = {"screen": screen, "theme": theme, "viewport": {"w": vw, "h": vh, "dpr": dpr}, "elements": out}
    if clock_pinned:
        doc["clockPinned"] = True
    return doc


def write(raw, screen, theme, viewport, dest_dir, clock_pinned=False, image=None):
    import os
    doc = export(json.loads(raw), screen, theme, viewport, clock_pinned, image=image)
    os.makedirs(os.path.join(dest_dir, theme), exist_ok=True)
    with open(os.path.join(dest_dir, theme, screen + ".json"), "w") as f:
        json.dump(doc, f)
    return len(doc["elements"])
