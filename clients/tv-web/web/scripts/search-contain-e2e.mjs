#!/usr/bin/env node
// Search results stay inside the content panel: at TV, tablet and phone widths, in both themes, every result card
// (and, for the focused last card of a row, its focus ring and whole glow box) ends left of the shell Filters button.
//
//   node scripts/search-contain-e2e.mjs [--no-build] [--dist dir] [--shots dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { boot, opt } from "./e2e-common.mjs";

const SHOTS = opt("shots", "");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const { check, open, finish } = await boot();
const VIEWPORTS = [
  ["tv", 1920, 1080],
  ["tablet", 1280, 800],
  ["phone", 390, 844],
];

// Runs in the page: right edges (px) of the cards, of the focused card's ring and of its whole glow, the Filters
// button's left edge and whether the button sits beside the results (on phones it is a row above them).
function measure() {
  const button = document.querySelector("[data-shell-action-column] [data-filters-button]");
  const cards = [...document.querySelectorAll(".tv-search-result")];
  const rect = (el) => el.getBoundingClientRect();
  // Ring and glow layers are the box-shadows with no vertical offset: spread (ring) and spread + blur (glow tail).
  const reach = (el) => {
    let ring = 0;
    let glow = 0;
    const shadow = getComputedStyle(el).boxShadow;
    for (const layer of shadow === "none" ? [] : shadow.split(/,(?![^(]*\))/)) {
      const n = [...layer.replace(/rgba?\([^)]*\)/g, "").matchAll(/-?\d+(\.\d+)?px/g)].map((m) => parseFloat(m[0]));
      if (n.length < 2 || n[0] !== 0 || n[1] !== 0) continue;
      ring = Math.max(ring, n[3] ?? 0);
      glow = Math.max(glow, (n[3] ?? 0) + (n[2] ?? 0));
    }
    return { ring, glow };
  };
  const focused = document.activeElement?.closest?.(".tv-search-result");
  const art = focused?.querySelector(".tv-search-result-art");
  const r = art ? reach(art) : null;
  const top = Math.min(...cards.map((c) => rect(c).top));
  return {
    button: button ? rect(button).left : null,
    beside: button ? rect(button).bottom > top : false,
    cardsRight: cards.map((c) => rect(c).right),
    ringRight: r ? rect(art).right + r.ring : null,
    glowRight: r ? rect(art).right + r.glow : null,
    innerWidth,
  };
}

for (const theme of ["dark", "light"]) {
  for (const [name, width, height] of VIEWPORTS) {
    const { context, page } = await open("/search?q=a", { width, height, theme });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(1500);
    // Focus the card with the greatest right edge: the last of the widest row.
    const lastIndex = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".tv-search-result")];
      let best = 0;
      cards.forEach((c, i) => {
        if (c.getBoundingClientRect().right > cards[best].getBoundingClientRect().right + 0.5) best = i;
      });
      return best;
    });
    await page.locator(".tv-search-result").nth(lastIndex).focus();
    await page.waitForTimeout(500);
    const m = await page.evaluate(measure);
    const tag = `${name} ${width}x${height} ${theme}`;
    check(`Search ${tag}: has result cards`, m.cardsRight.length > 0, String(m.cardsRight.length));
    // Beside the results (TV, tablet) the limit is the Filters button; on phones the button is above them.
    const limit = m.beside ? m.button : m.innerWidth;
    const worst = Math.max(...m.cardsRight);
    check(`Search ${tag}: every card ends left of Filters`, worst <= limit + 0.5, `card ${worst} > ${limit}`);
    check(`Search ${tag}: focus ring ends left of Filters`, m.ringRight !== null && m.ringRight <= limit + 0.5, `ring ${m.ringRight} > ${limit}`);
    check(`Search ${tag}: full focus glow ends left of Filters`, m.glowRight !== null && m.glowRight <= limit + 0.5, `glow ${m.glowRight} > ${limit}`);
    check(`Search ${tag}: focus glow is not clipped by the viewport`, m.glowRight !== null && m.glowRight <= m.innerWidth, `glow ${m.glowRight} > ${m.innerWidth}`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) });
    await context.close();
  }
}
await finish();
