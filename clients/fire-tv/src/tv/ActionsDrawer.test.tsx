import {playableLeaves} from './ActionsDrawer';

jest.mock('../api/ApiClientProvider', () => ({useApiClient: () => ({})}));
jest.mock('../i18n/LanguageProvider', () => ({useLanguage: () => ({t: (key: string) => key})}));
jest.mock('../platform/focus', () => ({TvFocusScope: ({children}: {children: unknown}) => children, focusNode: jest.fn()}));
jest.mock('../navigation/backPolicy', () => ({useBackLayer: jest.fn()}));
jest.mock('../debug/parityControl', () => ({reportFocus: jest.fn(), clearFocus: jest.fn()}));

jest.mock('../navigation/PlayerHandleContext', () => ({PlayerHandleContext: require('react').createContext(null)}));

import React from 'react';
import {act, create} from 'react-test-renderer';
import {ThemeProvider} from '../theme/ThemeProvider';
import {ActionsDrawer} from './ActionsDrawer';

test('title actions give initial focus to Play and keep the close control out of autofocus', () => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <ThemeProvider>
        <ActionsDrawer work={{id: 'work-a', title: 'Test Movie A', kind: 'movie'} as never} onClose={() => undefined} onOpen={() => undefined} onAddToPlaylist={() => undefined} />
      </ThemeProvider>,
    );
  });

  expect(renderer.root.findByProps({accessibilityLabel: 'components.mediaContextMenu.play'}).props.hasTVPreferredFocus).toBe(true);
  expect(renderer.root.findByProps({accessibilityLabel: 'components.mediaContextMenu.close'}).props.hasTVPreferredFocus).toBe(false);
  act(() => renderer.unmount());
});

test('a film has its one file; a series has every episode that has a file', () => {
  expect(playableLeaves({media_file_id: 'f1', runtime_ms: 5000, children: null} as never)).toEqual([{mediaFileId: 'f1', runtimeMs: 5000}]);
  expect(playableLeaves({media_file_id: null, runtime_ms: null, children: null} as never)).toEqual([]);
  const series = {
    media_file_id: null,
    runtime_ms: null,
    children: {Series: [{episodes: [{media_file_id: 'e1', runtime_ms: 100}, {media_file_id: null}]}, {episodes: [{media_file_id: 'e3', runtime_ms: null}]}]},
  };
  expect(playableLeaves(series as never)).toEqual([
    {mediaFileId: 'e1', runtimeMs: 100},
    {mediaFileId: 'e3', runtimeMs: 0},
  ]);
});
