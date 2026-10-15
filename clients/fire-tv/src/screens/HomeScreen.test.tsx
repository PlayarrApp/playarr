import {homeLayout, railWindow} from './HomeScreen';

describe('railWindow', () => {
  it('mounts a few cards past the viewport, never all of a long rail', () => {
    expect(railWindow(12, 0, 0)).toEqual([0, 5]);
    expect(railWindow(12, 352.1 * 4, 6)).toEqual([3, 9]);
    expect(railWindow(3, 0, -1)).toEqual([0, 2]);
  });
  it('always includes the focused card and the next one', () => {
    expect(railWindow(12, 0, 9)).toEqual([0, 10]);
  });
});

describe('railWindow in the cover view', () => {
  it('uses the cover pitch to find the first visible card', () => {
    expect(railWindow(30, 216.2 * 10, 10, 216.2)).toEqual([9, 15]);
  });
});

describe('homeLayout', () => {
  it('matches the web columns for every view and size', () => {
    expect(homeLayout('thumbnail', 'medium').cardW).toBeCloseTo(327.2, 1);
    expect(homeLayout('thumbnail', 'small').cardW).toBeCloseTo(238.9, 1);
    expect(homeLayout('thumbnail', 'large').cardW).toBeCloseTo(503.8, 1);
    expect(homeLayout('cover', 'medium').cardW).toBeCloseTo(191.3, 1);
    expect(homeLayout('cover', 'small').cardW).toBeCloseTo(156.2, 1);
    expect(homeLayout('cover', 'large').cardW).toBeCloseTo(244, 1);
    expect(homeLayout('thumbnail', 'medium').railPitch).toBeCloseTo(365.9, 1);
    expect(homeLayout('cover', 'medium').railPitch).toBeCloseTo(468.8, 0);
  });
});
