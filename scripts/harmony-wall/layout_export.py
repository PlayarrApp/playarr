"""Maps the Previewer's inspector tree (UIContext.getFilteredInspectorTree) to the parity layout schema (docs/parity/LAYOUT.md).

Text rects follow the web's convention (the glyph run's content area: 1.364 x font size tall, as wide as the text), not the Text
component's box, so a lineHeight or a column width in the app does not move the exported rect."""
import json, os, re

CONTENT_AREA = 1.364  # Nunito Sans ascent + descent per em
FONT_FILES = {w: f"NunitoSans-W{w}.ttf" for w in (300, 400, 480, 560, 580, 610, 640, 680, 700, 720, 760, 820, 860, 900)}
WEIGHT_NAMES = {"lighter": 300, "regular": 400, "normal": 400, "medium": 500, "bold": 700, "bolder": 800}
FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "clients", "harmony", "entry", "src", "main", "resources", "rawfile", "fonts")
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
    m = re.search(r"NunitoSansW(\d+)", str(attrs.get("fontFamily", "")))
    if m:
        return int(m.group(1))
    raw = str(attrs.get("fontWeight", "")).split(".")[-1].lower()
    return WEIGHT_NAMES.get(raw) or int(num(raw, 400))


def text_width(text, size, weight, spacing, measure=None):
    if measure is not None:
        return measure(text, size, weight) + spacing * len(text)
    from PIL import ImageFont  # noqa: PLC0415
    font = ImageFont.truetype(os.path.join(FONT_DIR, FONT_FILES[min(FONT_FILES, key=lambda w: abs(w - weight))]), 1000)
    return font.getlength(text) * size / 1000 + spacing * len(text)


def backdrop(image, x, y, w, h, dpr, fallback):
    """The colour behind an element as rendered: the most common colour of its box in the screenshot (web's `background` is the composited backdrop)."""
    if image is None or w < 1 or h < 1:
        return fallback
    box = tuple(int(round(v * dpr)) for v in (max(x, 0), max(y, 0), min(x + w, image.width / dpr), min(y + h, image.height / dpr)))
    if box[2] <= box[0] or box[3] <= box[1]:
        return fallback
    crop = image.convert("RGB").crop(box)
    colour = max(crop.getcolors(crop.width * crop.height), key=lambda c: c[0])[1]
    return tuple(colour) + (1.0,)


def export(tree, screen, theme, viewport, clock_pinned=False, measure=None, image=None):
    """tree: the parsed inspector JSON; viewport: (w, h, dpr). Returns the schema document."""
    vw, vh, dpr = viewport
    out = []

    def walk(node, under):
        attrs = node.get("$attrs") or node
        kind = str(node.get("$type", ""))
        box = rect_of(node)
        bg = argb(attrs.get("backgroundColor"))
        here = under
        if bg is not None and bg[3] > 0:
            here = over(bg, under)
        if box is not None:
            x, y, w, h = (v / dpr for v in box)
            text = attrs.get("content", attrs.get("text")) if kind == "Text" else None
            if kind == "Text" and text:
                size = num(attrs.get("fontSize"), 16.0)
                weight = weight_of(attrs)
                spacing = num(attrs.get("letterSpacing"), 0.0)
                tw = text_width(str(text), size, weight, spacing, measure)
                ch = size * CONTENT_AREA
                if tw > w + 0.5:  # wrapped or clipped: the box is the run
                    rx, ry, rw, rh = x, y, w, h
                else:
                    align = str(attrs.get("textAlign", "")).lower()
                    rx = x + (w - tw) / 2 if "center" in align else (x + w - tw if "end" in align else x)
                    rx, ry, rw, rh = rx, y + (h - ch) / 2, tw, ch
                case = str(attrs.get("textCase", attrs.get("textTransform", ""))).lower()
                text = str(text).upper() if "upper" in case or case.endswith("1") else (str(text).lower() if "lower" in case or case.endswith("2") else text)
                tw = text_width(text, size, weight, spacing, measure)
                here = backdrop(image, rx, ry, rw, rh, dpr, here)
                col = argb(attrs.get("fontColor")) or (0, 0, 0, 1.0)
                el = {"text": " ".join(str(text).split()), "role": "heading" if size >= 21 else "text", "rect": {"x": round(rx, 2), "y": round(ry, 2), "w": round(rw, 2), "h": round(rh, 2)},
                      "color": hex_of(over(col, here)), "background": hex_of(here), "fontSize": size, "fontWeight": weight}
                out.append(el)
            elif kind in ("Image", "Button", "Toggle", "TextInput") or (bg is not None and bg[3] > 0.01 and w >= 1 and h >= 1):
                role = {"Image": "image", "Button": "button", "Toggle": "switch", "TextInput": "textbox"}.get(kind, "container")
                el = {"text": "", "role": role, "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                      "color": None, "background": hex_of(here), "fontSize": None, "fontWeight": None}
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

    walk(tree, (255, 255, 255, 1.0))
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
