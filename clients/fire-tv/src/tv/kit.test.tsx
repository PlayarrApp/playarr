/** BalancedT: Chrome's text-wrap: balance, fitted on measured word widths. */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Dimensions, Text} from 'react-native';
import {ThemeProvider} from '../theme/ThemeProvider';
import {BalancedT, balanceLines, titleTokens} from './kit';

(globalThis as unknown as {React: typeof React}).React = React;

const BOX = 373;
const lines = (title: string, per: number, space = 10): string[] | null => {
  const tokens = titleTokens(title);
  const ends = balanceLines(tokens, tokens.map((token) => token.trim().length * per), space, BOX);
  if (!ends) return null;
  let from = 0;
  return ends.map((to) => tokens.slice(from, (from = to)).join('').trim());
};

describe('titleTokens', () => {
  it('breaks after spaces and hyphens', () => {
    expect(titleTokens('2 Fast 2 Furious')).toEqual(['2 ', 'Fast ', '2 ', 'Furious']);
    expect(titleTokens('Spider-Man')).toEqual(['Spider-', 'Man']);
    expect(titleTokens('A - B')).toEqual(['A ', '- ', 'B']);
  });
});

describe('balanceLines', () => {
  it('leaves a title that fits on one line alone', () => {
    expect(lines('Heat', 20)).toBeNull();
  });
  it('avoids a one-word last line: "2 Fast / 2 Furious"', () => {
    expect(lines('2 Fast 2 Furious', 28)).toEqual(['2 Fast', '2 Furious']);
  });
  it('balances the lines, keeping the greedy line count', () => {
    expect(lines('The Lord of the Rings', 20)).toEqual(['The Lord of', 'the Rings']);
  });
});

test('BalancedT measures each word, then draws the balanced lines', () => {
  const unit = Dimensions.get('window').width / 1920;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ThemeProvider>
        <BalancedT width={BOX} size={69} color="#fff">
          2 Fast 2 Furious
        </BalancedT>
      </ThemeProvider>,
    );
  });
  const probes = renderer.root.findAllByType(Text).filter((node) => typeof node.props.onTextLayout === 'function');
  const widths: Record<string, number> = {'2': 28, Fast: 112, Furious: 196, 'a a': 50, aa: 40};
  act(() => probes.forEach((node) => node.props.onTextLayout({nativeEvent: {lines: [{text: '', width: (widths[node.props.children as string] ?? 0) * unit}]}})));
  const drawn = renderer.root.findAllByType(Text).map((node) => node.props.children);
  expect(drawn).toEqual(['2 Fast', '2 Furious']);
});
