import {existsSync} from 'node:fs';
import * as path from 'node:path';
import {MONO_WEIGHTS, SANS_WEIGHTS, mono, sans, sansWeight} from './fonts';

const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');

describe('theme/fonts', () => {
  it.each(SANS_WEIGHTS)('ships the Nunito Sans static instance for weight %i', (weight) => {
    expect(existsSync(path.join(FONT_DIR, `NunitoSans-w${weight}.ttf`))).toBe(true);
  });

  it.each(MONO_WEIGHTS)('ships the JetBrains Mono static instance for weight %i', (weight) => {
    expect(existsSync(path.join(FONT_DIR, `JetBrainsMono-w${weight}.ttf`))).toBe(true);
  });

  it('draws a web weight at exactly that weight and snaps only a weight the web never uses', () => {
    expect(sansWeight(570)).toBe(570);
    expect(sansWeight(650)).toBe(650);
    expect(sansWeight(690)).toBe(690);
    expect(sansWeight(860)).toBe(860);
    expect(sansWeight(100)).toBe(300);
    expect(sansWeight(1000)).toBe(900);
  });

  it('selects the family by file name and pins the weight', () => {
    expect(sans(760)).toEqual({fontFamily: 'NunitoSans-w760', fontWeight: 'normal'});
    expect(mono(720)).toEqual({fontFamily: 'JetBrainsMono-w700', fontWeight: 'normal'});
  });
});
