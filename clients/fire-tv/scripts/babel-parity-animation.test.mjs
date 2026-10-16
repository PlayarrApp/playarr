import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function transformedTiming(parityAnimationsDisabled) {
  const env = {...process.env};
  delete env.JEST_WORKER_ID;
  delete env.PLAYARR_PARITY_ANIMATIONS_DISABLED;
  if (parityAnimationsDisabled) env.PLAYARR_PARITY_ANIMATIONS_DISABLED = '1';

  const source = [
    "const babel = require('@babel/core');",
    "const result = babel.transformSync('Animated.timing(value, { toValue: 1, duration: 250, useNativeDriver: true });', {configFile: './babel.config.js'});",
    'process.stdout.write(result.code);',
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: packageRoot,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const duration = result.stdout.match(/duration:\s*(\d+)/);
  assert.ok(duration, `transformed output did not contain a numeric duration: ${result.stdout}`);
  return Number(duration[1]);
}

test('Babel preserves normal animation duration and zeros parity capture duration', () => {
  assert.equal(transformedTiming(false), 250);
  assert.equal(transformedTiming(true), 0);
});
