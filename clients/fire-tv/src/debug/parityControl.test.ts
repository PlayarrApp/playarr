import {currentQuery, parseCommand, reportQuery, setPendingQuery, takePendingQuery} from './parityControl';

let mockNativeFocusTag: number | null = null;
jest.mock('@amazon-devices/react-native-kepler', () => ({FocusManager: {getFocused: () => mockNativeFocusTag}}));

describe('parityControl', () => {
  it('parses a command url and ignores messages without one', () => {
    expect(parseCommand('pkg://com.streamarr.firetv.main?cmd=route&path=%2Fcalendar%3Fview%3Dmonth&seq=a-1')).toEqual({cmd: 'route', path: '/calendar?view=month', seq: 'a-1'});
    expect(parseCommand('pkg://com.streamarr.firetv.main')).toBeNull();
    expect(parseCommand('pkg://com.streamarr.firetv.main?x=1')).toBeNull();
  });

  // Jest keeps the live process.env, so the channel is off here: reports and pending queries are inert, as in a normal build.
  it('is inert unless built in', () => {
    reportQuery('view', 'month');
    expect(currentQuery(['view'])).toBe('');
    setPendingQuery('/calendar?view=week');
    expect(takePendingQuery('view')).toBeUndefined();
  });

  it('tracks API and native image work without allowing negative pending counts', () => {
    const previousFlag = process.env.PLAYARR_PARITY_CONTROL;
    process.env.PLAYARR_PARITY_CONTROL = '1';
    try {
      let control!: typeof import('./parityControl');
      jest.isolateModules(() => { control = require('./parityControl') as typeof import('./parityControl'); });
      const initial = control.parityActivitySnapshot();
      control.trackParityActivity('api', 1);
      control.trackParityActivity('image', 1);
      expect(control.parityActivitySnapshot()).toEqual({apiPending: initial.apiPending + 1, imagesPending: initial.imagesPending + 1, revision: initial.revision + 2});
      control.trackParityActivity('api', -1);
      control.trackParityActivity('image', -1);
      control.trackParityActivity('image', -1);
      expect(control.parityActivitySnapshot()).toEqual({apiPending: initial.apiPending, imagesPending: initial.imagesPending, revision: initial.revision + 5});
    } finally {
      if (previousFlag === undefined) delete process.env.PLAYARR_PARITY_CONTROL;
      else process.env.PLAYARR_PARITY_CONTROL = previousFlag;
    }
  });

  it('clears focus only while the requesting drawer still owns it', async () => {
    const previousFlag = process.env.PLAYARR_PARITY_CONTROL;
    process.env.PLAYARR_PARITY_CONTROL = '1';
    let receiveUrl: ((event: {url: string}) => void) | undefined;
    jest.useFakeTimers();
    jest.doMock('react-native', () => ({
      Linking: {
        getInitialURL: () => Promise.resolve(null),
        addEventListener: (_type: string, listener: (event: {url: string}) => void) => {
          receiveUrl = listener;
          return {remove: jest.fn()};
        },
      },
    }));
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      let control!: typeof import('./parityControl');
      jest.isolateModules(() => { control = require('./parityControl') as typeof import('./parityControl'); });
      const owner = {};
      control.reportFocus('search filter movie', undefined, owner);
      control.clearFocus(owner);
      const cleanup = control.installParityControl({
        location: () => '/search', route: () => undefined, open: () => undefined, play: () => undefined,
        stop: () => undefined, setTheme: () => undefined,
        player: () => ({state: 'idle', positionSeconds: 0, durationSeconds: 0}), theme: () => 'dark',
      });
      await Promise.resolve();

      receiveUrl!({url: 'pkg://com.streamarr.firetv.main?cmd=state'});
      jest.advanceTimersByTime(0);
      const cleared = JSON.parse(String(log.mock.calls.at(-1)?.[0]).replace(/^PARITY /, '')) as {focus: unknown};
      expect(cleared.focus).toBeNull();

      control.reportFocus('search filter movie', undefined, owner);
      control.reportFocus('search input');
      control.clearFocus(owner);
      receiveUrl!({url: 'pkg://com.streamarr.firetv.main?cmd=state'});
      jest.advanceTimersByTime(0);
      const newer = JSON.parse(String(log.mock.calls.at(-1)?.[0]).replace(/^PARITY /, '')) as {focus: {label: string} | null};
      expect(newer.focus).toEqual({label: 'search input'});
      cleanup();
    } finally {
      log.mockRestore();
      jest.dontMock('react-native');
      jest.useRealTimers();
      if (previousFlag === undefined) delete process.env.PLAYARR_PARITY_CONTROL;
      else process.env.PLAYARR_PARITY_CONTROL = previousFlag;
    }
  });

  it('reports the stored focus matching the native tag when a later focus report is stale', async () => {
    const previousFlag = process.env.PLAYARR_PARITY_CONTROL;
    process.env.PLAYARR_PARITY_CONTROL = '1';
    mockNativeFocusTag = 2904;
    let receiveUrl: ((event: {url: string}) => void) | undefined;
    jest.useFakeTimers();
    jest.doMock('react-native', () => ({
      Linking: {
        getInitialURL: () => Promise.resolve(null),
        addEventListener: (_type: string, listener: (event: {url: string}) => void) => {
          receiveUrl = listener;
          return {remove: jest.fn()};
        },
      },
    }));
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      let control!: typeof import('./parityControl');
      jest.isolateModules(() => { control = require('./parityControl') as typeof import('./parityControl'); });
      control.reportFocus('movies target', {rail: 0, index: 0}, undefined, 2904);
      control.reportFocus('home stale', {rail: 0, index: 0}, undefined, 688);
      const cleanup = control.installParityControl({
        location: () => '/movies', route: () => undefined, open: () => undefined, play: () => undefined,
        stop: () => undefined, setTheme: () => undefined,
        player: () => ({state: 'idle', positionSeconds: 0, durationSeconds: 0}), theme: () => 'dark',
      });
      await Promise.resolve();

      receiveUrl!({url: 'pkg://com.streamarr.firetv.main?cmd=state'});
      jest.advanceTimersByTime(0);
      const state = JSON.parse(String(log.mock.calls.at(-1)?.[0]).replace(/^PARITY /, '')) as {focus: unknown; nativeFocusTag: number};
      expect(state.nativeFocusTag).toBe(2904);
      expect(state.focus).toEqual({label: 'movies target', position: {rail: 0, index: 0}, eventTag: 2904});
      cleanup();
    } finally {
      log.mockRestore();
      jest.dontMock('react-native');
      jest.useRealTimers();
      mockNativeFocusTag = null;
      if (previousFlag === undefined) delete process.env.PLAYARR_PARITY_CONTROL;
      else process.env.PLAYARR_PARITY_CONTROL = previousFlag;
    }
  });

  it('samples native focus after the identity lookup completes', async () => {
    const previousFlag = process.env.PLAYARR_PARITY_CONTROL;
    process.env.PLAYARR_PARITY_CONTROL = '1';
    mockNativeFocusTag = 2904;
    let receiveUrl: ((event: {url: string}) => void) | undefined;
    let resolveIdentity!: (value: {username: string; isCurrentCount: number; serverUrl: string}) => void;
    jest.useFakeTimers();
    jest.doMock('react-native', () => ({
      Linking: {
        getInitialURL: () => Promise.resolve(null),
        addEventListener: (_type: string, listener: (event: {url: string}) => void) => {
          receiveUrl = listener;
          return {remove: jest.fn()};
        },
      },
    }));
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      let control!: typeof import('./parityControl');
      jest.isolateModules(() => { control = require('./parityControl') as typeof import('./parityControl'); });
      control.reportFocus('movies target', {rail: 0, index: 0}, undefined, 2904);
      control.reportFocus('home stale', {rail: 0, index: 0}, undefined, 688);
      const cleanup = control.installParityControl({
        location: () => '/movies', route: () => undefined, open: () => undefined, play: () => undefined,
        stop: () => undefined, setTheme: () => undefined,
        player: () => ({state: 'idle', positionSeconds: 0, durationSeconds: 0}), theme: () => 'dark',
        identity: () => new Promise((resolve) => { resolveIdentity = resolve; }),
      });
      await Promise.resolve();

      receiveUrl!({url: 'pkg://com.streamarr.firetv.main?cmd=state'});
      jest.advanceTimersByTime(0);
      mockNativeFocusTag = 688;
      resolveIdentity({username: 'account', isCurrentCount: 1, serverUrl: 'https://example.invalid'});
      await Promise.resolve();
      await Promise.resolve();

      const state = JSON.parse(String(log.mock.calls.at(-1)?.[0]).replace(/^PARITY /, '')) as {focus: unknown; nativeFocusTag: number};
      expect(state.nativeFocusTag).toBe(688);
      expect(state.focus).toEqual({label: 'home stale', position: {rail: 0, index: 0}, eventTag: 688});
      cleanup();
    } finally {
      log.mockRestore();
      jest.dontMock('react-native');
      jest.useRealTimers();
      mockNativeFocusTag = null;
      if (previousFlag === undefined) delete process.env.PLAYARR_PARITY_CONTROL;
      else process.env.PLAYARR_PARITY_CONTROL = previousFlag;
    }
  });
});
