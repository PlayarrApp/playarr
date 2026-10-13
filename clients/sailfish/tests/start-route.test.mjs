import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const routeSource = (await readFile(new URL('../qml/startRoute.js', import.meta.url), 'utf8'))
  .replace(/^\.pragma library\s*/, '')
const route = vm.runInNewContext(`${routeSource}\ninitialRoute`, {})

test('saved profiles without an active profile open profile selection', () => {
  assert.equal(route(false, 1), 'profiles')
  assert.equal(route(false, 2), 'profiles')
})

test('no saved profiles without an active profile open sign in', () => {
  assert.equal(route(false, 0), 'link')
})

test('signed-in routing remains unchanged', () => {
  assert.equal(route(true, 1), 'main')
  assert.equal(route(true, 2), 'profiles')
})
