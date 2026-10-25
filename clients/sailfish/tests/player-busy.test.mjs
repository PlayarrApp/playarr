import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const helperSource = (await readFile(new URL('../qml/components/playerBusy.js', import.meta.url), 'utf8'))
  .replace(/^\.pragma library\s*/, '')
const helper = vm.runInNewContext(`${helperSource}\n({ shouldRun, captureReady })`, {})

test('missing media information keeps the loading indicator active', () => {
  assert.equal(helper.shouldRun(false, false, false, false, false, true), true)
})

test('loading remains visible while paused until media information arrives', () => {
  assert.equal(helper.shouldRun(false, true, true, false, false, true), true)
})

test('stalled and buffering indicators are hidden only while paused', () => {
  assert.equal(helper.shouldRun(false, true, false, true, false, true), false)
  assert.equal(helper.shouldRun(false, true, false, false, true, true), false)
  assert.equal(helper.shouldRun(false, true, false, true, false, false), true)
  assert.equal(helper.shouldRun(false, true, false, false, true, false), true)
})

test('errors suppress the indicator in every player state', () => {
  assert.equal(helper.shouldRun(true, false, true, true, true, false), false)
})

test('capture readiness waits for the exact paused position and finished indicator fade', () => {
  const ready = (state = 2, active = true, controls = true, engine = 2000, source = 2000, running = false, opacity = 0) =>
    helper.captureReady(state, 2, active, controls, engine, source, running, opacity)
  assert.equal(ready(), true)
  assert.equal(ready(1), false)
  assert.equal(ready(2, false), false)
  assert.equal(ready(2, true, false), false)
  assert.equal(ready(2, true, true, 1999), false)
  assert.equal(ready(2, true, true, 2000, 1999), false)
  assert.equal(ready(2, true, true, 2000, 2000, true), false)
  assert.equal(ready(2, true, true, 2000, 2000, false, 0.01), false)
})
