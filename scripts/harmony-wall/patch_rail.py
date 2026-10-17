# Preview-only (never committed): observe scoped item updates and layout without changing the rail rendering or ForEach key.
# Usage: patch_rail.py <MediaRail.ets>.
import sys
from pathlib import Path


def transform(s):
    if "@Prop previewRoute" in s:
        return s
    assert "item.stamp" in s, "MediaRail's ForEach key no longer carries the item stamp: re-check this patch"
    insert_at = s.index("import ")
    s = s[:insert_at] + "import { reportDetailLayoutStageForScope, previewReport } from '../../util/PreviewState';\n" + s[insert_at:]
    component = "@Component\nexport struct MediaRail {"
    assert component in s
    plain = "  items: MediaRailItem[] = [];\n"
    prop = "  @Prop items: MediaRailItem[] = [];\n"
    watched_prop = "  @Prop @Watch('previewItemsUpdated') items: MediaRailItem[] = [];\n"
    preview_prop = "  @Prop previewRoute: string = '';\n  @Prop previewWorkId: string = '';\n  @Prop previewGeneration: number = 0;\n"
    preview_target_prop = "  @Prop previewTargetEpisodeId: string = '';\n"
    if plain in s:
        s = s.replace(plain, preview_prop + preview_target_prop + watched_prop, 1)
    elif prop in s:
        s = s.replace(prop, preview_prop + preview_target_prop + watched_prop, 1)
    else:
        raise AssertionError("MediaRail items property changed; re-check the diagnostic patch")
    build = "  build() {\n"
    assert build in s
    watch = """  private previewItemsUpdated(): void {
    previewReport('dbg=' + encodeURIComponent('ri:' + this.railId + ':' + this.items.filter((item: MediaRailItem): boolean => item.stamp === 'art').length.toString()));  // temporary diagnostic: lost-update hunt
    if (this.previewRoute !== 'Detail' || this.previewWorkId.length === 0) {
      return;
    }
    reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration,
      'rail-items-prop-update-count', this.items.length, -1, -1);
    this.reportPreviewLiveTargetIndex('target-episode-live-prop-target');
  }

"""
    watch = watch + """  private reportPreviewLiveTargetIndex(stage: string): void {
    if (this.previewRoute !== 'Detail' || this.previewWorkId.length === 0 ||
        this.previewTargetEpisodeId.length === 0) {
      return;
    }
    const targetIndex = this.items.findIndex((item: MediaRailItem): boolean =>
      item.id === this.previewTargetEpisodeId
    );
    reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration,
      stage + '-found', targetIndex >= 0 ? 1 : 0, -1, -1);
    if (targetIndex >= 0) {
      reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration,
        stage + '-index', targetIndex, -1, -1);
    }
  }

"""
    source_watch = "  private onInitialItemIndexChanged(): void {\n    this.scrollToInitialItem();\n  }\n\n"
    assert s.count(source_watch) == 1
    index_watch = "  private reportPreviewEpisodeIndex(stage: string, index: number): void {\n    if (this.previewRoute !== 'Detail' || this.previewWorkId.length === 0 || index < 0) {\n      return;\n    }\n    reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration,\n      stage, index, -1, -1);\n  }\n\n  private onInitialItemIndexChanged(): void {\n    this.reportPreviewEpisodeIndex('target-episode-initial-index-watch', this.initialItemIndex);\n    this.scrollToInitialItem();\n  }\n\n"
    s = s.replace(source_watch, index_watch, 1)
    s = s.replace("    this.reportPreviewEpisodeIndex('target-episode-initial-index-watch', this.initialItemIndex);", "    reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration,\n      'target-episode-initial-index-watch-hook-ran', 1, -1, -1);\n    this.reportPreviewEpisodeIndex('target-episode-initial-index-watch', this.initialItemIndex);\n    this.reportPreviewLiveTargetIndex('target-episode-live-prop-target');", 1)
    applied_index = "    this.appliedInitialItemIndex = this.initialItemIndex;\n    this.listScroller.scrollToIndex(this.initialItemIndex, false, ScrollAlign.CENTER);\n    this.onInitialItemPositioned();"
    assert s.count(applied_index) == 1
    s = s.replace(applied_index, "    this.appliedInitialItemIndex = this.initialItemIndex;\n    this.listScroller.scrollToIndex(this.initialItemIndex, false, ScrollAlign.CENTER);\n    this.reportPreviewEpisodeIndex('target-episode-initial-index-applied', this.initialItemIndex);\n    this.reportPreviewEpisodeIndex('target-episode-live-item-count-at-callback', this.items.length);\n    this.reportPreviewLiveTargetIndex('target-episode-live-prop-target-at-callback');\n    this.onInitialItemPositioned();", 1)
    s = s.replace(build, watch + build, 1)
    area_callback = """      .onAreaChange((_oldArea: Area, area: Area) => {
        this.onListOffsetChange(this.listScroller.currentOffset().xOffset);
        this.onListAreaChange(area);
      })"""
    assert s.count(area_callback) == 1
    s = s.replace(area_callback, """      .onAreaChange((_oldArea: Area, area: Area) => {
        this.onListOffsetChange(this.listScroller.currentOffset().xOffset);
        this.onListAreaChange(area);
        reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration,
          'rail-list-area', 0, Number(area.width), Number(area.height));
      })""", 1)
    builder = "            ListItem() {\n              this.itemBuilder(item, index, this.activeRailFactor)\n            }"
    assert builder in s
    s = s.replace(builder, "            ListItem() {\n              this.itemBuilder(item, index, this.activeRailFactor)\n            }\n            .onAppear(() => {\n              reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-item-appear', 1, -1, -1);\n            })", 1)
    list_on_appear = """      .onAppear(() => {
        this.listHasAppeared = true;
        this.onListOffsetChange(this.listScroller.currentOffset().xOffset);
        this.scrollToInitialItem();
      })"""
    assert s.count(list_on_appear) == 1
    s = s.replace(list_on_appear, """      .onAppear(() => {
        this.listHasAppeared = true;
        reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration,
          'target-episode-list-appeared-hook-ran', 1, -1, -1);
        this.reportPreviewEpisodeIndex('target-episode-list-appeared', this.initialItemIndex);
        this.reportPreviewLiveTargetIndex('target-episode-live-prop-target');
        reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration,
          'rail-items-count', this.items.length, -1, -1);
        if (this.listHeight > 0) {
          reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration,
            'rail-list-height-explicit', this.listHeight, -1, -1);
        } else {
          reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration,
            'rail-list-height-default-fill', 0, -1, -1);
        }
        this.onListOffsetChange(this.listScroller.currentOffset().xOffset);
        this.scrollToInitialItem();
      })""", 1)
    return s


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: patch_rail.py <MediaRail.ets>')
    p = Path(sys.argv[1])
    s = p.read_text(encoding='utf-8')
    patched = transform(s)
    if patched != s:
        p.write_text(patched, encoding='utf-8')
