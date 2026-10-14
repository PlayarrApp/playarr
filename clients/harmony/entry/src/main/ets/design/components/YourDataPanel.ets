/**
 * Settings > Your data on TV (web `pages/settings/YourData.tsx`, ten-foot branch): Export my data prepares a package
 * and shows a one-time download code (QR) for another device; Import opens an upload session whose code another
 * device scans, then previews what the package would change and applies it.
 */

import { nunito } from '../Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import { tv } from '../Metrics';
import { getServerDirectory } from '../../AppContainer';
import { absoluteUrl } from '../../core/Url';
import { formatBytes, previewLines, resultLine } from '../../core/PortableData';
import type { UserDataExportJob, UserDataImportSession, UserDataImportPreview, UserDataImportResult } from '../../core/Types/PortableData';
import {
  startDataExport,
  getDataExport,
  createExportTransferLink,
  createImportSession,
  getImportSession,
  deleteImportSession,
  previewImportSession,
  applyImportSession,
} from '../../data/PortableDataRepository';

const POLL_MS: number = 1500;

@Component
export struct YourDataPanel {
  @Prop panelWidth: number = 1042;
  @State private exportJob: UserDataExportJob | null = null;
  @State private exportBusy: boolean = false;
  @State private exportError: string = '';
  @State private exportLink: string = '';
  @State private session: UserDataImportSession | null = null;
  @State private uploadLink: string = '';
  @State private keepExisting: boolean = false;
  @State private includePreferences: boolean = false;
  @State private preview: UserDataImportPreview | null = null;
  @State private result: UserDataImportResult | null = null;
  @State private importBusy: boolean = false;
  @State private importError: string = '';
  /** Bumped to stop a running poll when the panel goes away or a new one starts. */
  private pollTicket: number = 0;
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: string = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  aboutToDisappear(): void {
    this.pollTicket = this.pollTicket + 1;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, ms);
    });
  }

  /** A link the server returned: absolute when it says so, else resolved against this device's server. */
  private resolve(url: string | null | undefined, path: string | null): string {
    if (url !== undefined && url !== null && url.length > 0) {
      return url;
    }
    const base = getServerDirectory().getActiveBaseUrl();
    return base !== null && path !== null ? absoluteUrl(base, path) : '';
  }

  private async startExport(): Promise<void> {
    this.exportBusy = true;
    this.exportError = '';
    this.exportLink = '';
    const ticket = this.pollTicket + 1;
    this.pollTicket = ticket;
    const started = await startDataExport();
    if (started.kind !== 'ok') {
      this.exportError = 'The export could not be started. Try again.';
      this.exportBusy = false;
      return;
    }
    let job: UserDataExportJob = started.value;
    this.exportJob = job;
    while ((job.status === 'queued' || job.status === 'running') && this.pollTicket === ticket) {
      await this.sleep(POLL_MS);
      const next = await getDataExport(job.id);
      if (next.kind !== 'ok') {
        this.exportError = 'The export could not be completed. Try again.';
        break;
      }
      job = next.value;
      this.exportJob = job;
    }
    this.exportBusy = false;
  }

  private async showExportCode(): Promise<void> {
    const job = this.exportJob;
    if (job === null) {
      return;
    }
    const link = await createExportTransferLink(job.id);
    if (link.kind === 'ok') {
      this.exportLink = this.resolve(link.value.url, link.value.path);
    } else {
      this.exportError = 'The download code could not be created. Try again.';
    }
  }

  private exportStatus(job: UserDataExportJob): string {
    if (job.status === 'ready') {
      return 'Ready: ' + job.counts.watch_progress + ' watch records and ' + job.counts.playlists + ' playlists.';
    }
    if (job.status === 'failed') {
      return 'The export could not be completed. Try again.';
    }
    if (job.status === 'expired') {
      return 'This export expired. Prepare a new one.';
    }
    return 'Working on: ' + job.progress.stage;
  }

  private async startSession(): Promise<void> {
    this.importBusy = true;
    this.importError = '';
    this.preview = null;
    this.result = null;
    const ticket = this.pollTicket + 1;
    this.pollTicket = ticket;
    const created = await createImportSession();
    if (created.kind !== 'ok') {
      this.importError = 'The upload code could not be created. Try again.';
      this.importBusy = false;
      return;
    }
    this.session = created.value;
    this.uploadLink = this.resolve(created.value.upload_url, created.value.upload_path);
    this.importBusy = false;
    while (this.session !== null && this.session.status !== 'uploaded' && this.pollTicket === ticket) {
      await this.sleep(POLL_MS);
      const next = await getImportSession(created.value.id);
      if (next.kind !== 'ok') {
        this.importError = 'This code has expired. Show a new one to try again.';
        return;
      }
      this.session = next.value;
    }
  }

  private async cancelSession(): Promise<void> {
    const session = this.session;
    this.pollTicket = this.pollTicket + 1;
    this.session = null;
    this.uploadLink = '';
    if (session !== null) {
      await deleteImportSession(session.id);
    }
  }

  private async runPreview(): Promise<void> {
    const session = this.session;
    if (session === null || session.status !== 'uploaded' || this.importBusy) {
      return;
    }
    this.importBusy = true;
    this.importError = '';
    this.result = null;
    const previewed = await previewImportSession(session.id, this.includePreferences, this.keepExisting);
    if (previewed.kind === 'ok') {
      this.preview = previewed.value;
    } else {
      this.importError = 'The package could not be read. Check that it is a Playarr data file.';
    }
    this.importBusy = false;
  }

  private async runApply(): Promise<void> {
    const session = this.session;
    const preview = this.preview;
    if (session === null || preview === null || this.importBusy || this.result !== null) {
      return;
    }
    this.importBusy = true;
    this.importError = '';
    const applied = await applyImportSession(session.id, preview.package_sha256, this.includePreferences, this.keepExisting);
    if (applied.kind === 'ok') {
      this.result = applied.value;
    } else {
      this.importError = 'The import could not be applied. Running it again is safe.';
    }
    this.importBusy = false;
  }

  @Builder
  private heading(text: string): void {
    Text(text).fontFamily(nunito(500))
      .fontSize(tv(26.4))
      .fontWeight(FontWeight.Medium)
      .letterSpacing(tv(-0.924))
      .fontColor(toResourceColor(activeColors().ink))
  }

  @Builder
  private copy(text: string, soft: boolean): void {
    Text(text).fontFamily(nunito(400))
      .fontSize(tv(13.824))
      .fontColor(toResourceColor(soft ? activeColors().inkSoft : activeColors().inkMuted))
      .width(tv(this.panelWidth))
  }

  @Builder
  private button(label: string, primary: boolean, enabled: boolean, onTap: () => void): void {
    Text(label).fontFamily(nunito(700))
      .fontSize(tv(13.824))
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(primary ? activeColors().bg : activeColors().ink))
      .backgroundColor(primary ? toResourceColorWithAlpha(activeColors().ink, enabled ? 1 : 0.4) : toResourceColorWithAlpha(activeColors().surfaceSoft, 0.64))
      .borderRadius(tv(22))
      .padding({ left: tv(24), right: tv(24), top: tv(12), bottom: tv(12) })
      .focusable(enabled)
      .onClick(() => {
        if (enabled) {
          onTap();
        }
      })
  }

  @Builder
  private qr(value: string): void {
    QRCode(value)
      .width(tv(280))
      .height(tv(280))
      .color('#000000')
      .backgroundColor('#FFFFFF')
  }

  build() {
    Scroll() {
      Column({ space: tv(14) }) {
        this.heading('Export my data')
        this.copy('Creates one ZIP with your watch progress, personal playlists (in order) and audio-language preference. Open the CSV files in a spreadsheet, or keep the file to import elsewhere.', true)
        this.copy("The file contains only this profile's data. It never contains passwords, tokens, file paths, other people's activity or the media itself.", false)
        Row({ space: tv(12) }) {
          this.button(this.exportBusy ? 'Preparing...' : 'Prepare my data', true, !this.exportBusy, (): void => {
            this.startExport();
          })
          if (this.exportJob !== null && this.exportJob.status === 'ready') {
            this.button(this.exportLink.length > 0 ? 'Show a new code' : 'Show download code', false, true, (): void => {
              this.showExportCode();
            })
          }
        }
        if (this.exportJob !== null) {
          this.copy(this.exportStatus(this.exportJob), true)
        }
        if (this.exportLink.length > 0) {
          this.copy('Scan this code with your phone or computer camera, open the link and save the file there. The link works once.', true)
          this.qr(this.exportLink)
        }
        if (this.exportError.length > 0) {
          Text(this.exportError).fontFamily(nunito(400))
            .fontSize(tv(13.824))
            .fontColor(toResourceColor(activeColors().danger))
        }

        Divider().width(tv(this.panelWidth)).strokeWidth(1).color(toResourceColorWithAlpha(activeColors().ink, 0.083)).margin({ top: tv(16), bottom: tv(16) })

        this.heading('Import data')
        this.copy('Choose a Playarr export. You will see what it would change before anything is saved. Nothing is deleted, and your account, permissions and other profiles are never touched.', true)
        Row({ space: tv(12) }) {
          this.button(this.session !== null ? 'Show a new code' : 'Upload from another device', true,
            !this.importBusy && !(this.session !== null && this.session.status === 'uploading'), (): void => {
            this.startSession();
          })
          if (this.session !== null) {
            this.button('Cancel', false, true, (): void => {
              this.cancelSession();
            })
          }
        }
        if (this.session !== null && this.session.status === 'waiting' && this.uploadLink.length > 0) {
          this.copy('Scan this code with your phone or computer camera, then choose your Playarr data file on that device. You review everything here before it is applied.', true)
          this.qr(this.uploadLink)
        }
        if (this.session !== null && this.session.status === 'uploading') {
          this.copy('Receiving the file...', true)
        }
        if (this.session !== null && this.session.status === 'uploaded') {
          this.copy('File received (' + formatBytes(this.session.size_bytes) + '). Review it below.', true)
        }
        Text('If progress already exists').fontFamily(nunito(700))
          .fontSize(tv(13.824))
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().ink))
        Row({ space: tv(12) }) {
          this.button('Keep whichever is newer', !this.keepExisting, true, (): void => {
            this.keepExisting = false;
          })
          this.button('Always keep what is here', this.keepExisting, true, (): void => {
            this.keepExisting = true;
          })
        }
        this.button(this.includePreferences ? '✓ Also apply my audio-language preference' : 'Also apply my audio-language preference', this.includePreferences, true, (): void => {
          this.includePreferences = !this.includePreferences;
        })
        this.button('Preview import', false, this.session !== null && this.session.status === 'uploaded' && !this.importBusy, (): void => {
          this.runPreview();
        })
        if (this.importError.length > 0) {
          Text(this.importError).fontFamily(nunito(400))
            .fontSize(tv(13.824))
            .fontColor(toResourceColor(activeColors().danger))
        }
        if (this.preview !== null) {
          Text('What this import would do').fontFamily(nunito(700))
            .fontSize(tv(16))
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(activeColors().ink))
          ForEach(this.preview.warnings, (warning: string) => {
            this.copy(warning, false)
          }, (warning: string): string => warning)
          ForEach(previewLines(this.preview), (line: string) => {
            this.copy('• ' + line, true)
          }, (line: string): string => line)
          this.copy('Applying writes these changes to your profile only. Running the same import again changes nothing.', false)
          this.button('Apply import', true, !this.importBusy && this.result === null, (): void => {
            this.runApply();
          })
        }
        if (this.result !== null) {
          Text(resultLine(this.result)).fontFamily(nunito(400))
            .fontSize(tv(13.824))
            .fontColor(toResourceColor(this.result.completed ? activeColors().inkSoft : activeColors().danger))
            .width(tv(this.panelWidth))
        }
      }
      .alignItems(HorizontalAlign.Start)
      .padding({ bottom: tv(80) })
    }
    .scrollBar(BarState.Off)
    .width(tv(this.panelWidth))
    .height(tv(1080 - 210))
  }
}
