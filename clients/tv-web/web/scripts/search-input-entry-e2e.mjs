#!/usr/bin/env node
// Search page entry: the input must mount once, stay visible and never be drawn left of its final position (which is
// right of the nav rail). Owner bug: it showed, vanished, then slid in from the left, cropped under the nav.
// Samples the input every frame from document start, loading /search directly and navigating from Home, at
// 1920x1080 and 1280x720, dark and light.
//   node scripts/search-input-entry-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { open, check, finish } = await boot({});

// Runs before any page script: records per-frame geometry and effective opacity of the search input, and counts mounts.
const sampler = () => {
  const s = (window.__searchSamples = { frames: [], mounts: 0 });
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) {
      if (n.nodeType === 1 && (n.matches?.('input[type="search"]') || n.querySelector?.('input[type="search"]'))) s.mounts += 1;
    }
  }).observe(document, { childList: true, subtree: true });
  const tick = () => {
    const input = document.querySelector('.tv-search-form input');
    let frame = null;
    if (input) {
      const r = input.getBoundingClientRect();
      let opacity = 1;
      for (let el = input; el; el = el.parentElement) opacity *= Number(getComputedStyle(el).opacity);
      frame = { t: performance.now(), left: r.left, opacity };
    }
    s.frames.push(frame);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

for (const theme of ["dark", "light"]) {
  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    for (const via of ["direct", "from-home"]) {
      const label = `${theme} ${width}x${height} ${via}`;
      const { page } = await open(via === "direct" ? "/search" : "/", { width, height, theme, init: sampler });
      if (via === "from-home") {
        await page.evaluate(() => { window.__searchSamples.frames.length = 0; window.__searchSamples.mounts = 0; });
        await page.locator('a[href="/search"]').first().click();
        await page.waitForTimeout(1200);
      }
      const { frames, mounts } = await page.evaluate(() => window.__searchSamples);
      const seen = frames.filter(Boolean);
      const final = seen.at(-1);
      const first = frames.findIndex(Boolean);
      // The owner-ruled route fade (opacity 0 to 1) is allowed; show, hide, show is not.
      const rises = seen.every((f, i) => i === 0 || f.opacity >= seen[i - 1].opacity - 0.001);
      check(`${label}: input mounts once`, mounts === 1, `mounts=${mounts}`);
      check(`${label}: input never left of its final position`, seen.every((f) => f.left >= final.left - 0.5), `min=${Math.min(...seen.map((f) => f.left))} final=${final.left}`);
      check(`${label}: input never hidden once drawn`, seen.length > 0 && frames.slice(first).every(Boolean) && rises, `opacities=${seen.map((f) => f.opacity.toFixed(2)).join(",")}`);
    }
  }
}
await finish();
