import type {CalendarEntry} from '@playarr-tv/api-client';
import {entryPillTone, itemPillTone, releaseInstant} from './calendar';

const entry = (over: Partial<CalendarEntry>): CalendarEntry => ({id: 'e', title: 'T', date: '2026-10-11', release_at: null, has_file: false, monitored: true, ...over}) as CalendarEntry;

describe('releaseInstant', () => {
  it('treats midnight UTC as a date, not a moment', () => {
    expect(releaseInstant({release_at: '2026-10-11T00:00:00Z'})).toBeNull();
    expect(releaseInstant({release_at: '2026-10-11T08:00:00Z'})?.getTime()).toBe(Date.UTC(2026, 9, 11, 8));
    expect(releaseInstant({release_at: null})).toBeNull();
  });
});

describe('pill tone', () => {
  it('follows the web: available, upcoming, missing, neutral', () => {
    expect(entryPillTone(entry({has_file: true}), '2026-10-11')).toBe('available');
    expect(entryPillTone(entry({date: '2026-10-12'}), '2026-10-11')).toBe('upcoming');
    expect(entryPillTone(entry({}), '2026-10-11')).toBe('missing');
    expect(entryPillTone(entry({monitored: false}), '2026-10-11')).toBe('neutral');
  });
  it('a group reports its worst state', () => {
    const group = {kind: 'series', key: 'k', title: 'T', codes: '', entries: [entry({has_file: true}), entry({})]} as never;
    expect(itemPillTone(group, '2026-10-11')).toBe('missing');
  });
});
