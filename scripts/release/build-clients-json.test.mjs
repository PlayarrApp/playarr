import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildClients, loadVariants } from './build-clients-json.mjs';

const all = () => true;

test('fills the version and keeps one entry per variant', () => {
  const c = buildClients({ version: '0.3.1', publishedAt: 'now', exists: all });
  assert.equal(c.version, '0.3.1');
  assert.equal(c.variants.length, loadVariants().length);
  const web = c.variants.find((v) => v.id === 'samsung-tizen-web');
  assert.equal(web.asset, 'playarr-samsung-tizen-web-0.3.1-unsigned.zip');
  assert.equal(c.variants.find((v) => v.id === 'vidaa').route, 'hosted');
});

test('every download asset must exist; a missing one degrades to pending', () => {
  const c = buildClients({ version: '1.0.0', publishedAt: 'now', exists: (f) => f !== 'playarr-roku-1.0.0.zip' });
  const roku = c.variants.find((v) => v.id === 'roku');
  assert.equal(roku.route, 'pending');
  assert.equal(roku.asset, null);
  for (const v of c.variants.filter((x) => x.route === 'download')) assert.ok(v.asset);
});

test('the Tizen web floor matches the app manifest', () => {
  const xml = readFileSync(new URL('../../clients/tv-web/apps/tv-tizen/tizen-manifest.xml', import.meta.url), 'utf8');
  const required = /required_version="([\d.]+)"/.exec(xml)[1];
  assert.equal(loadVariants().find((v) => v.id === 'samsung-tizen-web').min_os, `Tizen ${required}`);
});
