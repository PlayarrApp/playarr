# Preview-only, run after patch_route.py (never committed): gives every Text(...) of the app a TextController and a unique
# accessibilityDescription, so the layout export can read the glyph runs of the live component (util/PreviewText.ets).
# Usage: patch_text.py <ets-root>. Texts that already pass options are left alone and reported.
import os, re, sys

ROOT = sys.argv[1]
CALL = re.compile(r"(?<![\w.$])Text\(")


def skip_string(s, i):
    """i at an opening quote; returns the index after its closing quote (template literals may nest ${...})."""
    q = s[i]
    i += 1
    while i < len(s):
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == q:
            return i + 1
        if q == "`" and s[i:i + 2] == "${":
            depth = 1
            i += 2
            while i < len(s) and depth:
                if s[i] in "'\"`":
                    i = skip_string(s, i)
                    continue
                depth += (s[i] == "{") - (s[i] == "}")
                i += 1
            continue
        i += 1
    raise ValueError("unterminated string")


def close_of(s, i):
    """i just after the '(' of a call; returns (index of the matching ')', whether a top-level comma was seen)."""
    depth, comma = 1, False
    while i < len(s):
        c = s[i]
        if c in "'\"`":
            i = skip_string(s, i)
            continue
        if s.startswith("//", i):
            i = s.index("\n", i)
            continue
        if s.startswith("/*", i):
            i = s.index("*/", i) + 2
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return i, comma
        elif c == "," and depth == 1:
            comma = True
        i += 1
    raise ValueError("unbalanced call")


patched = skipped = 0
for base, _, names in os.walk(ROOT):
    for name in names:
        if not name.endswith(".ets"):
            continue
        path = os.path.join(base, name)
        s = open(path, encoding="utf-8").read()
        out, pos, n = [], 0, 0
        for m in CALL.finditer(s):
            if m.start() < pos:
                continue
            line_start = s.rfind("\n", 0, m.start()) + 1
            if s[line_start:m.start()].strip().startswith("//"):
                continue
            end, comma = close_of(s, m.end())
            if comma:
                skipped += 1
                print("skipped (has options):", path, s[m.start():m.start() + 60].replace("\n", " "))
                continue
            args = s[m.end():end]
            out.append(s[pos:m.end()] + args + ", { controller: pvTc() }).accessibilityDescription(pvTcId()")
            pos = end
            n += 1
        if n == 0:
            continue
        out.append(s[pos:])
        t = "".join(out)
        rel = os.path.relpath(os.path.join(ROOT, "util", "PreviewText"), base).replace(os.sep, "/")
        rel = rel if rel.startswith(".") else "./" + rel
        imp = "import { pvTc, pvTcId } from '%s';\n" % rel
        last = [x.end() for x in re.finditer(r"(?m)^import .*?;[ \t]*\n", t, re.S)]
        t = imp + t if not last else t[:last[-1]] + imp + t[last[-1]:]
        open(path, "w", encoding="utf-8").write(t)
        patched += n
print("patch_text: %d Text calls patched, %d skipped" % (patched, skipped))
