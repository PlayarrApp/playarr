import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('require-shaka exits non-zero exactly when the vendored build is missing', () => {
  const run = spawnSync('node', ['scripts/require-shaka.mjs'], {cwd: root});
  assert.equal(run.status === 0, existsSync(path.join(root, 'src/vendor/shaka/index.ts')) && existsSync(path.join(root, 'src/vendor/shaka/dist')));
});
