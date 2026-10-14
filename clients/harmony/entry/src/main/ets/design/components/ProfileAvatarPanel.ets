/**
 * Settings > Profile avatar (web `pages/settings/ProfileAvatar.tsx`): the built-in avatars in web's 4-column grid
 * (720 wide, 22 gap, 8 padding), the chosen one ringed in the brand colour; a tap saves it to the profile.
 * Custom photo upload needs a picker and cropper and is left out; the panel says so, as web does where upload is missing.
 */

import { activeColors, toResourceColor } from '../Theme';
import { tv } from '../Metrics';
import { BRAND_PINK } from '../../core/Tokens';
import { AVATAR_PRESET_LIST, resolveAvatarPreset } from '../../core/AvatarPreset';
import { saveAvatarPreset } from '../../data/ProfileRepository';
import { ProfileAvatar } from './ProfileAvatar';

const GRID_WIDTH: number = 720;
const GRID_GAP: number = 22;
const COLUMNS: number = 4;
const CELL_PADDING: number = 8;

@Component
export struct ProfileAvatarPanel {
  @StorageProp('currentAvatarPreset') private chosen: string = '';
  @StorageProp('currentProfileId') private profileId: string = '';
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: string = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;
  @State private saving: boolean = false;
  @State private note: string = '';

  private activePreset(): string {
    return this.chosen !== '' ? this.chosen : resolveAvatarPreset(this.profileId);
  }

  private async choose(preset: string): Promise<void> {
    if (this.saving || preset === this.activePreset()) {
      return;
    }
    this.saving = true;
    this.note = '';
    const saved = await saveAvatarPreset(preset);
    this.note = saved ? 'Profile avatar saved to your profile.' : 'The profile avatar could not be saved to your profile.';
    this.saving = false;
  }

  build() {
    Column({ space: tv(24) }) {
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(AVATAR_PRESET_LIST, (preset: string) => {
          Stack() {
            ProfileAvatar({
              presetId: preset,
              diameter: tv((GRID_WIDTH - GRID_GAP * (COLUMNS - 1)) / COLUMNS - CELL_PADDING * 2),
              onSelect: (): void => {
                this.choose(preset);
              },
            })
          }
          .padding(tv(CELL_PADDING))
          .margin({ right: tv(GRID_GAP), bottom: tv(GRID_GAP) })
          .borderRadius(tv(GRID_WIDTH))
          .border({ width: 1, color: preset === this.activePreset() ? toResourceColor(BRAND_PINK) : Color.Transparent })
          .scale(preset === this.activePreset() ? { x: 1.06, y: 1.06 } : { x: 1, y: 1 })
        }, (preset: string): string => `${preset}:${preset === this.activePreset()}`)
      }
      .width(tv(GRID_WIDTH + GRID_GAP))
      Text(this.note.length > 0 ? this.note : 'Custom photos are not available on this device; choose one of the built-in avatars.')
        .fontSize(tv(13.824))
        .fontColor(toResourceColor(activeColors().inkSoft))
    }
    .alignItems(HorizontalAlign.Start)
  }
}
