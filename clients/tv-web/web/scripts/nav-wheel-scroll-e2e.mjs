#!/usr/bin/env node
// Pointer scrolling over the rail stacks (Home, a film's detail page) and keyboard focus staying on screen.
//
// Owner bug (14 Oct 2026): "the scroll is horribly broken on the homepage" and on the film detail page, in a desktop
// browser, "my focused item is literally off the screen". Two causes:
// - A vertical mouse wheel or trackpad scroll over a rail did nothing: each horizontal rail is an x-only scroller with
//   `overscroll-behavior: contain`, which in Chromium also stops the vertical scroll chaining to the stack.
// - A wheel scroll that did move the stack (pointer between rails) left the focused card off screen, and Left or Right
//   along that rail never brought it back: the rail guard held the stack still for any move within the centred rail.
// A horizontal wheel must still scroll the rail itself, and arrow keys must keep the focused item inside the viewport.
//
//   node scripts/nav-wheel-scroll-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 40, series: 12, artists: 12, castCount: 20 });

const STACK = ".tv-rail-surface.is-vertical-tracks";
const SIZES = [{ width: 1920, height: 1080 }, { width: 1536, height: 864 }, { width: 1440, height: 900 }];

const ready = async (page, path) => {
  if (path === "detail") {
    await page.waitForSelector(".tv-library-grid a[href^='/movies/'], a[href^='/movies/']");
    await page.goto(new URL(await page.locator("a[href^='/movies/']").first().getAttribute("href"), page.url()).href);
  }
  await page.waitForSelector(`${STACK} .tv-media-track-scroll`);
  // The stack has settled when its scroll offset holds over two animation frames after the entrance.
  await page.waitForFunction((s) => document.querySelector(s)?.scrollHeight > document.querySelector(s)?.clientHeight, STACK);
  await page.waitForTimeout(1200);
};
const stackTop = (page) => page.evaluate((s) => document.querySelector(s).scrollTop, STACK);
/** Resolves once the stack's scroll offset has held still for 10 animation frames (a wheel or eased glide has ended). */
const settled = (page) => page.evaluate((s) => new Promise((done) => {
  const el = document.querySelector(s); let last = el.scrollTop, still = 0;
  const tick = () => { still = el.scrollTop === last ? still + 1 : 0; last = el.scrollTop; if (still >= 10) done(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}), STACK);
/** Centre of the first rail that is fully inside the viewport, so the pointer starts over a horizontal scroller. */
const railPoint = (page) => page.evaluate(() => {
  const r = [...document.querySelectorAll(".tv-media-track-scroll")].map((x) => x.getBoundingClientRect())
    .find((b) => b.height > 0 && b.top >= 0 && b.bottom <= innerHeight);
  return r ? { x: Math.min(r.left + r.width / 2, innerWidth - 40), y: r.top + r.height / 2 } : null;
});
const focusInView = (page) => page.evaluate(() => {
  const e = document.querySelector("[data-remote-active]") ?? document.activeElement;
  if (!e || e === document.body) return { ok: false, why: "no focus" };
  const r = e.getBoundingClientRect();
  return { ok: r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1, rect: [r.left, r.top, r.right, r.bottom].map(Math.round) };
});

for (const [name, path] of [["Home", "/"], ["film detail", "detail"]]) {
  for (const size of SIZES) {
    const tag = `${name} ${size.width}x${size.height}`;
    // Mouse wheel and trackpad over a rail.
    {
      const { context, page, errors } = await open(path === "detail" ? "/movies" : "/", size);
      await ready(page, path);
      const at = await railPoint(page);
      check(`${tag}: a rail is on screen to scroll over`, at !== null);
      if (at) {
        await page.mouse.move(at.x, at.y);
        const t0 = await stackTop(page);
        for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, 200);
        const moved = await page.waitForFunction(([s, t]) => document.querySelector(s).scrollTop >= t + 300, [STACK, t0], { timeout: 3000 }).then(() => true, () => false);
        await settled(page);
        check(`${tag}: a vertical wheel over a rail scrolls the stack`, moved, `scrollTop ${t0} -> ${await stackTop(page)}`);
        const t1 = await stackTop(page);
        const at2 = (await railPoint(page)) ?? at;
        await page.mouse.move(at2.x, at2.y);
        for (let i = 0; i < 30; i += 1) await page.mouse.wheel(0, -10);
        const back = await page.waitForFunction(([s, t]) => document.querySelector(s).scrollTop <= t - 200, [STACK, t1], { timeout: 3000 }).then(() => true, () => false);
        check(`${tag}: small trackpad steps over a rail scroll the stack back up`, back, `scrollTop ${t1} -> ${await stackTop(page)}`);
        // A horizontal wheel still scrolls the rail under the pointer, not the page.
        const rail = await page.evaluateHandle(([x, y]) => document.elementFromPoint(x, y)?.closest(".tv-media-track-scroll"), [at2.x, at2.y]);
        const l0 = await rail.evaluate((r) => r?.scrollLeft ?? -1);
        const canScroll = await rail.evaluate((r) => !!r && r.scrollWidth > r.clientWidth + 1);
        if (canScroll) {
          await page.mouse.wheel(300, 0);
          const slid = await page.waitForFunction(([r, l]) => r.scrollLeft > l + 50, [rail, l0], { timeout: 3000 }).then(() => true, () => false);
          check(`${tag}: a horizontal wheel over a rail scrolls that rail`, slid, `scrollLeft ${l0} -> ${await rail.evaluate((r) => r.scrollLeft)}`);
        }
      }
      check(`${tag}: no page errors (wheel)`, errors.length === 0, errors.join(";"));
      await context.close();
    }
    // Arrow keys: the focused item stays inside the viewport after every key.
    {
      const { context, page, errors } = await open(path === "detail" ? "/movies" : "/", size);
      await ready(page, path);
      const bad = [];
      for (const key of ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowUp", "ArrowUp"]) {
        await page.keyboard.press(key);
        // The eased glide (about 200 ms) starts after the key is handled: let it begin, then wait for it to end.
        await page.waitForTimeout(120);
        await settled(page);
        const f = await focusInView(page);
        if (!f.ok) bad.push(`${key} ${JSON.stringify(f)}`);
      }
      check(`${tag}: arrow keys keep the focused item on screen`, bad.length === 0, bad.join("; "));
      // A wheel scroll that carries the focused card off screen, then Right and Left along its rail: the stack follows
      // the focus back (the rail guard only holds the stack still while the focused card is visible).
      await page.mouse.move(size.width - 60, 20);
      const t0 = await stackTop(page);
      await page.mouse.wheel(0, size.height);
      await page.waitForFunction(([s, t]) => document.querySelector(s).scrollTop > t + 100, [STACK, t0], { timeout: 3000 }).catch(() => {});
      await settled(page);
      const off = await focusInView(page);
      check(`${tag}: a wheel scroll carries the focused item off screen (setup)`, !off.ok, JSON.stringify(off));
      await page.keyboard.press("ArrowLeft");
      const back = await page.waitForFunction(() => {
        const e = document.querySelector("[data-remote-active]") ?? document.activeElement;
        const r = e?.getBoundingClientRect();
        return !!r && r.top >= -1 && r.bottom <= innerHeight + 1;
      }, null, { timeout: 3000 }).then(() => true, () => false);
      check(`${tag}: after a wheel scroll, Left along the rail brings the focused item back on screen`, back, JSON.stringify(await focusInView(page)));
      check(`${tag}: no page errors (keys)`, errors.length === 0, errors.join(";"));
      await context.close();
    }
  }
}

// Phone: a vertical touch pan that starts on a rail scrolls Home (touch slop takes part of the 300 px pan).
{
  const { context, page, errors } = await open("/", { width: 390, height: 844, contextOptions: { isMobile: true, hasTouch: true } });
  await ready(page, "/");
  const at = await railPoint(page);
  if (at) {
    const before = await page.evaluate(() => [...document.querySelectorAll("*")].reduce((n, e) => n + e.scrollTop, 0) + scrollY);
    // Raw touch points (synthesizeScrollGesture does nothing in headless Chromium): a 300 px upward pan over 30 frames.
    const cdp = await context.newCDPSession(page);
    const point = (dy) => [{ x: Math.round(at.x), y: Math.round(at.y - dy) }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(0) });
    for (let dy = 10; dy <= 300; dy += 10) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(dy) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction((b) => [...document.querySelectorAll("*")].reduce((n, e) => n + e.scrollTop, 0) + scrollY >= b + 100, before, { timeout: 3000 }).catch(() => {});
    const after = await page.evaluate(() => [...document.querySelectorAll("*")].reduce((n, e) => n + e.scrollTop, 0) + scrollY);
    check("Home 390x844: a vertical touch pan that starts on a rail scrolls the page", after >= before + 100, `scrolled ${before} -> ${after}`);
  } else check("Home 390x844: a rail is on screen to pan over", false);
  check("Home 390x844: no page errors", errors.length === 0, errors.join(";"));
  await context.close();
}

await finish();
