# Preview-only, run after patch_role.py (never committed): an app-side hide hook the declarative tree honours. FrameNode.commonAttribute on a
# node fetched by unique id does not re-render a declarative node (run 40891856565 and the three before it), so the hook lives in the tree:
# every component call gets a stable key (`.id('pvhN')` plus, off Text, `.accessibilityDescription('pvhN')`; N counts in sorted file order, so a build always gives the same keys) and
# `.visibility(pvVis(this.pvHid, 'pvhN'))`; every struct holding such a call gets `@StorageLink('pvHid') pvHid`, which the route poll sets
# (hide:<keys> / show:all). Visibility.Hidden keeps the layout, so only the pixels change. Calls outside a struct (global builders) have no
# `this` and cannot be hidden: the probe reports them as unmeasured. An `.id()` the app sets itself later in the chain wins over the key.
# Usage: patch_hide.py <ets-root>. Prints the number of keyed calls.
import os, re, sys

ROOT = sys.argv[1]
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "patch_text.py")).read().split("patched = skipped = 0")[0].replace("ROOT = sys.argv[1]", "pass"))  # skip_string, close_of
NAMES = ("Text", "Column", "Row", "Stack", "Flex", "Image", "Scroll", "List", "ListItem", "Grid", "GridItem", "Button", "Blank", "Divider", "TextInput", "XComponent")
CALL = re.compile(r"(?<![\w.$])(%s)\(" % "|".join(NAMES))
STRUCT = re.compile(r"\bstruct\s+\w+[^{;]*\{")


def structs_of(s):
    """(start, end) of each struct body, comments and strings skipped by close_of."""
    return [(m.end(), close_of(s, m.end())[0]) for m in STRUCT.finditer(s)]


def statement_start(s, i):
    line = s[s.rfind("\n", 0, i) + 1:i].strip()
    return line == "" or line.endswith(("{", "}", ")", ";", "else"))


def patch(s, counter):
    """Returns (patched source, keys added)."""
    spans = structs_of(s)
    inserts, used = [], set()
    for m in CALL.finditer(s):
        if not statement_start(s, m.start()) or s[s.rfind("\n", 0, m.start()) + 1:m.start()].strip().startswith("//"):
            continue
        end, _ = close_of(s, m.end())
        after = end + 1
        rest = re.match(r"\s*\{", s[after:])
        if rest and m.group(1) not in ("Text", "Image", "Blank", "Divider", "XComponent"):
            after = close_of(s, after + rest.end())[0] + 1
        counter[0] += 1
        key = "pvh%d" % counter[0]
        owner = next((k for k, (a, b) in enumerate(spans) if a <= m.start() < b), None)
        # a later `.id()` (the app's own, or a modifier's) replaces the key: a non-Text node repeats it in accessibilityDescription, which the app never sets
        # (a Text's carries its glyph-run id), so the export can still name the node to hide
        also = "" if m.group(1) == "Text" else ".accessibilityDescription('%s')" % key
        inserts.append((after, ".id('%s')%s.visibility(pvVis(%s, '%s'))" % (key, also, "this.pvHid" if owner is not None else "''", key)))
        if owner is not None:
            used.add(owner)
    n = len(inserts)
    inserts += [(spans[k][0], "\n  @StorageLink('pvHid') pvHid: string = '';") for k in used]  # one member per struct that holds a keyed call
    for pos, text in sorted(inserts, key=lambda t: t[0], reverse=True):
        s = s[:pos] + text + s[pos:]
    return s, n


counter, files = [0], 0
for base, _, names in sorted(os.walk(ROOT)):
    for name in sorted(names):
        if not name.endswith(".ets") or name == "PreviewText.ets":
            continue
        path = os.path.join(base, name)
        s = open(path, encoding="utf-8").read()
        t, n = patch(s, counter)
        if n == 0:
            continue
        rel = os.path.relpath(os.path.join(ROOT, "util", "PreviewText"), base).replace(os.sep, "/")
        rel = rel if rel.startswith(".") else "./" + rel
        imp = "import { pvVis } from '%s';\n" % rel
        last = [x.end() for x in re.finditer(r"(?m)^import .*?;[ \t]*\n", t, re.S)]
        t = imp + t if not last else t[:last[-1]] + imp + t[last[-1]:]
        open(path, "w", encoding="utf-8").write(t)
        files += 1
print("patch_hide: %d component calls keyed in %d files" % (counter[0], files))
