#!/usr/bin/env node
// Detail action buttons (Playback, Play, Download, Watchlist ...): keyboard focus must look like hover and its ring
// must not be cropped by the left nav rail. Layouts: TV 1920x1080 and desktop 1440x900 and 1280x720 (the rail shadow dims the ring at the desktop widths), dark and light.
//   node scripts/action-focus-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { open, check, finish } = await boot({});
const seed = await open("/series");
const seriesPath = await seed.page.evaluate(() => document.querySelector('a[href^="/series/"]')?.getAttribute("href"));
const pages = { film: "/movies/d2f71079-e37a-4ba4-ac2c-c4d02aea829b", series: seriesPath };
const LOOK = ["backgroundColor", "color", "transform", "boxShadow", "transition", "borderColor"];

for (const theme of ["dark", "light"]) {
  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 720]]) {
    for (const [name, path] of Object.entries(pages)) {
      const { page } = await open(path, { width, height, theme });
      await page.evaluate((t) => { localStorage.setItem("playarr-theme", t); document.documentElement.dataset.theme = t; }, theme);
      const actions = page.locator(".tv-detail-actions > button, .tv-detail-actions > a");
      await actions.first().waitFor();
      await page.waitForTimeout(1200);
      const count = await actions.count();
      for (const [which, index] of [["first", 0], ["last", count - 1]]) {
        const label = `${theme} ${width} ${name} ${which} action`;
        const el = actions.nth(index);
        const rest = await el.boundingBox();
        const layout = () => el.evaluate((n) => [n.offsetLeft, n.offsetTop, n.offsetWidth, n.offsetHeight].join());
        const layoutRest = await layout();
        const look = () => el.evaluate((node, props) => Object.fromEntries(props.map((p) => [p, getComputedStyle(node)[p]])), LOOK);
        await page.mouse.move(5, 5);
        await page.keyboard.press("Shift");
        await el.focus();
        await page.waitForTimeout(600);
        const focused = await look();
        // The ring is the 3px outline at a 2px offset: its middle sits 3.5px left of the (scaled) box. Hit-testing cannot see an outline, so read the painted pixel: it must be the ring colour, not the rail.
        const box = await el.boundingBox();
        const ringColour = await el.evaluate((n) => getComputedStyle(n).outlineColor.match(/\d+/g).slice(0, 3).map(Number));
        const px = Math.floor(box.x - 3.5);
        const png = await page.screenshot({ clip: { x: px, y: Math.round(box.y + box.height / 2), width: 1, height: 1 } });
        const seen = await page.evaluate(async (b64) => {
          const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
          const g = new OffscreenCanvas(1, 1).getContext("2d");
          g.drawImage(bmp, 0, 0);
          return Array.from(g.getImageData(0, 0, 1, 1).data).slice(0, 3);
        }, png.toString("base64"));
        const off = Math.max(...seen.map((v, i) => Math.abs(v - ringColour[i])));
        check(`${label}: focus ring painted above the nav rail`, off <= 3, `pixel ${seen} ring ${ringColour}`);
        check(`${label}: layout box unchanged by focus`, layoutRest === (await layout()), layoutRest);
        if (which === "first") {
          await el.evaluate((node) => node.blur());
          await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2);
          await page.waitForTimeout(600);
          const hovered = await look();
          check(`${label}: focused look equals hovered look`, JSON.stringify(focused) === JSON.stringify(hovered), JSON.stringify({ focused, hovered }));
        }
      }
      await page.context().close();
    }
  }
}
await finish();
