#!/usr/bin/env node
// Browser Back returns a library page to the scroll offset it was left at; Forward lands on the next page at the top
// (what it was left at), and a second Back restores again. Pairs with nav-scroll-top-e2e (a fresh navigation starts at 0).
//   node scripts/back-forward-scroll-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { open, check, finish } = await boot({ movies: 120, series: 80, artists: 0 });

const tops = () => {
  const out = [];
  for (const el of document.querySelectorAll("main.app-main, main.app-main *")) {
    if (el.scrollTop > 0 || el.matches("main.app-main, [data-navigation-scroll-key]")) out.push(Math.round(el.scrollTop));
  }
  return out;
};
const scrollSome = () => {
  // The scroller with the longest scrollable range: the library grid on desktop, the page on a phone.
  let best = null, range = 0;
  for (const el of document.querySelectorAll("main.app-main, main.app-main *")) {
    const r = el.scrollHeight - el.clientHeight;
    if (r > range && /auto|scroll/.test(getComputedStyle(el).overflowY)) { best = el; range = r; }
  }
  if (best) best.scrollTop = Math.min(900, range);
};
const sum = (a) => a.reduce((x, y) => x + y, 0);

for (const [width, height] of [[1920, 1080], [1280, 720], [390, 844]]) {
  const { page } = await open("/movies", { width, height });
  await page.waitForTimeout(500);
  let before = 0;
  for (let i = 0; i < 10 && before === 0; i++) { await page.evaluate(scrollSome); await page.waitForTimeout(250); before = sum(await page.evaluate(tops)); }
  // A smooth-scrolling grid glides to its target: wait until it stops before taking the reference offset.
  for (let prev = -1; prev !== before;) { prev = before; await page.waitForTimeout(400); before = sum(await page.evaluate(tops)); }
  const initial = await page.evaluate(tops);
  const label = `${width}px`;
  check(`${label}: library scrolled before opening a title (${before}px)`, before > 0);
  const card = page.locator('a[href^="/movies/"]').first();
  await card.evaluate((a) => a.click());
  await page.waitForFunction(() => /^\/movies\/.+/.test(location.pathname), null, { timeout: 5000 });
  await page.waitForTimeout(600);
  const restored = async (name) => {
    await page.waitForFunction(() => location.pathname === "/movies", null, { timeout: 5000 });
    // Poll: the list may still be a skeleton when the route is current, and the restore waits for its scroller.
    let now = 0;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(250);
      now = sum(await page.evaluate(tops));
      if (Math.abs(now - before) <= 2) break;
    }
    await page.waitForTimeout(800);
    now = sum(await page.evaluate(tops));
    check(`${label}: ${name} restores the scroll position`, Math.abs(now - before) <= 2, `before=${before} now=${now} tops=${await page.evaluate(tops)} initial=${JSON.stringify(initial)}`);
  };
  await page.goBack();
  await restored("Back");
  await page.goForward();
  await page.waitForFunction(() => /^\/movies\/.+/.test(location.pathname), null, { timeout: 5000 });
  await page.waitForTimeout(600);
  check(`${label}: Forward lands on the title at its top`, sum(await page.evaluate(tops)) === 0, `tops=${await page.evaluate(tops)}`);
  await page.goBack();
  await restored("second Back");
}
await finish();
