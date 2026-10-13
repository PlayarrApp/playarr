# Preview-only (never committed): observe scoped `items` prop updates so the harness can compare item and artwork counts with List appearance
# counts, without changing the rail's rendering or ForEach key. Usage: patch_rail.py <MediaRail.ets>.
import sys
p = sys.argv[1]
s = open(p).read()
if "@Prop previewRoute" in s:
    sys.exit(0)
assert "item.stamp" in s, "MediaRail's ForEach key no longer carries the item stamp: re-check this patch"
insert_at = s.index("import ")
s = s[:insert_at] + "import { image } from '@kit.ImageKit';\nimport { reportDetailLayoutStageForScope, reportDetailRowImageStageForScope } from '../../util/PreviewState';\n" + s[insert_at:]
component = "@Component\nexport struct MediaRail {"
assert component in s
s = s.replace(component, "interface PreviewMediaRailArtworkStateView {\n  pixelMap: image.PixelMap | undefined;\n}\n\ninterface PreviewMediaRailArtworkCountItem extends MediaRailItem {\n  artworkState?: PreviewMediaRailArtworkStateView;\n}\n\n" + component, 1)
plain = "  items: MediaRailItem[] = [];\n"
prop = "  @Prop items: MediaRailItem[] = [];\n"
watched_prop = "  @Prop @Watch('previewItemsUpdated') items: MediaRailItem[] = [];\n"
preview_prop = "  @Prop previewRoute: string = '';\n  @Prop previewWorkId: string = '';\n  @Prop previewGeneration: number = 0;\n"
if plain in s:
    s = s.replace(plain, preview_prop + watched_prop, 1)
elif prop in s:
    s = s.replace(prop, preview_prop + watched_prop, 1)
else:
    raise AssertionError("MediaRail items property changed; re-check the diagnostic patch")
build = "  build() {\n"
assert build in s
watch = """  private previewItemsUpdated(): void {
    if (this.previewRoute !== 'Detail' || this.previewWorkId.length === 0) {
      return;
    }
    let artworkCount = 0;
    for (const item of this.items) {
      const previewItem = item as PreviewMediaRailArtworkCountItem;
      const artworkState = previewItem.artworkState;
      if (artworkState !== undefined && artworkState.pixelMap !== undefined) {
        artworkCount += 1;
      }
    }
    reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration,
      'rail-items-prop-update-count', this.items.length, -1, -1);
    reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration,
      'rail-items-prop-update-artwork-count', artworkCount, -1, -1);
  }

"""
s = s.replace(build, watch + build, 1)
height = "      .height(this.listHeight > 0 ? this.listHeight : '100%')\n"
assert height in s
s = s.replace(height, height + "      .onAreaChange((_old: Area, area: Area) => { reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-list-area', 0, Number(area.width), Number(area.height)); })\n", 1)
builder = "            ListItem() {\n              this.itemBuilder(item, index, this.activeRailFactor)\n            }"
assert builder in s
s = s.replace(builder, "            ListItem() {\n              this.itemBuilder(item, index, this.activeRailFactor)\n            }\n            .onAppear(() => {\n              if (this.previewRoute === 'Detail' && this.previewWorkId.length > 0) {\n                const previewItem = item as PreviewMediaRailArtworkCountItem;\n                const artworkState = previewItem.artworkState;\n                reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, item.id, this.previewGeneration,\n                  artworkState !== undefined && artworkState.pixelMap !== undefined\n                    ? 'visible-item-artwork-state-present' : 'visible-item-artwork-state-absent');\n              }\n              reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-item-appear', 1, -1, -1);\n            })", 1)
list_on_appear = "      .height(this.listHeight > 0 ? this.listHeight : '100%')\n"
assert list_on_appear in s
s = s.replace(list_on_appear, list_on_appear + "      .onAppear(() => {\n        reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-items-count', this.items.length, -1, -1);\n        if (this.listHeight > 0) {\n          reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-list-height-explicit', this.listHeight, -1, -1);\n        } else {\n          reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-list-height-default-fill', 0, -1, -1);\n        }\n      })\n", 1)
open(p, 'w').write(s)
