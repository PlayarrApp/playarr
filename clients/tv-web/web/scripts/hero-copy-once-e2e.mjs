#!/usr/bin/env node
// Hero copy block (Home feature, library preview): on every navigation it must animate in exactly once and stay.
// Owner bug 2026-10-18: it showed, hid, then animated back in. Samples the block every frame for 800 ms after each
// click (Home > Movies > Series > Home > Movies) at 1920, 1280 and 390 px wide.
//   node scripts/hero-copy-once-e2e.mjs [--no-build] [--dist dir] [--report]
import { boot } from "./e2e-common.mjs";

const { open, check, finish } = await boot({});
const report = process.argv.includes("--report");

const sampler = () => {
  const s = (window.__hero = { frames: [], ids: new WeakMap(), n: 0, anims: new WeakSet(), starts: {} });
  const tick = () => {
    const el = [...document.querySelectorAll(".tv-home-feature, .tv-library-preview")].at(-1);
    let frame = null;
    if (el) {
      if (!s.ids.has(el)) s.ids.set(el, (s.n += 1));
      const id = s.ids.get(el);
      for (const a of document.getAnimations()) {
        if (a.effect?.target?.contains?.(el) && !s.anims.has(a)) { s.anims.add(a); s.starts[id] = (s.starts[id] ?? 0) + 1; }
      }
      let opacity = 1;
      for (let n = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
      frame = { id, opacity };
    }
    s.frames.push(frame);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

// The previous page stays drawn until the new route mounts, so only the block of the page navigated to is judged:
// its opacity may only rise, and exactly one animation (the route entry) may start on it.
const steps = [["/movies", "Movies"], ["/series", "Series"], ["/", "Home"], ["/movies", "Movies"]];
for (const [width, height] of [[1920, 1080], [1280, 720], [390, 844]]) {
  const { page } = await open("/", { width, height, init: sampler });
  for (const [href, name] of steps) {
    await page.evaluate(() => { const s = window.__hero; s.frames.length = 0; s.starts = {}; s.anims = new WeakSet(); });
    const link = page.locator(`a[href="${href}"]`).first();
    if (!(await link.count()) || !(await link.isVisible())) { console.log(`SKIP  ${width}: no visible link to ${name}`); continue; }
    await link.click();
    await page.waitForTimeout(800);
    const { frames, starts } = await page.evaluate(() => ({ frames: window.__hero.frames, starts: window.__hero.starts }));
    const label = `${width}px to ${name}`;
    if (report) console.log(`  url=${page.url()} ids=${[...new Set(frames.filter(Boolean).map((f) => f.id))]}`);
    const last = frames.filter(Boolean).at(-1);
    if (!last) { console.log(`SKIP  ${label}: no hero block on this layout`); continue; }
    const mine = frames.filter((f) => f?.id === last.id);
    let peak = 0, dropped = false;
    for (const f of mine) { if (f.opacity > 0.9) peak = 1; else if (peak) dropped = true; }
    const rises = mine.every((f, i) => i === 0 || f.opacity >= mine[i - 1].opacity - 0.001);
    const n = starts[last.id] ?? 0;
    if (report) console.log(`${label}: first opacity=${mine[0].opacity.toFixed(2)} dropped=${dropped} starts=${n} frames=${mine.map((f) => f.opacity.toFixed(2)).join(",")}`);
    check(`${label}: opacity never drops once at full, only rises`, !dropped && rises, `opacities=${mine.map((f) => f.opacity.toFixed(2)).join(",")}`);
    check(`${label}: at most one entry animation`, n <= 1, `starts=${n}`);
  }
}
await finish();
