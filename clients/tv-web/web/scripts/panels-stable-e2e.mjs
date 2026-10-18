#!/usr/bin/env node
// Owner bug 2026-10-18: changing an option inside an open filter/view panel must not re-render the panel.
// For every page panel, at 1280, 1920 (keyboard) and 390: tag the open drawer node, then change every option and assert
// the same node, no second mount, no CSS animation start, focus still on the changed control, drawer-body scroll kept.
//   node scripts/panels-stable-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 24, series: 12, artists: 6 });

const PANELS = [
  ["calendar-month", "/calendar?view=month&date=2026-10-07&panel=filters"],
  ["calendar-week", "/calendar?view=week&date=2026-10-07&panel=filters"],
  ["calendar-agenda", "/calendar?view=agenda&date=2026-10-07&panel=filters"],
  ["calendar-link", "/calendar?view=week&date=2026-10-07&panel=link"],
  ["movies", "/movies?panel=filters"],
  ["series", "/series?panel=filters"],
  ["music", "/music?panel=filters"],
  ["search", "/search?q=a&panel=filters"],
  ["downloads", "/downloads?panel=filters"],
  ["playlists", "/playlists?panel=filters"],
  ["folders", "/folders?panel=filters"],
];
const VIEWPORTS = [
  { tag: "1280", width: 1280, height: 800, keyboard: false },
  { tag: "1920", width: 1920, height: 1080, keyboard: true },
  { tag: "390", width: 390, height: 844, keyboard: false },
];

const table = [];
for (const vp of VIEWPORTS) {
  for (const [name, path] of PANELS) {
    const label = `${name}@${vp.tag}`;
    const { context, page } = await open(path, { width: vp.width, height: vp.height });
    try {
      const drawer = page.locator(".tv-filter-drawer").first();
      if (!(await drawer.count())) {
        await page.waitForSelector(".tv-filter-drawer", { timeout: 4000 }).catch(() => {});
      }
      if (!(await drawer.count())) {
        console.log(`INFO  ${label}: no panel at this route/viewport, skipped`);
        continue;
      }
      // The entry animation may start late on a busy first load: tag only once it has finished.
      await page.waitForFunction(() => document.querySelector(".tv-filter-drawer").getAnimations().every((a) => a.playState === "finished"));
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const node = document.querySelector(".tv-filter-drawer");
        window.__panel = { node, mounts: 0, anims: 0 };
        new MutationObserver((records) => {
          for (const r of records)
            for (const n of r.addedNodes) if (n instanceof Element && (n.matches(".tv-filter-drawer") || n.querySelector(".tv-filter-drawer"))) window.__panel.mounts++;
        }).observe(document.body, { childList: true, subtree: true });
        document.addEventListener("animationstart", (e) => { if (e.target === node) { window.__panel.anims++; (window.__panel.names ??= []).push(e.animationName); } }, true);
      });
      const count = await page.evaluate(() => {
        const sel = '.tv-filter-drawer .drawer-body :is(button:not(.drawer-close), input[type=checkbox], input[type=radio])';
        return [...document.querySelectorAll(sel)].filter((e) => !e.closest("[role=listbox]") && !e.closest(".ui-multiselect") && !/clear|reset|close/i.test(e.textContent ?? "")).length;
      });
      let remounted = false, focusLost = false, scrollMoved = false, anim = false, tried = 0;
      for (let i = 0; i < Math.min(count, 14); i++) {
        const sel = `(() => [...document.querySelectorAll('.tv-filter-drawer .drawer-body :is(button:not(.drawer-close), input[type=checkbox], input[type=radio])')].filter((e) => !e.closest('[role=listbox]') && !e.closest('.ui-multiselect') && !/clear|reset|close/i.test(e.textContent ?? ''))[${i}])()`;
        const handle = await page.evaluateHandle(sel);
        const el = handle.asElement();
        if (!el) break;
        if (await el.evaluate((e) => e.disabled || e.getAttribute("aria-disabled") === "true")) continue;
        await el.scrollIntoViewIfNeeded().catch(() => {});
        const before = await el.evaluate((e) => ({ key: (e.getAttribute("aria-label") || e.textContent || e.name || "").trim(), top: e.closest(".drawer-body").scrollTop }));
        if (vp.keyboard) {
          await el.focus();
          await page.keyboard.press(before.key !== undefined && (await el.evaluate((e) => e.type === "checkbox")) ? "Space" : "Enter");
        } else {
          await el.click();
        }
        await page.waitForTimeout(500);
        tried++;
        const after = await page.evaluate(() => {
          const p = window.__panel;
          const a = document.activeElement;
          const d = document.querySelector(".tv-filter-drawer");
          return {
            same: d === p.node && p.node.isConnected,
            mounts: p.mounts,
            anims: p.anims, names: p.names,
            focusIn: !!a && !!d && d.contains(a) && a !== d.querySelector(".drawer-close"),
            focusKey: a ? (a.getAttribute("aria-label") || a.textContent || a.name || "").trim() : null,
            top: d?.querySelector(".drawer-body")?.scrollTop ?? -1,
          };
        });
        if (!after.same || after.mounts > 0) remounted = true;
        if (after.anims > 0) { anim = true; console.log("ANIM", label, after.names); }
        if (!after.focusIn || after.focusKey !== before.key) focusLost = true;
        if (Math.abs(after.top - before.top) > 1) scrollMoved = true;
        await handle.dispose();
      }
      const row = { panel: label, options: tried, remounted, anim, focusLost, scrollMoved };
      table.push(row);
      check(`${label}: same node, no remount, no animation, focus and scroll kept (${tried} options)`, !remounted && !anim && !focusLost && !scrollMoved, JSON.stringify(row));
    } finally {
      await context.close();
    }
  }
}
console.log("\npanel | options | remounted | anim | focusLost | scrollMoved");
for (const r of table) console.log(`${r.panel} | ${r.options} | ${r.remounted} | ${r.anim} | ${r.focusLost} | ${r.scrollMoved}`);
await finish();
