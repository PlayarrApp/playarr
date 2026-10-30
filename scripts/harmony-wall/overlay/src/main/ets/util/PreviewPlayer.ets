// Preview-only (never in the product build): the Windows Previewer's AVPlayer is an API stub that raises no events, so the app would sit at
// 0:00 for ever. This stand-in honours the parity pin instead: on prepare it lands on the pinned position (2.000 s, the position every other
// lane captures at), reports it through the same events a real player raises (seekDone, timeUpdate) and stays paused there, never advancing.
// It replaces the platform player only; the app still computes the progress fill, the time labels and the play/pause control from those
// events itself, and the layout export still reads only what the app drew.
import { media } from '@kit.MediaKit';

const PARITY_POSITION_MS: number = 2000;
/** The Previewer never creates the XComponent surface, so the controller must not wait for one. */
export const PREVIEW_NO_SURFACE: boolean = true;

class ParityAvPlayer {
  private onState: ((state: string, reason: number) => void) | undefined = undefined;
  private onTime: ((positionMs: number) => void) | undefined = undefined;
  private onSeek: ((positionMs: number) => void) | undefined = undefined;
  private positionMs: number = 0;
  surfaceId: string = '';
  audioRendererInfo: Object | undefined = undefined;
  videoScaleType: number = 0;
  loop: boolean = false;
  private source: Object | undefined = undefined;

  set url(value: string) {
    this.source = value;
    this.emitState('initialized');
  }

  get url(): string {
    return '';
  }

  set fdSrc(value: Object) {
    this.source = value;
    this.emitState('initialized');
  }

  get fdSrc(): Object {
    return this.source === undefined ? new Object() : this.source;
  }

  on(type: string, callback: Object): void {
    if (type === 'stateChange') {
      this.onState = callback as (state: string, reason: number) => void;
    } else if (type === 'timeUpdate') {
      this.onTime = callback as (positionMs: number) => void;
    } else if (type === 'seekDone') {
      this.onSeek = callback as (positionMs: number) => void;
    }
  }

  off(type: string): void {
    if (type === 'stateChange') {
      this.onState = undefined;
    } else if (type === 'timeUpdate') {
      this.onTime = undefined;
    } else if (type === 'seekDone') {
      this.onSeek = undefined;
    }
  }

  async setMediaSource(source: Object, strategy: Object): Promise<void> {
    this.source = source;
    this.emitState('initialized');
  }

  async prepare(): Promise<void> {
    setTimeout((): void => {
      this.emitState('prepared');
    }, 0);
  }

  async play(): Promise<void> {
    // parity: the player holds the pinned position, so playing never advances time and the app shows the paused controls
    this.land(PARITY_POSITION_MS);
    this.emitState('paused');
  }

  async pause(): Promise<void> {
    this.emitState('paused');
  }

  seek(targetMs: number, mode: Object): void {
    this.land(targetMs);
  }

  setVolume(level: number): void {}

  async addSubtitleFromFd(fd: number, offset: number, length: number): Promise<void> {}

  async reset(): Promise<void> {}

  async release(): Promise<void> {}

  private land(positionMs: number): void {
    this.positionMs = positionMs;
    setTimeout((): void => {
      if (this.onTime !== undefined) {
        this.onTime(this.positionMs);
      }
      if (this.onSeek !== undefined) {
        this.onSeek(this.positionMs);
      }
    }, 0);
  }

  private emitState(state: string): void {
    setTimeout((): void => {
      if (this.onState !== undefined) {
        this.onState(state, 0);
      }
    }, 0);
  }
}

export async function createParityPlayer(): Promise<media.AVPlayer> {
  return new ParityAvPlayer() as Object as media.AVPlayer;
}
