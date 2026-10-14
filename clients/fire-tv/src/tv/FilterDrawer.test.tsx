/** The filter drawer: its title, its sections of chips and rows, capitalised labels, and Back/close. */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Pressable, Text} from 'react-native';
import {clearFocus, reportFocus} from '../debug/parityControl';
import {ThemeProvider} from '../theme/ThemeProvider';
import {FilterDrawer} from './FilterDrawer';

(globalThis as unknown as {React: typeof React}).React = React;

const renderers: ReactTestRenderer[] = [];
function trackRenderer(renderer: ReactTestRenderer): ReactTestRenderer {
  renderers.push(renderer);
  return renderer;
}

jest.mock('../platform/focus', () => ({TvFocusScope: ({children}: {children: unknown}) => children, focusNode: jest.fn()}));
jest.mock('../debug/parityControl', () => ({reportFocus: jest.fn(), clearFocus: jest.fn()}));

const layers: Array<() => void> = [];
jest.mock('../navigation/backPolicy', () => ({useBackLayer: (active: boolean, onBack: () => void) => (active ? layers.push(onBack) : 0)}));

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((node) => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children)));
}

describe('FilterDrawer', () => {
  afterEach(() => {
    jest.clearAllMocks();
    act(() => {
      for (const renderer of renderers.splice(0)) renderer.unmount();
    });
  });

  it('shows the kicker, the title and every section, with each chip label capitalised', () => {
    const picked: string[] = [];
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = trackRenderer(create(
        <ThemeProvider>
          <FilterDrawer
            kicker="Library controls"
            title="Filters"
            closeLabel="Close filters"
            onClose={() => undefined}
            sections={[
              {key: 'view', label: 'View', columns: 2, chips: [{key: 'list', label: 'list', selected: true, icon: 'list', onPress: () => picked.push('list')}]},
              {key: 'type', label: 'Type', columns: 3, chips: [{key: 'tv', label: 'TV', selected: false, onPress: () => picked.push('tv')}, {key: 'm', label: 'monitored only', selected: false, onPress: () => picked.push('m')}]},
              {key: 'q', label: 'Quality', rows: [{key: 'o', title: 'Original', detail: '13 Mbps', selected: true, onPress: () => picked.push('o')}]},
            ]}
          />
        </ThemeProvider>,
      ));
    });
    const all = texts(renderer);
    expect(all).toEqual(expect.arrayContaining(['Library controls', 'Filters', 'View', 'List', 'Type', 'TV', 'Monitored Only', 'Quality', 'Original', '13 Mbps']));
    const chips = renderer.root.findAllByType(Pressable).filter((node) => node.props.accessibilityLabel === 'monitored only');
    act(() => chips[0]!.props.onFocus({}));
    expect(reportFocus).toHaveBeenLastCalledWith('monitored only', undefined, expect.any(Object));
    act(() => chips[0]!.props.onPress());
    expect(picked).toEqual(['m']);
  });

  it('closes on its close button and registers as a Back layer', () => {
    layers.length = 0;
    const onClose = jest.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = trackRenderer(create(
        <ThemeProvider>
          <FilterDrawer kicker="k" title="t" closeLabel="Close" onClose={onClose} sections={[]} />
        </ThemeProvider>,
      ));
    });
    expect(layers).toHaveLength(1);
    act(() => renderer.root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === 'Close')!.props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears the reported chip focus when the drawer unmounts', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ThemeProvider>
          <FilterDrawer
            kicker="Search"
            title="Filters"
            closeLabel="Close"
            onClose={() => undefined}
            sections={[{key: 'type', label: 'Type', columns: 2, chips: [{key: 'movie', label: 'Movies', focusId: 'search filter movie', selected: false, onPress: () => undefined}]}]}
          />
        </ThemeProvider>,
      );
    });

    const movieChip = renderer.root.findByProps({accessibilityLabel: 'Movies'});
    act(() => movieChip.props.onFocus({}));
    expect(reportFocus).toHaveBeenLastCalledWith('search filter movie', undefined, expect.any(Object));
    const focusOwner = (reportFocus as jest.Mock).mock.lastCall?.[2] as object;

    act(() => renderer.unmount());
    expect(clearFocus).toHaveBeenLastCalledWith(focusOwner);
  });

  it('reports close-button focus with drawer ownership before notifying the page', () => {
    const onFocused = jest.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = trackRenderer(create(
        <ThemeProvider>
          <FilterDrawer kicker="Search" title="Filters" closeLabel="Close" closeFocusId="search filters close" onClose={() => undefined} onFocused={onFocused} sections={[]} />
        </ThemeProvider>,
      ));
    });

    const close = renderer.root.findByProps({accessibilityLabel: 'Close'});
    act(() => close.props.onFocus({}));
    expect(reportFocus).toHaveBeenLastCalledWith('search filters close', undefined, expect.any(Object));
    expect(onFocused).toHaveBeenCalledTimes(1);
  });
});
