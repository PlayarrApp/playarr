// Writes clients.json for a release: scripts/release/variants.json with {version} filled in, a published_at
// stamp, and every download asset checked against the release directory.
//   node scripts/release/build-clients-json.mjs <version> <assets-dir> [published_at]
// A download variant whose file is missing (an optional platform failed to build) is listed as "pending"
// with a note, so the clients page never links to a file that is not in the release.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FAMILIES = ['samsung', 'lg', 'vidaa', 'roku', 'amazon', 'android', 'apple', 'microsoft', 'huawei', 'linux', 'sailfish', 'web'];
export const ROUTES = ['download', 'store', 'testflight', 'hosted', 'web', 'pending'];

export function loadVariants() {
  return JSON.parse(readFileSync(join(here, 'variants.json'), 'utf8'));
}

export function buildClients({ version, dir, publishedAt, variants = loadVariants(), exists = (f) => existsSync(join(dir, f)) }) {
  const seen = new Set();
  const out = variants.map((v) => {
    if (seen.has(v.id)) throw new Error(`duplicate variant id ${v.id}`);
    seen.add(v.id);
    if (!FAMILIES.includes(v.family)) throw new Error(`${v.id}: unknown family ${v.family}`);
    if (!ROUTES.includes(v.route)) throw new Error(`${v.id}: unknown route ${v.route}`);
    const asset = v.asset ? v.asset.replaceAll('{version}', version) : null;
    if ((v.route === 'download') !== (asset !== null)) throw new Error(`${v.id}: a download needs an asset and only a download has one`);
    if (asset && !exists(asset)) {
      console.log(`::warning::${asset} is not in the release; ${v.id} is listed as pending`);
      return { ...v, asset: null, route: 'pending', note: `Not in this release: the build did not produce ${asset}.` };
    }
    return { ...v, asset };
  });
  return { version, published_at: publishedAt, variants: out };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, dir, publishedAt = new Date().toISOString()] = process.argv.slice(2);
  if (!version || !dir) throw new Error('usage: build-clients-json.mjs <version> <assets-dir> [published_at]');
  const clients = buildClients({ version, dir, publishedAt });
  writeFileSync(join(dir, 'clients.json'), `${JSON.stringify(clients, null, 2)}\n`);
  console.log(`clients.json: ${clients.variants.filter((v) => v.asset).length} assets, ${clients.variants.filter((v) => v.route === 'pending').length} pending`);
}
