// Source guard for the shared page anatomy (docs/design/page-layout.md sections 2 and 7.2, row 13.807): every screen is
// registered, a registered page renders the shared PageHeader, and nothing else hand-rolls the Back button.
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

const screensDir = join(__dirname, '..', 'screens');
const read = (p: string): string => readFileSync(p, 'utf8');
const files = readdirSync(screensDir).filter(f => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));

/** Pages that render the shared `PageHeader`. */
const MIGRATED = ['CalendarScreen', 'LibraryScreen', 'ListPages', 'MusicDetailScreen', 'PlaylistsScreen', 'SearchScreen', 'SettingsScreen', 'WorkDetailScreen'];
/** Pages still on a hand-placed `BackButton`. This ratchet only shrinks: move a page to MIGRATED when it adopts PageHeader. */
const UNMIGRATED: string[] = [];
/** Spec section 2, rule 1: no header (Home, player, profile picker, household gate, pre-auth, NotFound) or not a page. */
const EXEMPT = ['HomeScreen', 'PlayerScreen', 'ProfilesScreen', 'HouseholdBlockedScreen', 'LinkScreen', 'NotFoundScreen', 'PlaceholderScreen', 'PlaybackSettingsDrawer', 'SearchDiscoveryCard'];

describe('page layout guard', () => {
  it('registers every screen file', () => {
    const known = new Set([...MIGRATED, ...UNMIGRATED, ...EXEMPT]);
    expect(files.map(f => f.replace('.tsx', '')).filter(n => !known.has(n))).toEqual([]);
  });

  it('migrated pages render PageHeader and no hand-rolled BackButton', () => {
    for (const name of MIGRATED) {
      const src = read(join(screensDir, `${name}.tsx`));
      expect({name, header: /<PageHeader\b/.test(src)}).toEqual({name, header: true});
      expect({name, back: /\bBackButton\b/.test(src)}).toEqual({name, back: false});
    }
  });

  it('unmigrated pages still use BackButton, so the list shrinks when a page migrates', () => {
    for (const name of UNMIGRATED) {
      const src = read(join(screensDir, `${name}.tsx`));
      expect({name, header: /<PageHeader\b/.test(src)}).toEqual({name, header: false});
    }
  });

  it('keeps BackButton out of exempt screens and subfolders', () => {
    const dirs = ['calendar', 'settings'].flatMap(d => readdirSync(join(screensDir, d)).map(f => join(screensDir, d, f)));
    const offenders = [...EXEMPT.map(n => join(screensDir, `${n}.tsx`)), ...dirs].filter(p => /\bBackButton\b/.test(read(p)));
    expect(offenders).toEqual([]);
  });
});
