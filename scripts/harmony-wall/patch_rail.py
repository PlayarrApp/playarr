# Preview-only (never committed): MediaRail's `items` is an undecorated property, which a custom component reads only when it is created, so
# artwork that arrives after the first render (a new items array from the parent) may never reach the rail. Making it a @Prop passes updates
# down. (The ForEach key already carries the item stamp, #938.) Usage: patch_rail.py <MediaRail.ets>.
import sys
p = sys.argv[1]
s = open(p).read()
if "@Prop previewRoute" in s:
    sys.exit(0)
assert "item.stamp" in s, "MediaRail's ForEach key no longer carries the item stamp: re-check this patch"
insert_at = s.index("import ")
s = s[:insert_at] + "import { reportDetailLayoutStageForScope, reportDetailRowImageStageForScope } from '../../util/PreviewState';\n" + s[insert_at:]
plain = "  items: MediaRailItem[] = [];\n"
prop = "  @Prop items: MediaRailItem[] = [];\n"
preview_prop = "  @Prop previewRoute: string = '';\n  @Prop previewWorkId: string = '';\n  @Prop previewGeneration: number = 0;\n"
if plain in s:
    s = s.replace(plain, prop + preview_prop, 1)
elif prop in s:
    s = s.replace(prop, prop + preview_prop, 1)
else:
    raise AssertionError("MediaRail items property changed; re-check the diagnostic patch")
height = "      .height(this.listHeight > 0 ? this.listHeight : '100%')\n"
assert height in s
s = s.replace(height, height + "      .onAreaChange((_old: Area, area: Area) => { reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-list-area', 0, Number(area.width), Number(area.height)); })\n", 1)
builder = "            ListItem() {\n              this.itemBuilder(item, index, this.activeRailFactor)\n            }"
assert builder in s
s = s.replace(builder, "            ListItem() {\n              this.itemBuilder(item, index, this.activeRailFactor)\n            }\n            .onAppear(() => {\n              reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, item.id, this.previewGeneration,\n                item.stamp !== undefined ? 'visible-item-stamp-present' : 'visible-item-stamp-absent');\n              reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-item-appear', 1, -1, -1);\n            })", 1)
list_on_appear = "      .height(this.listHeight > 0 ? this.listHeight : '100%')\n"
assert list_on_appear in s
s = s.replace(list_on_appear, list_on_appear + "      .onAppear(() => {\n        reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-items-count', this.items.length, -1, -1);\n        if (this.listHeight > 0) {\n          reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-list-height-explicit', this.listHeight, -1, -1);\n        } else {\n          reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-list-height-default-fill', 0, -1, -1);\n        }\n      })\n", 1)
open(p, 'w').write(s)
