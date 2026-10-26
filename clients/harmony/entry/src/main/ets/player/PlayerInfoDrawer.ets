/**
 * The player's info panel (web's "i" button): the shared right-hand Drawer with what is playing (title, a meta line, the synopsis) and
 * plain facts about how it reaches this device (delivery, quality, audio, subtitles). Read-only; the facts come from the negotiation
 * response `pages/Player.ets` already holds, nothing is fetched here.
 */

import { nunito, nunitoAt, webLineHeight } from '../design/Typography';
import { Drawer } from '../design/components/Drawer';
import { activeColors, toResourceColor } from '../design/Theme';
import { tv } from '../design/Metrics';
import { t } from '../core/Language';

const TITLE_SIZE: number = 22;
const META_SIZE: number = 13;
const SYNOPSIS_SIZE: number = 14;
const FACT_SIZE: number = 13;
const SECTION_GAP: number = 18;
const FACT_LABEL_WIDTH: number = 110;

/** One label and value row of the stream facts. */
export interface InfoFact {
  label: string;
  value: string;
}

@Component
export struct PlayerInfoDrawer {
  @Prop title: string = '';
  @Prop meta: string = '';
  @Prop synopsis: string = '';
  @Prop facts: InfoFact[] = [];
  onClose: () => void = () => {};

  @Builder
  private infoBody(): void {
    Column({ space: tv(SECTION_GAP) }) {
      Text(this.title).fontFamily(nunitoAt(500, tv(TITLE_SIZE)))
        .fontSize(tv(TITLE_SIZE)).lineHeight(webLineHeight(tv(TITLE_SIZE))).halfLeading(true)
        .fontWeight(FontWeight.Medium)
        .fontColor(toResourceColor(activeColors().ink))
        .width('100%')
      if (this.meta.length > 0) {
        Text(this.meta).fontFamily(nunitoAt(400, tv(META_SIZE)))
          .fontSize(tv(META_SIZE)).lineHeight(webLineHeight(tv(META_SIZE))).halfLeading(true)
          .fontColor(toResourceColor(activeColors().inkSoft))
          .width('100%')
      }
      if (this.synopsis.length > 0) {
        Text(this.synopsis).fontFamily(nunitoAt(400, tv(SYNOPSIS_SIZE)))
          .fontSize(tv(SYNOPSIS_SIZE)).lineHeight(webLineHeight(tv(SYNOPSIS_SIZE))).halfLeading(true)
          .fontColor(toResourceColor(activeColors().inkSoft))
          .maxLines(8)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      Column({ space: tv(10) }) {
        ForEach(this.facts, (fact: InfoFact) => {
          Row({ space: tv(12) }) {
            Text(fact.label).fontFamily(nunitoAt(400, tv(FACT_SIZE)))
              .fontSize(tv(FACT_SIZE)).lineHeight(webLineHeight(tv(FACT_SIZE))).halfLeading(true)
              .fontColor(toResourceColor(activeColors().inkMuted))
              .width(tv(FACT_LABEL_WIDTH))
            Text(fact.value).fontFamily(nunitoAt(400, tv(FACT_SIZE)))
              .fontSize(tv(FACT_SIZE)).lineHeight(webLineHeight(tv(FACT_SIZE))).halfLeading(true)
              .fontColor(toResourceColor(activeColors().ink))
              .layoutWeight(1)
          }
          .width('100%')
          .alignItems(VerticalAlign.Top)
        }, (fact: InfoFact): string => fact.label)
      }
      .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  build() {
    Drawer({
      kicker: t('pages.workDetail.playbackButtonLabel', 'Playback'),
      title: 'Info',
      onClose: (): void => {
        this.onClose();
      },
      body: (): void => {
        this.infoBody();
      },
    })
  }
}
