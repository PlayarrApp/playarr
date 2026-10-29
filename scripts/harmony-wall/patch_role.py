# Preview-only, run after patch_text.py (never committed): the Previewer's inspector does not report `accessibilityRole`, so every
# `.accessibilityRole(X)` the app sets is repeated, from the same expression, in `accessibilityTextHint` (which the inspector does report):
# the exporter then reads the role the app really declared. Usage: patch_role.py <ets-root>.
import os, re, sys

ROOT = sys.argv[1]
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "patch_text.py")).read().split("patched = skipped = 0")[0].replace("ROOT = sys.argv[1]", "pass"))  # skip_string, close_of

n = 0
for base, _, names in os.walk(ROOT):
    for name in names:
        if not name.endswith(".ets"):
            continue
        path = os.path.join(base, name)
        s = open(path, encoding="utf-8").read()
        out, pos = [], 0
        for m in re.finditer(r"\.accessibilityRole\(", s):
            if m.start() < pos:
                continue
            end, _ = close_of(s, m.end())
            out.append(s[pos:end + 1] + ".accessibilityTextHint('pvrole:' + String(%s))" % s[m.end():end])
            pos = end + 1
            n += 1
        if out:
            open(path, "w", encoding="utf-8").write("".join(out) + s[pos:])
print("patch_role: %d roles mirrored" % n)
