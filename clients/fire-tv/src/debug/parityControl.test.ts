jest.mock('@amazon-devices/react-native-kepler', () => ({FocusManager: {getFocused: jest.fn()}}));

import {currentQuery, parseCommand, reportQuery, setPendingQuery, takePendingQuery} from './parityControl';

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
});
