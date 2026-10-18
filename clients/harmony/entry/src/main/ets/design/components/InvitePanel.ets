/**
 * Settings > Invite a friend (web `pages/settings/Invite.tsx`): the request status, an optional message, Request invite
 * QR / Generate invite QR, then the one-use QR and link. Approval push notifications are not offered (no push service
 * on this platform here). The link carries this device's own server address, web's fallback for a non-admin.
 */

import { nunito } from '../Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import { tv } from '../Metrics';
import type { UserInviteRequest } from '../../core/Types/Profiles';
import { buildInviteUrl } from '../../core/InviteUrl';
import { getMyInviteRequest, createInviteRequest, generateApprovedInvite } from '../../data/ProfileRepository';
import { getServerDirectory } from '../../AppContainer';
import { t } from '../../core/Language';

@Component
export struct InvitePanel {
  @Prop panelWidth: number = 1042;
  @State private request: UserInviteRequest | null = null;
  /** 'loading', 'ready', 'saving' or 'error'. */
  @State private status: string = 'loading';
  @State private errorText: string = '';
  @State private message: string = '';
  @State private link: string = '';
  @State private expiresAt: string = '';
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: string = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  aboutToAppear(): void {
    this.refresh();
  }

  private async refresh(): Promise<void> {
    const result = await getMyInviteRequest();
    if (result.kind === 'ok') {
      const value = result.value;
      this.request = value !== null && typeof value.id === 'string' ? value : null;
      if (this.status !== 'saving') {
        this.status = 'ready';
      }
    } else if (this.status === 'loading') {
      this.status = 'error';
      this.errorText = 'The server could not be reached.';
    }
  }

  private statusText(): string {
    const request = this.request;
    if (request === null) {
      return t('settings.invite.statusNone', 'You have not requested an invite yet.');
    }
    if (request.status === 'pending') {
      return t('settings.invite.statusPending', 'Waiting for an admin to review your request.');
    }
    if (request.status === 'approved') {
      return t('settings.invite.statusApproved', 'Approved - generate your QR code when you are ready to share it.');
    }
    if (request.status === 'denied') {
      return t('settings.invite.statusDenied', 'Your previous request was not approved. You can ask again.');
    }
    return t('settings.invite.statusGenerated', 'Your approved invite was generated. Request another when you need one.');
  }

  private buttonLabel(): string {
    if (this.status === 'saving') {
      return t('settings.invite.working', 'Working…');
    }
    if (this.request !== null && this.request.status === 'approved') {
      return t('settings.invite.generateQr', 'Generate invite QR');
    }
    if (this.request !== null && this.request.status === 'pending') {
      return t('settings.invite.requestPending', 'Request pending');
    }
    return t('settings.invite.requestQr', 'Request invite QR');
  }

  private async onAction(): Promise<void> {
    if (this.status === 'saving' || (this.request !== null && this.request.status === 'pending')) {
      return;
    }
    this.status = 'saving';
    this.errorText = '';
    if (this.request !== null && this.request.status === 'approved') {
      const invite = await generateApprovedInvite();
      const server = getServerDirectory().getActiveBaseUrl();
      if (invite.kind === 'ok' && server !== null) {
        this.link = buildInviteUrl(server, invite.value.invite_token);
        this.expiresAt = invite.value.expires_at;
        this.status = 'ready';
        await this.refresh();
        return;
      }
    } else {
      const created = await createInviteRequest(this.message.trim());
      if (created.kind === 'ok') {
        this.request = created.value;
        this.message = '';
        this.status = 'ready';
        return;
      }
    }
    this.status = 'error';
    this.errorText = 'The invite request could not be completed.';
  }

  build() {
    Column({ space: tv(16) }) {
      if (this.status === 'loading') {
        Text('Checking invite status…').fontFamily(nunito(400))
          .fontSize(tv(13.824))
          .fontColor(toResourceColor(activeColors().inkSoft))
      } else {
        Text(this.statusText()).fontFamily(nunito(400))
          .fontSize(tv(13.824))
          .fontColor(toResourceColor(activeColors().inkSoft))
        if (this.status === 'error') {
          Text(this.errorText).fontFamily(nunito(400))
            .fontSize(tv(13.824))
            .fontColor(toResourceColor(activeColors().danger))
        }
        if (this.request === null || this.request.status === 'denied' || this.request.status === 'generated') {
          Text('Who is this for, and what should they have access to? (optional)').fontFamily(nunito(700))
            .fontSize(tv(13.824))
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(activeColors().ink))
          TextArea({ text: this.message, placeholder: t('settings.invite.messagePlaceholder', 'For example: For Sam — films and television series, please.') })
            .maxLength(500)
            .fontSize(tv(15.36))
            .fontColor(toResourceColor(activeColors().ink))
            .placeholderColor(toResourceColor(activeColors().inkMuted))
            .backgroundColor(toResourceColor(activeColors().surfaceSoft))
            .width(tv(this.panelWidth))
            .height(tv(110))
            .onChange((value: string) => {
              this.message = value;
            })
        }
        Text(this.buttonLabel()).fontFamily(nunito(700))
          .fontSize(tv(13.824))
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().bg))
          .backgroundColor(toResourceColorWithAlpha(activeColors().ink, this.request !== null && this.request.status === 'pending' ? 0.4 : 1))
          .borderRadius(tv(22))
          .padding({ left: tv(26), right: tv(26), top: tv(13), bottom: tv(13) })
          .focusable(true)
          .onClick(() => {
            this.onAction();
          })
        if (this.link.length > 0) {
          Text('Invite a friend to Playarr').fontFamily(nunito(500))
            .fontSize(tv(26.4))
            .fontWeight(FontWeight.Medium)
            .fontColor(toResourceColor(activeColors().ink))
          Text('This one-use code opens Playarr with your Playarr Server already locked in.').fontFamily(nunito(400))
            .fontSize(tv(13.824))
            .fontColor(toResourceColor(activeColors().inkSoft))
          QRCode(this.link)
            .width(tv(260))
            .height(tv(260))
            .color('#000000')
            .backgroundColor('#FFFFFF')
          Text(this.link).fontFamily(nunito(400))
            .fontSize(tv(12))
            .fontColor(toResourceColor(activeColors().inkSoft))
            .width(tv(this.panelWidth))
          Text('Expires ' + this.expiresAt + '. The invite can be used once.').fontFamily(nunito(400))
            .fontSize(tv(13.824))
            .fontColor(toResourceColor(activeColors().inkMuted))
        }
      }
    }
    .width(tv(this.panelWidth))
    .alignItems(HorizontalAlign.Start)
  }
}
