#!/usr/bin/env node
// Owner bug 2026-10-18: with a right-hand panel open the whole site could scroll on mobile. While a panel is open the
// page behind must not scroll (touch swipe, wheel, scroll keys), a swipe inside a long panel scrolls the panel only,
// and closing restores the exact scroll position. 390x844 with touch emulation, plus a desktop wheel check.
//   node scripts/panels-scroll-lock-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 60, series: 12, artists: 6 });
const PAGES = [
  ["movies", "/movies", /^filters/i],
  ["series", "/series", /^filters/i],
  ["calendar-agenda", "/calendar?view=agenda&date=2026-10-07", /^filters/i],
  ["calendar-week", "/calendar?view=week&date=2026-10-07", /^filters/i],
];

// Sum of scrollTop over every element outside the panel: any page scroller moving changes it.
const pageScroll = (page) =>
  page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => !e.closest(".tv-filter-drawer")).reduce((n, e) => n + e.scrollTop, 0));
const panelScroll = (page) => page.evaluate(() => document.querySelector(".tv-filter-drawer .drawer-body")?.scrollTop ?? -1);

// A touch drag by dy px (dy < 0 drags up, so content scrolls down); the 16 ms steps let Chromium treat it as a scroll.
async function swipe(cdp, x, y, dy) {
  const at = (yy) => [{ x, y: yy, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(y) });
  for (let i = 1; i <= 20; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(y + (dy * i) / 20) });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await new Promise((r) => setTimeout(r, 400));
}

for (const [name, path, launcher] of PAGES) {
  // 390x480 is short enough that every panel overflows, to cover the in-panel swipe.
  for (const [mobile, h] of [[true, 844], [true, 480], [false, 800]]) {
    const tag = `${name}@${mobile ? `390x${h} touch` : "1280"}`;
    const { context, page } = await open(path, {
      width: mobile ? 390 : 1280,
      height: h,
      contextOptions: mobile ? { hasTouch: true, isMobile: true } : {},
    });
    try {
      const cdp = mobile ? await context.newCDPSession(page) : null;
      await page.waitForTimeout(800);
      // Control: with no panel open the page does scroll, so the assertions below can fail.
      await page.mouse.move(mobile ? 195 : 640, 400);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(500);
      const start = await pageScroll(page);
      if (start === 0) {
        console.log(`INFO  ${tag}: page does not scroll on this route, skipped`);
        continue;
      }
      await page.getByRole("button", { name: launcher }).first().click();
      await page.waitForSelector(".tv-filter-drawer");
      await page.waitForTimeout(700);
      const x = mobile ? 40 : 200; // left of the panel: the backdrop / page area
      await page.mouse.move(x, 400);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(400);
      if (mobile) await swipe(cdp, x, h * 0.7, -h * 0.5);
      // Over the panel's own non-scrolling header the gesture must not chain to the page either.
      const head = await page.evaluate(() => {
        const r = document.querySelector(".tv-filter-drawer .drawer-header").getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.move(head.x, head.y);
      await page.mouse.wheel(0, 500);
      if (mobile) await swipe(cdp, head.x, head.y, -300);
      await page.keyboard.press("PageDown");
      await page.waitForTimeout(300);
      check(`${tag}: page does not scroll behind the open panel (wheel${mobile ? ", swipe" : ""}, PageDown)`, (await pageScroll(page)) === start, `${start} -> ${await pageScroll(page)}`);

      // Inside a long panel the panel scrolls, the page does not.
      const overflow = await page.evaluate(() => {
        const b = document.querySelector(".tv-filter-drawer .drawer-body");
        return b.scrollHeight - b.clientHeight;
      });
      if (overflow > 8) {
        await page.evaluate(() => { document.querySelector(".tv-filter-drawer .drawer-body").scrollTop = 0; });
        const before = await panelScroll(page);
        const c = await page.evaluate(() => {
          const r = document.querySelector(".tv-filter-drawer .drawer-body").getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height * 0.7 };
        });
        if (mobile) await swipe(cdp, c.x, c.y, -h * 0.3);
        else {
          await page.mouse.move(c.x, c.y);
          await page.mouse.wheel(0, 300);
          await page.waitForTimeout(400);
        }
        check(`${tag}: panel scrolls itself`, (await panelScroll(page)) > before, `${before} -> ${await panelScroll(page)}`);
        check(`${tag}: page still still while the panel scrolls`, (await pageScroll(page)) === start);
      } else console.log(`INFO  ${tag}: panel does not overflow, in-panel scroll skipped`);

      // Changing an option keeps the lock; closing restores the position.
      const choice = page.locator(".tv-filter-drawer .drawer-body button[aria-pressed]").first();
      if (await choice.count()) await choice.click().catch(() => {});
      await page.waitForTimeout(500);
      await page.mouse.move(x, 400);
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(300);
      check(`${tag}: lock survives an option change`, (await pageScroll(page)) === start);
      await page.locator(".tv-filter-drawer .drawer-close").click();
      await page.waitForTimeout(700);
      check(`${tag}: closing restores the scroll position`, (await pageScroll(page)) === start, `${start} -> ${await pageScroll(page)}`);
      await page.mouse.move(mobile ? 195 : 640, 400);
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(400);
      check(`${tag}: page scrolls again after close`, (await pageScroll(page)) !== start);
    } finally {
      await context.close();
    }
  }
}
await finish();
