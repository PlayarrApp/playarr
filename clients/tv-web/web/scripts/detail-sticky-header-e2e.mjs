#!/usr/bin/env node
// Detail pages on phones: the header (Back + title) stays pinned while the app shell scrolls, and the content fades out
// under it (the header's ::before scrim). Series and film, 375/390/430 wide, both themes.
//   node scripts/detail-sticky-header-e2e.mjs [--no-build] [--dist dir] [--out screenshotDir]
import { mkdirSync } from "node:fs";
import { boot, opt } from "./e2e-common.mjs";

const { base, check, open, finish } = await boot({ seasons: 2, seasonEpisodes: 14 });
const OUT = opt("out", "");
if (OUT) mkdirSync(OUT, { recursive: true });
const first = async (kind) =>
  (await (await fetch(`${base}/api/v1/catalog?kind=${kind}&limit=1`, { headers: { authorization: "Bearer t" } })).json()).items[0]?.id;
const routes = [["series", `/series/${await first("series")}`], ["movie", `/movies/${await first("movie")}`]];

for (const theme of ["dark", "light"]) {
  for (const [name, route] of routes) {
    for (const width of [375, 390, 430]) {
      const { context, page } = await open(route, { width, height: 844, init: `localStorage.setItem("playarr-theme", "${theme}")` });
      const read = () =>
        page.evaluate(() => {
          const h = document.querySelector(".tv-detail > .tv-detail-heading");
          const r = h.getBoundingClientRect();
          return {
            top: r.top, back: h.querySelector(".tv-page-back").getBoundingClientRect().top,
            fixed: getComputedStyle(h).position, scrim: getComputedStyle(h, "::before").content,
            scrollable: document.querySelector(".app-main").scrollHeight - document.querySelector(".app-main").clientHeight,
          };
        });
      const before = await read();
      if (OUT && width === 390) await page.screenshot({ path: `${OUT}/${name}-${theme}-390-top.png` });
      await page.evaluate(() => document.querySelector(".app-main").scrollTo(0, 400));
      await page.waitForTimeout(300);
      const after = await read();
      if (OUT && width === 390) await page.screenshot({ path: `${OUT}/${name}-${theme}-390-scrolled.png` });
      const tag = `${name} ${width} ${theme}`;
      check(`${tag}: page scrolls`, after.scrollable > 60, JSON.stringify(after));
      check(`${tag}: header at same offset after scroll`, before.top === after.top && before.back === after.back, `${before.top}/${before.back} -> ${after.top}/${after.back}`);
      check(`${tag}: header fixed with fade scrim`, after.fixed === "fixed" && after.scrim !== "none", JSON.stringify(after));
      await context.close();
    }
  }
}
await finish();
