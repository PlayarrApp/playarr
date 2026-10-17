#!/usr/bin/env node
// Owner bug 2026-10-18: scrolled far down TV shows, clicked Music, it stayed scrolled. A navigation to another page must
// show every scroll container at scrollTop 0 on every frame once the new route is current (no old offset, no glide).
//   node scripts/nav-scroll-top-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { open, check, finish } = await boot({ movies: 80, series: 80, artists: 40 });

const sampler = () => {
  const s = (window.__scroll = { frames: [] });
  const tops = () => {
    const out = [document.scrollingElement?.scrollTop ?? 0];
    for (const el of document.querySelectorAll("main.app-main, main.app-main *")) if (el.scrollTop > 0 || el.matches("main.app-main, [data-navigation-scroll-key]")) out.push(el.scrollTop);
    return out;
  };
  const tick = () => {
    s.frames.push({ path: location.pathname, tops: tops() });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const scrollFar = () => {
  for (const el of document.querySelectorAll("main.app-main, main.app-main *")) {
    if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = 1e6;
  }
  if (document.scrollingElement) document.scrollingElement.scrollTop = 1e6;
};

const cases = [["/series", "/music", "Series to Music"], ["/", "/movies", "Home to Movies"], ["/movies", "/series", "Movies to Series"]];
for (const [width, height, how] of [[1920, 1080, "keyboard"], [1280, 720, "click"], [390, 844, "click"]]) {
  for (const [from, to, name] of cases) {
    const { page } = await open(from, { width, height, init: sampler });
    await page.waitForTimeout(600);
    // The list may still be loading: scroll again until something scrolled (Home has nothing tall at 1920 only sometimes).
    for (let i = 0; i < 10; i++) {
      await page.evaluate(scrollFar);
      await page.waitForTimeout(200);
      if (from === "/" || Math.max(...(await page.evaluate(() => window.__scroll.frames.at(-1).tops))) > 0) break;
    }
    const before = await page.evaluate(() => window.__scroll.frames.at(-1).tops);
    await page.evaluate(() => { window.__scroll.frames.length = 0; });
    const link = page.locator(`a[href="${to}"]`).first();
    if (!(await link.count())) { console.log(`SKIP  ${width} ${name}: no nav link`); continue; }
    if (how === "keyboard") {
      // The focus can land before the nav is wired up on a cold page: press again only while the route has not changed.
      for (let i = 0; i < 3 && (await page.evaluate(() => location.pathname)) !== to; i++) {
        await link.focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);
      }
    }
    else await link.evaluate((a) => a.click());
    await page.waitForFunction((p) => location.pathname === p, to, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(900);
    const frames = await page.evaluate(() => window.__scroll.frames);
    const after = frames.filter((f) => f.path === to);
    const bad = after.filter((f) => f.tops.some((t) => t > 0));
    check(`${width} ${name} (${how}): was scrolled before (${Math.max(...before)}px)`, Math.max(...before) > 0 || from === "/", `tops=${before}`);
    check(`${width} ${name} (${how}): every frame on the new route is at scrollTop 0`, after.length > 0 && bad.length === 0, `frames=${after.length} bad=${JSON.stringify(bad[0])}`);
  }
}
await finish();
