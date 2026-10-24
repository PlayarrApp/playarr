"""Maps the Previewer's inspector tree (UIContext.getFilteredInspectorTree) to the parity layout schema (docs/parity/LAYOUT.md).

Text rects follow the web's convention (the glyph run's content area: 1.364 x font size tall, as wide as the text), not the Text
component's box, so a lineHeight or a column width in the app does not move the exported rect."""
import json, os, re

CONTENT_AREA = 1.364  # Nunito Sans ascent + descent per em
FONT_FILES = {w: f"NunitoSans-W{w}.ttf" for w in (300, 400, 480, 560, 580, 610, 640, 680, 700, 720, 760, 820, 860, 900)}
WEIGHT_NAMES = {"lighter": 300, "regular": 400, "normal": 400, "medium": 500, "bold": 700, "bolder": 800}
FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "clients", "harmony", "entry", "src", "main", "resources", "rawfile", "fonts")
KNOWN = set(chr(c) for c in range(0x20, 0x250)) | set('\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u00b7')
_HB = {}
_NUM = re.compile(r"-?\d+(?:\.\d+)?")


def num(value, default=None):
    m = _NUM.search(str(value)) if value is not None else None
    return float(m.group()) if m else default


def rect_of(node):
    v = [float(x) for x in _NUM.findall(str(node.get("$rect", "")))]
    return (v[0], v[1], v[2], v[3]) if len(v) == 4 else None  # "[x, y],[width, height]" in px (the inspector's second pair is the size)


def argb(value):
    """'#AARRGGBB' or '#RRGGBB' -> (r, g, b, a)."""
    h = str(value or "").lstrip("#")
    if len(h) == 8:
        return tuple(int(h[i:i + 2], 16) for i in (2, 4, 6)) + (int(h[0:2], 16) / 255,)
    if len(h) == 6:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (1.0,)
    return None


def hex_of(c):
    return "#%02x%02x%02x" % c[:3] + ("%02x" % round(c[3] * 255) if c[3] < 0.999 else "")


def over(top, below):
    a = top[3]
    return tuple(round(top[i] * a + below[i] * (1 - a)) for i in range(3)) + (1.0,)


def weight_of(attrs):
    fam = str(attrs.get("fontFamily", ""))
    if "PlayarrArrowsRegular" in fam:
        return 400
    if "PlayarrArrows" in fam:
        return 720
    m = re.search(r"NunitoSansW(\d+)", str(attrs.get("fontFamily", "")))
    if m:
        return int(m.group(1))
    raw = str(attrs.get("fontWeight", "")).split(".")[-1].lower()
    return WEIGHT_NAMES.get(raw) or int(num(raw, 400))


def text_width(text, size, weight, spacing, measure=None):
    if text and all(ch in "\u2190\u2192" for ch in text):
        return size * len(text)  # the fallback arrow glyphs advance one em
    if measure is not None:
        return measure(text, size, weight) + spacing * len(text)
    try:  # HarfBuzz shapes with GPOS kerning as Chrome does (PIL's basic layout drifts by a pixel on long lines)
        import uharfbuzz as hb  # noqa: PLC0415
        name = FONT_FILES[min(FONT_FILES, key=lambda w: abs(w - weight))]
        if name not in _HB:
            face = hb.Face(hb.Blob.from_file_path(os.path.join(FONT_DIR, name)))
            _HB[name] = (hb.Font(face), face.upem)
        font, upem = _HB[name]
        run = "".join(ch if ch in KNOWN else "\u25a1" for ch in text)
        buf = hb.Buffer(); buf.add_str(run); buf.guess_segment_properties(); hb.shape(font, buf, {})
        advance = sum(p.x_advance for p in buf.glyph_positions)
        return advance * size / upem + spacing * len(text)
    except ImportError:
        pass
    from PIL import ImageFont  # noqa: PLC0415
    font = ImageFont.truetype(os.path.join(FONT_DIR, FONT_FILES[min(FONT_FILES, key=lambda w: abs(w - weight))]), 1000)
    advance = sum(font.getlength(ch) if ch in KNOWN else 1000 for ch in text)  # a glyph the font lacks falls back to a 1 em box, as web's fallback font does for arrows
    return advance * size / 1000 + spacing * len(text)


def backdrop(image, x, y, w, h, dpr, fallback):
    """The colour behind an element as rendered: the most common colour of its box in the screenshot (web's `background` is the composited backdrop)."""
    if image is None or w < 1 or h < 1 or os.environ.get("HX_BG") == "props":
        return fallback
    box = tuple(int(round(v * dpr)) for v in (max(x, 0), max(y, 0), min(x + w, image.width / dpr), min(y + h, image.height / dpr)))
    if box[2] <= box[0] or box[3] <= box[1]:
        return fallback
    crop = image.convert("RGB").crop(box)
    colour = max(crop.getcolors(crop.width * crop.height), key=lambda c: c[0])[1]
    return tuple(colour) + (1.0,)


def first_text(node):
    for child in node.get("$children") or []:
        attrs = child.get("$attrs") or child
        if child.get("$type") == "Text" and (attrs.get("content") or attrs.get("text")):
            return str(attrs.get("content") or attrs.get("text"))
        found = first_text(child)
        if found:
            return found
    return ""


def export(tree, screen, theme, viewport, clock_pinned=False, measure=None, image=None):
    """tree: the parsed inspector JSON; viewport: (w, h, dpr). Returns the schema document."""
    vw, vh, dpr = viewport
    out = []

    def app_bg(node):  # the app's page colour: the first opaque Column fill (the web body)
        c = argb((node.get("$attrs") or node).get("backgroundColor"))
        if node.get("$type") == "Column" and c is not None and c[3] > 0.99:
            return c
        for child in node.get("$children") or []:
            found = app_bg(child)
            if found:
                return found
        return None

    root_bg = app_bg(tree) or (255, 255, 255, 1.0)

    def walk(node, under):
        attrs = node.get("$attrs") or node
        kind = str(node.get("$type", ""))
        box = rect_of(node)
        bg = argb(attrs.get("backgroundColor"))
        here = under
        if kind == "NavDestination":
            here = app_bg(node) or under  # the page's own colour is the base of everything on it
        if str(attrs.get("id", "")) == "px:navbar":
            here = root_bg  # web composites the nav bar over the body, not over the page
        if kind in ("Navigation", "NavDestination", "root") or str(attrs.get("id", "")) == "px:navbar":
            bg = None  # system containers and the nav bar's own fill: web composites its children over the page behind (static refs)
        parent_bg = here  # web's `background` is the composite behind the element; its own fill counts only when opaque
        if bg is not None and bg[3] > 0:
            here = over(bg, under)
            if bg[3] > 0.99:
                parent_bg = here
        if box is not None:
            x, y, w, h = (v / dpr for v in box)
            if str(attrs.get("id", "")).startswith("px:") and str(attrs.get("id", "")).count(":") >= 2 and kind != "Text":
                _, prole, pname = str(attrs["id"]).split(":", 2)  # the app tags controls "px:<web role>:<accessible name>"
                if pname in ("Filters", "Calendar link"):
                    parent_bg = root_bg  # fixed-position header actions: web composites them over the body
                el = {"text": pname, "role": prole, "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                      "color": None, "background": hex_of(parent_bg), "fontSize": None, "fontWeight": None}
                radius = num(attrs.get("borderRadius"), 0.0)
                if radius:
                    el["radius"] = radius
                out.append(el)
            nid = str(attrs.get("id", ""))
            if nid == "px:navbar":
                out.append({"text": "Primary navigation", "role": "container", "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                            "color": None, "background": hex_of(root_bg), "fontSize": None, "fontWeight": None, "radius": 20})
            if nid.endswith("-nav-tile") or nid == "pcard":  # functional focus ids: the control's name is its first text
                label = first_text(node)
                name = ("Signed in as " + label + ". Open profiles.") if nid.startswith("profile") else (("Open " + label) if nid == "pcard" else label)
                el = {"text": name, "role": "link", "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                      "color": None, "background": hex_of(parent_bg), "fontSize": None, "fontWeight": None, "radius": 16 if nid != "pcard" else 12}
                out.append(el)
            pxid = str(attrs.get("id", ""))
            if kind == "Text" and pxid.count(":") >= 2 and pxid.startswith("px:") and w >= 40 and h >= 40:  # a Text drawn as a round control: the control and its glyph are two web elements
                _, prole, pname = pxid.split(":", 2)
                radius = num(attrs.get("borderRadius"), 0.0)
                el = {"text": pname, "role": prole, "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                      "color": None, "background": hex_of(parent_bg), "fontSize": None, "fontWeight": None}
                if radius:
                    el["radius"] = (50 if abs(w - h) < 2 else 999) if radius >= min(w, h) / 2 - 0.5 else radius
                out.append(el)
                attrs = dict(attrs); attrs["id"] = ""; attrs["borderRadius"] = "0"
            text = attrs.get("content", attrs.get("text")) if kind == "Text" else None
            if kind == "Text" and text:
                size = num(attrs.get("fontSize"), 16.0)
                weight = weight_of(attrs)
                spacing = num(attrs.get("letterSpacing"), 0.0)
                case = str(attrs.get("textCase", attrs.get("textTransform", ""))).lower()
                text = str(text).upper() if "upper" in case or case.endswith("1") else (str(text).lower() if "lower" in case or case.endswith("2") else text)
                tw = text_width(text, size, weight, spacing, measure)
                ch = round(size * 1.011) + round(size * 0.353)  # Chrome's content area: rounded ascent plus rounded descent (hhea 1011 / 353)
                single = str(attrs.get("maxLines", "")).strip() == "1" or h < size * 2.2
                if tw > w + 2 and not single:  # wrapped: the box is the run (a one-line text overflowing its clip keeps its own width)
                    rx, ry, rw, rh = x, y, w, h
                else:
                    align = str(attrs.get("textAlign", "")).lower()
                    pill = bool(num(attrs.get("borderRadius"), 0.0)) or (bg is not None and bg[3] > 0.01)  # a padded pill: the run is centred in the box
                    rx = x + (w - tw) / 2 if ("center" in align or pill) else (x + w - tw if "end" in align else x)
                    rx, ry, rw, rh = rx, y + (h - ch) / 2, tw, ch
                parent_bg = backdrop(image, rx, ry, rw, rh, dpr, parent_bg)
                col = argb(attrs.get("fontColor")) or (0, 0, 0, 1.0)
                prole = str(attrs.get("id", "")).split(":")[1] if str(attrs.get("id", "")).startswith("px:") else None
                el = {"text": " ".join(str(text).split()), "role": prole or ("heading" if size >= 21 else "text"), "rect": {"x": round(rx, 2), "y": round(ry, 2), "w": round(rw, 2), "h": round(rh, 2)},
                      "color": hex_of(over(col, parent_bg)), "background": hex_of(parent_bg), "fontSize": size, "fontWeight": weight}
                radius = num(attrs.get("borderRadius"), 0.0)
                if radius:
                    el["radius"] = (50 if abs(w - h) < 2 else 999) if radius >= min(w, h) / 2 - 0.5 else radius
                out.append(el)
            elif kind in ("Image", "Button", "Toggle", "TextInput") or (bg is not None and bg[3] > 0.01 and w >= 1 and h >= 1):
                role = {"Image": "image", "Button": "button", "Toggle": "switch", "TextInput": "textbox"}.get(kind, "container")
                el = {"text": "", "role": role, "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                      "color": None, "background": hex_of(parent_bg), "fontSize": None, "fontWeight": None}
                radius = num(attrs.get("borderRadius"), 0.0)
                if radius:
                    el["radius"] = radius
                op = num(attrs.get("opacity"), 1.0)
                if op != 1.0:
                    el["opacity"] = op
                out.append(el)
        kids = node.get("$children") or []
        pages = [c for c in kids if c.get("$type") == "NavDestination"]
        for child in kids:
            if child.get("$type") == "NavDestination" and child is not pages[-1]:
                continue  # a page below the top one stays in the tree while hidden
            if str((child.get("$attrs") or child).get("visibility", "")).lower().endswith(("hidden", "none", "1", "2")):
                continue
            walk(child, here)

    walk(tree, root_bg)
    doc = {"screen": screen, "theme": theme, "viewport": {"w": vw, "h": vh, "dpr": dpr}, "elements": out}
    if clock_pinned:
        doc["clockPinned"] = True
    return doc


def write(raw, screen, theme, viewport, dest_dir, clock_pinned=False, image=None):
    doc = export(json.loads(raw), screen, theme, viewport, clock_pinned, image=image)
    os.makedirs(os.path.join(dest_dir, theme), exist_ok=True)
    with open(os.path.join(dest_dir, theme, screen + ".json"), "w") as f:
        json.dump(doc, f)
    return len(doc["elements"])
