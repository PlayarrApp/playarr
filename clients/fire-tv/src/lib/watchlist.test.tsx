import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Pressable, Text} from 'react-native';
import type {TitleSnapshot} from '@playarr-tv/api-client';
import {useWatchlistToggle, type WatchlistClient} from './watchlist';

function deferred<T>(): {promise: Promise<T>; resolve: (value: T) => void} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return {promise, resolve};
}

const snapshot: TitleSnapshot = {kind: 'movie', title: 'Neutral title', year: 2024, work_id: 'neutral-work', external_refs: [], poster_url: null};

function Harness({client}: {client: WatchlistClient}): React.ReactElement {
  const state = useWatchlistToggle(client, snapshot, false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={state.listed ? 'Remove from watchlist' : 'Add to watchlist'} onPress={state.toggle}>
      <Text>{state.listed ? 'listed' : state.listed === false ? 'not-listed' : 'loading'}</Text>
    </Pressable>
  );
}

describe('useWatchlistToggle initial resolve race', () => {
  it('keeps the successful add after the initial false resolve finishes late', async () => {
    const initialRead = deferred<{in_watchlist: boolean; title: {title_key: string}}>();
    const addResult = deferred<{title: {title_key: string}}>();
    const client: WatchlistClient = {
      resolveTitle: jest.fn(() => initialRead.promise),
      addToWatchlist: jest.fn(() => addResult.promise),
      removeFromWatchlist: jest.fn(async () => undefined),
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness client={client} />); });

    act(() => renderer.root.findByProps({accessibilityLabel: 'Add to watchlist'}).props.onPress());
    expect(client.addToWatchlist).toHaveBeenCalledTimes(1);
    await act(async () => { addResult.resolve({title: {title_key: 'neutral-key'}}); await addResult.promise; });
    expect(renderer.root.findByProps({accessibilityLabel: 'Remove from watchlist'})).toBeDefined();
    expect(renderer.root.findByType(Text).props.children).toBe('listed');

    await act(async () => { initialRead.resolve({in_watchlist: false, title: {title_key: 'neutral-key'}}); await initialRead.promise; });
    expect(renderer.root.findByProps({accessibilityLabel: 'Remove from watchlist'})).toBeDefined();
    expect(renderer.root.findByType(Text).props.children).toBe('listed');
    expect(client.removeFromWatchlist).not.toHaveBeenCalled();

    act(() => renderer.unmount());
  });
});
