/**
 * One line of text that shortens itself with an ellipsis (web `text-overflow: ellipsis`). ArkUI's own ellipsis is drawn outside the
 * text's glyph runs, so the layout export could not read it; here the app measures its laid-out width and puts the shortened string
 * (with the "…" in it) into the Text, which makes the ellipsis a real glyph run like any other character.
 */

import { nunitoAt, webLineHeight } from '../Typography';
import { activeColors, toResourceColor } from '../Theme';
import type { ThemeModeSetting } from '../Theme';

@Component
export struct FitLine {
  @Prop content: string = '';
  @Prop size: number = 12;
  @Prop weight: number = 400;
  @Prop shiftY: number = 0;
  @Prop gapBottom: number = 0;
  @State private shown: string = '';
  private width: number = -1;

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  private measure(text: string): number {
    const ui = this.getUIContext();
    return ui.px2vp(ui.getMeasureUtils().measureText({
      textContent: text,
      fontSize: this.size,
      fontFamily: nunitoAt(this.weight, this.size),
      fontWeight: this.weight,
    }));
  }

  /** The longest start of the text that, with an ellipsis, fits the width. */
  private fit(): string {
    if (this.width < 0 || this.measure(this.content) <= this.width) {
      return this.content;
    }
    let lo: number = 0;
    let hi: number = this.content.length;
    while (lo < hi) {
      const mid: number = Math.ceil((lo + hi) / 2);
      if (this.measure(this.content.substring(0, mid).trimEnd() + '…') <= this.width) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return this.content.substring(0, lo).trimEnd() + '…';
  }

  aboutToAppear(): void {
    this.shown = this.content;
  }

  build() {
    Text(this.shown.length > 0 ? this.shown : this.content).fontFamily(nunitoAt(this.weight, this.size))
      .fontSize(this.size).translate({ y: this.shiftY }).lineHeight(webLineHeight(this.size)).halfLeading(true)
      .fontWeight(this.weight >= 600 ? FontWeight.Bold : FontWeight.Normal)
      .fontColor(toResourceColor(activeColors().ink))
      .maxLines(1)
      .margin({ bottom: this.gapBottom })
      .layoutWeight(1)
      .onAreaChange((_old: Area, area: Area): void => {
        const w: number = Number(area.width);
        if (w !== this.width) {
          this.width = w;
          this.shown = this.fit();
        }
      })
  }
}
