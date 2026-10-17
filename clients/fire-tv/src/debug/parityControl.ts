/**
 * The parity suite's control channel, compiled in only when the bundle is built with PLAYARR_PARITY_CONTROL=1 (see
 * babel.config.js); a normal build has none of it. Vega has no debug server to attach to, so the channel is the platform's own
 * message bus: `vmsgr send 'pkg://com.streamarr.firetv.main?cmd=...'` reaches the running app as a Linking `url` event, and the
 * app answers on its log (`PARITY {json}`), which the driver reads with `loggingctl`. Commands:
 *   cmd=state                      log the route, the focused item, the player and the theme
 *   cmd=route&path=/movies         go to a web route (library pages, calendar views, settings, profiles)
 *   cmd=open&kind=movies&id=<id>   open a title's detail page by work id
 *   cmd=play&file=<media file id>  start playback of a media file
 *   cmd=stop                       stop playback and close the player
 *   cmd=theme&name=dark|light      set the in-app theme preference
 *   cmd=clock&now=<ISO instant>    freeze the app clock (shown in UTC, en-GB, like the web refs); `now` empty releases it
 */
import {Linking} from 'react-native';
import {FocusManager} from '@amazon-devices/react-native-kepler';
import {appNow, isClockFrozen, setParityClock} from '../shell/clock';

export const PARITY_CONTROL = process.env.PLAYARR_PARITY_CONTROL === '1';

export interface FocusReport {
  label: string;
  position?: {rail: number | 'nav'; index: number};
  eventTag?: number;
}

let lastFocus: FocusReport | null = null;
let lastFocusOwner: object | null = null;
const focusReportsByEventTag = new Map<number, {focus: FocusReport; owner: object | null}>();
const MAX_FOCUS_REPORTS = 32;

/** Screens call this from their focus handlers; a no-op unless the control channel is built in. */
export function reportFocus(label: string, position?: FocusReport['position'], owner?: object, eventTag?: number): void {
  if (!PARITY_CONTROL) return;
  const focus = {label: label.trim().toLowerCase().replace(/\s+/g, ' '), ...(position ? {position} : {}), ...(eventTag === undefined ? {} : {eventTag})};
  lastFocus = focus;
  lastFocusOwner = owner ?? null;
  if (eventTag !== undefined) {
    focusReportsByEventTag.delete(eventTag);
    focusReportsByEventTag.set(eventTag, {focus, owner: owner ?? null});
    while (focusReportsByEventTag.size > MAX_FOCUS_REPORTS) {
      const oldestEventTag = focusReportsByEventTag.keys().next().value as number | undefined;
      if (oldestEventTag === undefined) break;
      focusReportsByEventTag.delete(oldestEventTag);
    }
  }
}

/** Clear focus only if it is still owned by the component requesting cleanup. */
export function clearFocus(owner: object): void {
  if (!PARITY_CONTROL) return;
  for (const [eventTag, report] of focusReportsByEventTag) {
    if (report.owner === owner) focusReportsByEventTag.delete(eventTag);
  }
  if (lastFocusOwner !== owner) return;
  lastFocus = null;
  lastFocusOwner = null;
}

const queries: Record<string, string | null> = {};

/** A screen reports a piece of its own state that the web keeps in the URL query (`view=month`, `panel=filters`). */
export function reportQuery(key: string, value: string | null): void {
  if (!PARITY_CONTROL) return;
  queries[key] = value;
}

const pending: Record<string, string> = {};

/** The query of a routed path (`/calendar?view=month`) waits here until the screen it names mounts and takes it. */
export function setPendingQuery(path: string): void {
  for (const key of Object.keys(pending)) delete pending[key];
  const query = path.split('?')[1];
  if (!query) return;
  for (const pair of query.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key) pending[key] = value;
  }
}

/** A screen's initial state from a routed query, or undefined (always undefined in a normal build). */
export function takePendingQuery(key: string): string | undefined {
  if (!PARITY_CONTROL) return undefined;
  const value = pending[key];
  delete pending[key];
  return value;
}

export function currentQuery(keys: readonly string[]): string {
  const parts = keys.filter((key) => queries[key]).map((key) => `${key}=${queries[key]}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export interface ParityHooks {
  /** The current route in web terms (`/movies`, `/calendar?view=month`, ...), or null before the shell is up. */
  location(): string | null;
  route(path: string): void;
  open(kind: string, id: string): void;
  play(file: string): void;
  stop(): void;
  setTheme(name: 'dark' | 'light'): void;
  player(): {state: string; positionSeconds: number; durationSeconds: number; error?: string};
  theme(): string;
}

export function parseCommand(url: string): Record<string, string> | null {
  const query = url.split('?')[1];
  if (!query) return null;
  const out: Record<string, string> = {};
  for (const pair of query.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key) out[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return out.cmd ? out : null;
}

export function installParityControl(hooks: ParityHooks): () => void {
  if (!PARITY_CONTROL) return () => undefined;
  const handle = (url: string | null): void => {
    const command = url ? parseCommand(url) : null;
    if (!command) return;
    try {
      switch (command.cmd) {
        case 'route': hooks.route(command.path ?? '/'); break;
        case 'open': hooks.open(command.kind ?? 'movies', command.id ?? ''); break;
        case 'play': hooks.play(command.file ?? ''); break;
        case 'stop': hooks.stop(); break;
        case 'theme': hooks.setTheme(command.name === 'light' ? 'light' : 'dark'); break;
        case 'clock': setParityClock(command.now ? command.now : null); break;
        default: break;
      }
    } catch (error) {
      console.log('PARITY ' + JSON.stringify({error: String(error), cmd: command.cmd}));
      return;
    }
    // Every command answers with the state, so the driver needs one read after it.
    setTimeout(() => {
      const nativeFocusTag = command.cmd === 'state' ? FocusManager.getFocused() : undefined;
      let focus = lastFocus;
      if (command.cmd === 'state' && focus?.eventTag !== undefined && focus.eventTag !== nativeFocusTag) {
        focus = nativeFocusTag === undefined ? null : focusReportsByEventTag.get(nativeFocusTag)?.focus ?? null;
      }
      const state = {cmd: command.cmd, seq: command.seq ?? null, route: hooks.location(), focus, player: hooks.player(), theme: hooks.theme(), clock: isClockFrozen() ? appNow().toISOString() : null};
      console.log('PARITY ' + JSON.stringify(command.cmd === 'state' ? {...state, nativeFocusTag} : state));
    }, command.cmd === 'state' ? 0 : 1500);
  };
  void Linking.getInitialURL().then(handle, () => undefined);
  const subscription = Linking.addEventListener('url', (event: {url: string}) => handle(event.url));
  return () => subscription.remove();
}
