# Preview-only (never committed): MediaRail's `items` is an undecorated property, which a custom component reads only when it is created, so
# artwork that arrives after the first render (a new items array from the parent) may never reach the rail. Making it a @Prop passes updates
# down. (The ForEach key already carries the item stamp, #938.) Usage: patch_rail.py <MediaRail.ets>.
import sys
p = sys.argv[1]
s = open(p).read()
if "@Prop items" in s:
    sys.exit(0)
assert "item.stamp" in s, "MediaRail's ForEach key no longer carries the item stamp: re-check this patch"
plain = "  items: MediaRailItem[] = [];\n"
assert plain in s
open(p, 'w').write(s.replace(plain, "  @Prop items: MediaRailItem[] = [];\n", 1))
