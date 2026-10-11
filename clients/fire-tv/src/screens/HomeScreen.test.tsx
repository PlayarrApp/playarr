import {railWindow} from './HomeScreen';

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
