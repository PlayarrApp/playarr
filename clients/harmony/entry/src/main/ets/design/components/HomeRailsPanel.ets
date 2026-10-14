/**
 * Settings > Customise Home (web `pages/settings/Home.tsx`): the rails the admin enabled, each with Show/Hide and move
 * up / down, saved on every change, plus Reset to default.
 */

import { nunito } from '../Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import { tv } from '../Metrics';
import type { RailPreferenceEntry } from '../../core/Types/Catalog';
import { moveRail, toggleRail, toPreferencesRequest } from '../../core/RailPrefs';
import { getRailPreferences, saveRailPreferences, resetRailPreferences } from '../../data/CatalogRepository';

@Component
export struct HomeRailsPanel {
  @Prop panelWidth: number = 1042;
  @State private rails: RailPreferenceEntry[] = [];
  /** 'loading', 'ready' or 'error'. */
  @State private status: string = 'loading';
  @State private saveError: string = '';
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: string = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.status = 'loading';
    const result = await getRailPreferences();
    if (result.kind === 'ok') {
      this.rails = result.value.rails;
      this.status = 'ready';
    } else {
      this.status = 'error';
    }
  }

  /** Web `save`: show the change at once, then send it; a failure is reported under the list. */
  private async save(next: RailPreferenceEntry[]): Promise<void> {
    this.rails = next;
    this.saveError = '';
    const result = await saveRailPreferences(toPreferencesRequest(next));
    if (result.kind !== 'ok') {
      this.saveError = 'Could not save the change.';
    }
  }

  private async reset(): Promise<void> {
    this.saveError = '';
    const result = await resetRailPreferences();
    if (result.kind !== 'ok') {
      this.saveError = 'Could not reset the rails.';
      return;
    }
    await this.load();
  }

  @Builder
  private pill(label: string, enabled: boolean, onTap: () => void): void {
    Text(label).fontFamily(nunito(700))
      .fontSize(tv(12.5))
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(enabled ? activeColors().ink : activeColors().inkMuted))
      .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceSoft, 0.64))
      .borderRadius(tv(18))
      .padding({ left: tv(16), right: tv(16), top: tv(9), bottom: tv(9) })
      .focusable(enabled)
      .onClick(() => {
        if (enabled) {
          onTap();
        }
      })
  }

  build() {
    Column({ space: tv(14) }) {
      if (this.status === 'loading') {
        Text('Loading your rails').fontFamily(nunito(400))
          .fontSize(tv(13.824))
          .fontColor(toResourceColor(activeColors().inkSoft))
      } else if (this.status === 'error') {
        Text('Could not load your rails.').fontFamily(nunito(400))
          .fontSize(tv(13.824))
          .fontColor(toResourceColor(activeColors().danger))
        this.pill('Retry', true, (): void => {
          this.load();
        })
      } else {
        Text('Choose which rails appear on Home and in what order.').fontFamily(nunito(400))
          .fontSize(tv(13.824))
          .fontColor(toResourceColor(activeColors().inkSoft))
        Scroll() {
          Column({ space: tv(8) }) {
            ForEach(this.rails, (rail: RailPreferenceEntry, index: number) => {
              Row({ space: tv(10) }) {
                Text(rail.title).fontFamily(nunito(500))
                  .fontSize(tv(16))
                  .fontWeight(FontWeight.Medium)
                  .fontColor(toResourceColorWithAlpha(activeColors().ink, rail.hidden ? 0.5 : 1))
                  .layoutWeight(1)
                this.pill(rail.hidden ? 'Show' : 'Hide', true, (): void => {
                  this.save(toggleRail(this.rails, rail.id));
                })
                this.pill('↑', index > 0, (): void => {
                  this.save(moveRail(this.rails, rail.id, -1));
                })
                this.pill('↓', index < this.rails.length - 1, (): void => {
                  this.save(moveRail(this.rails, rail.id, 1));
                })
              }
              .width(tv(this.panelWidth))
            }, (rail: RailPreferenceEntry): string => `${rail.id}:${rail.hidden}`)
            this.pill('Reset to default', true, (): void => {
              this.reset();
            })
          }
          .alignItems(HorizontalAlign.Start)
          .padding({ bottom: tv(60) })
        }
        .scrollBar(BarState.Off)
        .height(tv(700))
        if (this.saveError.length > 0) {
          Text(this.saveError).fontFamily(nunito(400))
            .fontSize(tv(13.824))
            .fontColor(toResourceColor(activeColors().danger))
        }
      }
    }
    .width(tv(this.panelWidth))
    .alignItems(HorizontalAlign.Start)
  }
}
