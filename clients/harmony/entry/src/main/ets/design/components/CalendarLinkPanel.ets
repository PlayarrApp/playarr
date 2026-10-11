/**
 * The calendar (iCal) link in the Calendar's right drawer (web `CalendarLink`): your private link as a QR code and
 * text, how to add it to Google, Apple or Outlook Calendar, and a Reset link action that asks first. One status
 * call, then at most one POST that never replaces an existing link. The server shows the secret URL only when it is
 * created, so the device remembers it per server and profile. Not here: Copy link (a TV has no useful clipboard; the
 * QR is the way to move the link to a phone).
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import { getCalendarFeed, createCalendarFeed } from '../../data/CalendarRepository';
import { getServerDirectory, loadStoredCalendarLink, storeCalendarLink } from '../../AppContainer';
import { planCalendarLinkOpen, classifyCalendarLinkFailure, calendarLinkFailureText, calendarLinkScope } from '../../core/CalendarLink';

const TEXT_SIZE: number = 13.44;
const HEADING_SIZE: number = 15.36;
const QR_SIZE: number = 168;
const PILL_HEIGHT: number = 44;
const PILL_PADDING: number = 17.28;
const PILL_SIZE: number = 12.48;
const SECTION_GAP: number = 16;
const PANEL_WIDTH: number = 268;

@Component
export struct CalendarLinkPanel {
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private url: string = '';
  @State private busy: boolean = true;
  @State private failure: string = '';
  @State private needsReset: boolean = false;
  @State private confirming: boolean = false;

  aboutToAppear(): void {
    this.open();
  }

  private scope(): string {
    const profileId = AppStorage.get<string>('currentProfileId');
    return calendarLinkScope(getServerDirectory().getActiveBaseUrl() ?? '', profileId !== undefined ? profileId : '');
  }

  private show(link: string): void {
    this.url = link;
    this.needsReset = false;
    this.confirming = false;
    storeCalendarLink(this.scope(), link);
  }

  private async open(): Promise<void> {
    this.busy = true;
    this.failure = '';
    const stored = await loadStoredCalendarLink(this.scope());
    const status = await getCalendarFeed();
    if (status.kind === 'network_failure') {
      this.failure = calendarLinkFailureText('unreachable');
      this.busy = false;
      return;
    }
    if (status.kind === 'http_failure') {
      this.failure = calendarLinkFailureText(classifyCalendarLinkFailure(status.status));
      this.busy = false;
      return;
    }
    const plan = planCalendarLinkOpen(status.value.active, status.value.link_available, stored.length > 0 ? stored : null);
    if (plan === 'fetch') {
      await this.create(false);
    } else if (plan === 'stored') {
      this.show(stored);
    } else {
      this.needsReset = true;
    }
    this.busy = false;
  }

  private async create(rotate: boolean): Promise<void> {
    const result = await createCalendarFeed(rotate);
    if (result.kind === 'ok') {
      this.show(result.value.url);
    } else if (result.kind === 'network_failure') {
      this.failure = calendarLinkFailureText('unreachable');
    } else {
      this.failure = calendarLinkFailureText(classifyCalendarLinkFailure(result.status));
    }
  }

  private async reset(): Promise<void> {
    this.busy = true;
    this.failure = '';
    await this.create(true);
    this.confirming = false;
    this.busy = false;
  }

  @Builder
  private pill(label: string, onTap: () => void): void {
    Text(label)
      .fontSize(tv(PILL_SIZE))
      .fontColor(toResourceColor(activeColors().ink))
      .height(tv(PILL_HEIGHT))
      .padding({ left: tv(PILL_PADDING), right: tv(PILL_PADDING) })
      .borderRadius(tv(PILL_HEIGHT / 2))
      .backgroundColor(toResourceColor(activeColors().surfaceSoft))
      .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.15) })
      .focusable(true)
      .onClick(onTap)
  }

  @Builder
  private body(text: string, muted: boolean): void {
    Text(text)
      .fontSize(tv(TEXT_SIZE))
      .fontColor(toResourceColor(muted ? activeColors().inkSoft : activeColors().ink))
      .width(tv(PANEL_WIDTH))
  }

  build() {
    Column({ space: tv(SECTION_GAP) }) {
      this.body('Add your releases to Google, Apple or Outlook Calendar with this private link. Anyone with the link can see your releases, so keep it secret.', true)
      if (this.failure.length > 0) {
        this.body(this.failure, false)
        this.pill('Try again', (): void => {
          this.open();
        })
      }
      if (this.busy && this.url.length === 0) {
        this.body('Getting your link…', true)
      }
      if (this.url.length > 0) {
        QRCode(this.url)
          .width(tv(QR_SIZE))
          .height(tv(QR_SIZE))
          .color('#000000')
          .backgroundColor('#FFFFFF')
          .focusable(false)
        Text(this.url)
          .fontSize(tv(11))
          .fontColor(toResourceColor(activeColors().inkSoft))
          .width(tv(PANEL_WIDTH))
          .maxLines(4)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      if (this.needsReset && this.url.length === 0) {
        this.body('Your link was created on another device and is not stored here. Reset it to get a new link to copy.', true)
      }
      Text('Add it to your calendar app')
        .fontSize(tv(HEADING_SIZE))
        .fontWeight(FontWeight.Medium)
        .fontColor(toResourceColor(activeColors().ink))
      this.body('Google Calendar: Other calendars (+) > From URL, then paste the link.', true)
      this.body('Apple Calendar: File > New Calendar Subscription, then paste the link.', true)
      this.body('Outlook: Add calendar > Subscribe from web, then paste the link.', true)
      if (this.confirming) {
        this.body('Resetting makes a new link and the current link stops working straight away. Calendars using it will need the new link.', false)
        Row({ space: tv(9.6) }) {
          this.pill('Reset link', (): void => {
            this.reset();
          })
          this.pill('Cancel', (): void => {
            this.confirming = false;
          })
        }
      } else if (!this.busy && this.failure.length === 0) {
        this.pill('Reset link', (): void => {
          this.confirming = true;
        })
      }
    }
    .alignItems(HorizontalAlign.Start)
  }
}
