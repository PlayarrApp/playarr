import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const selectorUrl = process.argv[2]
  ? pathToFileURL(process.argv[2]).href
  : new URL('./overlay/src/main/ets/util/PreviewCardSelector.ts', import.meta.url).href;
const selectorModule = await import(selectorUrl);
const selectPreviewCard = selectorModule.selectPreviewCard ?? selectorModule.default?.selectPreviewCard;
assert.equal(typeof selectPreviewCard, 'function', 'production selector module must export selectPreviewCard');

function card(x, y, width = 150, height = 210, overrides = {}) {
  return { x, y, width, height, measured: true, alive: true, visible: true, ...overrides };
}

const phoneCards = [card(16, 134), card(624, 343)];
assert.equal(selectPreviewCard(phoneCards, false), 0, 'phone selects the visible first card, not an offscreen rail child');
assert.equal(selectPreviewCard([card(624, 134)], false), -1, 'phone rejects a card beyond its viewport');
assert.equal(selectPreviewCard([card(-20, 50, 150, 100)], false), 0,
  'phone accepts a card that partially intersects the viewport');
assert.equal(selectPreviewCard([card(350, 134, 20, 210)], false), 0,
  'phone accepts a card that partially intersects the right edge');
assert.equal(selectPreviewCard([card(16, 134, 0, 210)], false), -1, 'zero-width geometry fails closed');
assert.equal(selectPreviewCard([card(16, 134, 150, 210, { measured: false })], false), -1,
  'unmeasured geometry fails closed');
assert.equal(selectPreviewCard([card(16, 134, 150, 210, { alive: false })], false), -1,
  'dead cards fail closed');
assert.equal(selectPreviewCard([card(16, 134, 150, 210, { visible: false })], false), -1,
  'invisible cards fail closed');
assert.equal(selectPreviewCard([card(16, 780)], false), -1, 'phone rejects cards below the viewport');
assert.equal(selectPreviewCard([card(16, -100, 150, 100)], false), -1,
  'phone rejects cards above the viewport');
assert.equal(selectPreviewCard([card(16, 134, 150, Number.NaN)], false), -1,
  'non-finite bounds fail closed');
assert.equal(selectPreviewCard([{ x: 16, y: 134, width: 150, measured: true, alive: true, visible: true }], false), -1,
  'missing bounds fail closed');
assert.equal(selectPreviewCard([card(624, 343), card(510, 200)], true), 1,
  'TV keeps the first card in its content region');
assert.equal(selectPreviewCard([card(16, 134)], true), -1, 'TV excludes cards in the navigation rail');

console.log('Preview card selector tests passed.');
