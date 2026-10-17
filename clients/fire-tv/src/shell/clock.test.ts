import {appNow, formatClockDate, formatClockTime, isClockFrozen, onParityClockChange, setParityClock} from './clock';

describe('shell/clock', () => {
  const instant = new Date('2026-10-07T12:00:00Z');

  it('formats the fixture instant as the web does', () => {
    expect(formatClockTime(instant, true)).toBe('12:00');
    expect(formatClockDate(instant, true)).toBe('Wed 7 October');
  });

  it('zero-pads the hour and minute', () => {
    expect(formatClockTime(new Date('2026-01-02T03:04:00Z'), true)).toBe('03:04');
    expect(formatClockDate(new Date('2026-01-02T03:04:00Z'), true)).toBe('Fri 2 January');
  });

  it('freezes at run time, notifies the screen, rejects a bad instant and releases', () => {
    const changed = jest.fn();
    const unsubscribe = onParityClockChange(changed);
    expect(isClockFrozen()).toBe(false);
    setParityClock('2026-10-07T12:00:00Z');
    expect(isClockFrozen()).toBe(true);
    expect(appNow().toISOString()).toBe('2026-10-07T12:00:00.000Z');
    expect(() => setParityClock('not a date')).toThrow(/invalid parity clock/);
    expect(appNow().toISOString()).toBe('2026-10-07T12:00:00.000Z');
    setParityClock(null);
    expect(isClockFrozen()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
