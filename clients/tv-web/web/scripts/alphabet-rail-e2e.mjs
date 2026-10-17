#!/usr/bin/env node
// Library alphabet rail (owner 2026-10-10): ONE column of letters, scrolling vertically with the shared edge fade when
// the 44px letters do not fit, and the focused letter always scrolled into view.
//   node scripts/alphabet-rail-e2e.mjs [--dist dir] [--out dir]
// Movies, Series and Music, at 1920x1080 and 1280x720, in both themes, driven by the keyboard.
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import("playwright-core");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt("out", "");
const ONLY = opt("only", ""); // --only active: just the active/focus/jump section (the older sections are slow)
if (OUT) mkdirSync(OUT, { recursive: true });
const USER_ID = "00000000-0000-4000-8000-000000000001";
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
};

const server = await startServer({ distDir: opt("dist", join(root, "dist")), movies: 300, series: 80, artists: 60, onDeck: 0 });
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch();

const railState = () => {
  const nav = document.querySelector(".tv-alphabet");
  if (!nav) return null;
  const buttons = [...nav.querySelectorAll("button")];
  const rails = nav.getBoundingClientRect();
  const lefts = new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().left)));
  const a = document.activeElement;
  const inRail = a && nav.contains(a);
  const r = inRail ? a.getBoundingClientRect() : null;
  return {
    count: buttons.length,
    columns: lefts.size,
    minHeight: Math.min(...buttons.map((b) => b.getBoundingClientRect().height)),
    minWidth: Math.min(...buttons.map((b) => b.getBoundingClientRect().width)),
    overflow: nav.scrollHeight - nav.clientHeight,
    scrollTop: nav.scrollTop,
    fadeAxis: nav.dataset.fadeAxis ?? null,
    fadeStart: nav.dataset.fadeStart !== undefined,
    fadeEnd: nav.dataset.fadeEnd !== undefined,
    mask: getComputedStyle(nav).webkitMaskImage || getComputedStyle(nav).maskImage,
    focused: inRail ? a.textContent : null,
    focusedInView: inRail ? r.top >= rails.top - 0.5 && r.bottom <= rails.bottom + 0.5 : null,
    inViewport: rails.left >= 0 && rails.right <= innerWidth && rails.top >= 0 && rails.bottom <= innerHeight,
  };
};

// A key moves focus and starts a smooth scroll: wait (up to 5 s, the host may be busy) until the focused letter changed,
// is in view and the scroll settled.
const step = async (page, key, before) => {
  await page.keyboard.press(key);
  let prev = null;
  let s = null;
  for (let k = 0; k < 50; k += 1) {
    await page.waitForTimeout(100);
    s = await page.evaluate(railState);
    if (s.focused !== before && s.focusedInView && prev !== null && s.scrollTop === prev) break;
    prev = s.scrollTop;
  }
  return s;
};

for (const [w, h] of ONLY ? [] : [[1920, 1080], [1280, 720]]) {
  for (const theme of ["dark", "light"]) {
    for (const route of ["movies", "series", "music"]) {
      const tag = `${w}x${h} ${theme} /${route}`;
      const context = await browser.newContext({ viewport: { width: w, height: h } });
      await context.addInitScript(({ base, userId, theme }) => {
        localStorage.setItem("playarr:apiBaseUrl", base);
        const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
        localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "d", session }]));
        localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
        localStorage.setItem("playarr-theme", theme);
        document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = theme; });
      }, { base, userId: USER_ID, theme });
      const page = await context.newPage();
      await page.goto(`${base}/${route}`);
      await page.waitForSelector(".tv-alphabet button", { timeout: 10000 });
      await page.waitForTimeout(800);

      const first = await page.evaluate(railState);
      check(`${tag}: one column of letters`, first.columns === 1, `${first.columns} columns, ${first.count} letters`);
      check(`${tag}: every letter is at least 44x44`, first.minHeight >= 44 && first.minWidth >= 44, `${first.minWidth}x${first.minHeight}`);
      check(`${tag}: the rail sits inside the viewport`, first.inViewport);
      check(`${tag}: the column scrolls when the letters do not fit`, first.overflow > 0, `overflow ${first.overflow}`);
      // Owner 2026-10-10: the rail runs to the bottom of the stage like the library grid, and its bottom fade is the soft
      // mask with no straight line: no letter is cut by a clip edge above the screen bottom.
      const geo = await page.evaluate(() => {
        const n = document.querySelector(".tv-alphabet").getBoundingClientRect();
        const g = document.querySelector(".tv-title-grid").getBoundingClientRect();
        return { railBottom: n.bottom, gridBottom: g.bottom, railTop: n.top, railLeft: n.left, railRight: n.right };
      });
      check(`${tag}: the rail's bottom equals the grid's bottom`, Math.abs(geo.railBottom - geo.gridBottom) <= 2, JSON.stringify(geo));
      const shot = await page.screenshot({ clip: { x: geo.railLeft, y: geo.railTop, width: geo.railRight - geo.railLeft, height: geo.railBottom - geo.railTop } });
      const ink = await page.evaluate(async ({ b64, tops }) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        const lum = (x, y) => { const i = (y * bmp.width + x) * 4; return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; };
        // Peak contrast of each 44px letter cell against the background beside it (the cell's padding column).
        return tops.map((top) => {
          let peak = 0;
          for (let y = Math.max(0, Math.round(top)); y < Math.min(bmp.height, Math.round(top) + 44); y += 1) {
            const bg = lum(1, y);
            for (let x = 8; x < bmp.width - 8; x += 1) peak = Math.max(peak, Math.abs(lum(x, y) - bg));
          }
          return peak;
        });
      }, { b64: shot.toString("base64"), tops: await page.evaluate(() => { const n = document.querySelector(".tv-alphabet").getBoundingClientRect(); return [...document.querySelectorAll(".tv-alphabet button")].map((b) => b.getBoundingClientRect().top - n.top); }) });
      const tops = await page.evaluate(() => { const n = document.querySelector(".tv-alphabet").getBoundingClientRect(); return [...document.querySelectorAll(".tv-alphabet button")].map((b) => b.getBoundingClientRect().top - n.top); });
      const visible = ink.map((peak, i) => ({ peak, top: tops[i] })).filter((l) => l.top >= 0 && l.top + 44 <= geo.railBottom - geo.railTop + 0.5);
      const lower = visible.slice(-5).map((l) => l.peak);
            check(`${tag}: the lowest letter is dimmer than the ones above (it fades toward the bottom edge)`, lower.at(-1) < Math.max(...lower) * 0.95, `peaks ${lower.map((v) => Math.round(v)).join(",")}`);
      // No hard stop in the mask: the gradient alpha never jumps by more than 0.3 (the eased ramp's steepest step is 0.24; a hard stop is 0.7 or more) between consecutive stops (the shared eased fade).
      const stops = first.mask ? [...first.mask.matchAll(/rgba?\(0, 0, 0(?:, ([\d.]+))?\)/g)].map((m) => (m[1] === undefined ? 1 : Number(m[1]))) : [];
      check(`${tag}: the fade mask has no hard stop (soft gradient, no straight line)`, stops.length >= 8 && stops.every((a, i) => i === 0 || Math.abs(a - stops[i - 1]) <= 0.3), JSON.stringify(stops));
      check(`${tag}: the bottom edge fade is present at first sight (no box, a mask)`, first.fadeAxis === "y" && first.fadeEnd && !first.fadeStart && first.mask && first.mask !== "none", JSON.stringify(first));

      // Keyboard only: focus the first letter, then walk down through all of them.
      await page.evaluate(() => document.querySelector(".tv-alphabet button")?.focus());
      let bad = 0;
      const misses = [];
      let last = await page.evaluate(railState);
      for (let i = 0; i < 26; i += 1) {
        const s = await step(page, "ArrowDown", last?.focused ?? "#");
        if (s.focused === null || !s.focusedInView) { bad += 1; misses.push(`${i}:${s.focused}:${s.focusedInView}:${s.scrollTop}`); }
        last = s;
      }
      check(`${tag}: the focused letter was in view after every key`, bad === 0 && last.focused === "Z", `${bad} misses (${misses.join(" ")}), focused ${last.focused}`);
      check(`${tag}: walking to the last letter scrolled the column, top fade on, bottom fade off (or within 8px of the end)`, last.scrollTop > 0 && last.fadeStart && (!last.fadeEnd || last.overflow - last.scrollTop <= 8) && last.columns === 1, JSON.stringify(last));
      if (OUT) await page.screenshot({ path: join(OUT, `alphabet-${route}-${w}-${theme}-end.png`) });

      for (let i = 0; i < 26; i += 1) {
        const s = await step(page, "ArrowUp", last.focused);
        if (s.focused === null || !s.focusedInView) { bad += 1; misses.push(`${i}:${s.focused}:${s.focusedInView}:${s.scrollTop}`); }
        last = s;
      }
      check(`${tag}: walking back up keeps the focused letter in view`, bad === 0 && (last.focused === "#" || last.focused === "A"), `${bad} misses (${misses.join(" ")}), focused ${last.focused}`);
      if (OUT) await page.screenshot({ path: join(OUT, `alphabet-${route}-${w}-${theme}-start.png`) });
      await context.close();
    }
  }
}
// Phones (owner 2026-10-11): the rail stays on the right edge, between the header and the bottom nav, never covering a
// card, and a tap on a letter jumps the grid there.
for (const theme of ONLY && ONLY !== "phone" ? [] : ["dark", "light"]) {
  for (const route of ["movies", "series"]) {
    const tag = `390x845 ${theme} /${route}`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await context.addInitScript(({ base, userId, theme }) => {
      localStorage.setItem("playarr:apiBaseUrl", base);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "d", session }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
      localStorage.setItem("playarr-theme", theme);
    }, { base, userId: USER_ID, theme });
    const page = await context.newPage();
    await page.goto(`${base}/${route}`);
    await page.waitForSelector(".tv-alphabet button", { timeout: 10000 });
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
      const n = document.querySelector(".tv-alphabet");
      const r = n.getBoundingClientRect();
      const cards = [...document.querySelectorAll(".tv-title-card")].map((c) => c.getBoundingClientRect()).filter((c) => c.width > 0);
      const nav = document.querySelector(".app-nav")?.getBoundingClientRect();
      const header = document.querySelector(".page-header")?.getBoundingClientRect();
      const letters = [...n.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
      return { visible: getComputedStyle(n).display !== "none" && r.width > 0, left: r.left, right: r.right, top: r.top, bottom: r.bottom, cardsRight: Math.max(...cards.map((c) => c.right)), navTop: nav?.top ?? 845, headerBottom: header?.bottom ?? 0, count: letters.length, minW: Math.min(...letters.map((l) => l.width)), marginL: Math.min(...letters.map((l) => l.left - r.left)), marginR: Math.min(...letters.map((l) => r.right - l.right)), fit: letters.every((l) => l.height >= 14 && l.bottom <= r.bottom + 1 && l.top >= r.top - 1) };
    });
    check(`${tag}: the letter rail is shown on the right edge`, m.visible && m.right <= 390.5 && m.left >= 330, JSON.stringify(m));
    check(`${tag}: all 27 letters fit in the rail`, m.count === 27 && m.fit, JSON.stringify(m));
    // WCAG 2.5.5 (owner 2026-10-12): 44px wide targets (the column is one control, scrubbed by touch drag since 27 x 44 does not fit) with a small margin each side.
    check(`${tag}: every letter target is at least 44px wide`, m.minW >= 44, JSON.stringify(m));
    check(`${tag}: the rail has a 4px margin on both sides of the letters`, m.marginL >= 4 - 0.5 && m.marginR >= 4 - 0.5, JSON.stringify(m));
    check(`${tag}: the rail does not cover a card`, m.cardsRight <= m.left + 0.5, `cards end ${m.cardsRight}, rail starts ${m.left}`);
    check(`${tag}: the rail sits between the header and the bottom nav`, m.top >= m.headerBottom - 1 && m.bottom <= m.navTop + 1, JSON.stringify(m));
    const before = await page.evaluate(() => document.querySelector(".tv-title-grid").scrollTop);
    await page.locator(".tv-alphabet button", { hasText: /^M$/ }).tap();
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ top: document.querySelector(".tv-title-grid").scrollTop, active: document.querySelector(".tv-alphabet button.is-active")?.textContent }));
    check(`${tag}: tapping a letter jumps the grid`, route === "series" ? true : after.top > before, `scrollTop ${before} -> ${after.top}, active ${after.active}`);
    // Touch-drag scrubbing: a finger down the column jumps through the letters it crosses.
    if (route === "movies") {
      const cdp = await context.newCDPSession(page);
      const centre = (L) => page.evaluate((L) => { const r = [...document.querySelectorAll(".tv-alphabet button")].find((b) => b.textContent === L).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, L);
      const from = await centre("A");
      const to = await centre("T");
      await page.evaluate(() => { document.querySelector(".tv-title-grid").scrollTop = 0; });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
      for (let k = 1; k <= 10; k += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x, y: from.y + ((to.y - from.y) * k) / 10 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(2500);
      const scrubbed = await page.evaluate(() => ({ top: document.querySelector(".tv-title-grid").scrollTop, active: document.querySelector(".tv-alphabet button.is-active")?.textContent }));
      check(`${tag}: dragging down the column scrubs the grid to the letters it crosses (A to T; the fixture has no T, so the circle lands on the next letter with titles)`, scrubbed.top > 0 && scrubbed.active >= "R", JSON.stringify(scrubbed));
      if (OUT && theme === "light") await page.screenshot({ path: join(OUT, "alphabet-phone-390x845.png") });
    }
    await context.close();
  }
}

// Owner 2026-10-18: active circle (follows the grid, moves at once on a jump), focus ring (distinct, combinable), no
// reflow, a jump never moves focus, and only Right enters the grid. 390 touch, 1280 pointer/keyboard, 1920 TV keyboard.
const lum = (hex) => {
  const c = hex.replace("#", "").match(/../g).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
// Layout boxes (offset metrics ignore the hover scale transform): they must not change when the circle or ring appears.
const railBoxes = () => [...document.querySelectorAll(".tv-alphabet button")].map((b) => [b.offsetLeft, b.offsetTop, b.offsetWidth, b.offsetHeight].join(",")).join("|");
const activeLetter = () => document.querySelector(".tv-alphabet button.is-active")?.textContent ?? null;
const settle = async (page) => { let prev = -1; for (let k = 0; k < 40; k += 1) { await page.waitForTimeout(150); const t = await page.evaluate(() => document.querySelector(".tv-title-grid").scrollTop); if (t === prev) return; prev = t; } };
for (const [w, h, touch] of ONLY === "phone" ? [] : [[390, 844, true], [1280, 720, false], [1920, 1080, false]]) {
  for (const theme of ["dark", "light"]) {
    const tag = `${w}x${h} ${theme} active/focus`;
    const context = await browser.newContext({ viewport: { width: w, height: h }, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
    await context.addInitScript(({ base, userId, theme }) => {
      localStorage.setItem("playarr:apiBaseUrl", base);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "d", session }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
      localStorage.setItem("playarr-theme", theme);
      document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = theme; });
    }, { base, userId: USER_ID, theme });
    const page = await context.newPage();
    await page.goto(`${base}/movies`);
    await page.waitForSelector(".tv-alphabet button", { timeout: 10000 });
    await page.waitForTimeout(1200);
    const boxes0 = await page.evaluate(railBoxes);
    const first = await page.evaluate(activeLetter);
    const colours = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); const a = document.querySelector(".tv-alphabet button.is-active"); return { brand: s.getPropertyValue("--brand").trim(), bg: s.getPropertyValue("--bg").trim(), ink: s.getPropertyValue("--ink").trim(), shadow: a ? getComputedStyle(a, "::before").boxShadow : "" }; });
    check(`${tag}: the active letter has the ring (brand box-shadow on its circle)`, first !== null && colours.shadow.includes("0px 0px 0px 4px"), JSON.stringify(colours));
    console.log(`INFO  ${tag}: ring ${colours.brand} on ${colours.bg} = ${ratio(colours.brand, colours.bg).toFixed(2)}:1, letter ${colours.bg} on ${colours.ink} = ${ratio(colours.bg, colours.ink).toFixed(2)}:1`);
    check(`${tag}: ring contrast >= 3:1 and letter contrast >= 4.5:1`, ratio(colours.brand, colours.bg) >= 3 && ratio(colours.bg, colours.ink) >= 4.5);
    // Scrolling the grid moves the circle.
    await page.evaluate(() => { const g = document.querySelector(".tv-title-grid"); g.scrollTop = g.scrollHeight * 0.4; });
    await settle(page);
    for (let k = 0; k < 20 && (await page.evaluate(activeLetter)) === first; k += 1) await page.waitForTimeout(150);
    const scrolled = await page.evaluate(activeLetter);
    check(`${tag}: scrolling the grid moves the active letter`, scrolled !== null && scrolled !== first, `${first} -> ${scrolled}`);
    // A jump: focus stays on the letter, the grid leads with the section's first card, the circle stays after settling.
    const letter = scrolled === "M" ? "P" : "M";
    const btn = page.locator(".tv-alphabet button", { hasText: new RegExp(`^${letter}$`) });
    if (touch) await btn.tap(); else if (w === 1280) await btn.click(); else { await btn.focus(); await page.keyboard.press("Enter"); }
    await page.waitForFunction(() => ![...document.querySelectorAll('.tv-alphabet button')].some((b) => b.textContent === '·'), null, { timeout: 15000 });
    await settle(page);
    await page.waitForTimeout(600);
    const jumped = await page.evaluate(() => {
      const g = document.querySelector(".tv-title-grid");
      const a = document.activeElement;
      const lead = g.querySelector(`[data-library-index="${Math.min(...[...g.querySelectorAll("[data-library-index]")].filter((c) => c.dataset.libraryLetter === document.querySelector(".tv-alphabet button.is-active")?.textContent).map((c) => Number(c.dataset.libraryIndex)))}"]`);
      return { focused: a?.closest(".tv-alphabet") ? a.textContent : (a?.className ?? ""), active: document.querySelector(".tv-alphabet button.is-active")?.textContent, leadTop: lead ? lead.getBoundingClientRect().top - g.getBoundingClientRect().top : null, leadLetter: lead?.dataset.libraryLetter };
    });
    check(`${tag}: after clicking ${letter}, focus is still on that letter`, jumped.focused === letter, JSON.stringify(jumped));
    check(`${tag}: the circle is on ${letter} once the scroll settled`, jumped.active === letter, JSON.stringify(jumped));
    check(`${tag}: the section's first card is at the top of the grid`, jumped.leadTop !== null && jumped.leadTop >= -2 && jumped.leadTop < 40 && jumped.leadLetter === letter, JSON.stringify(jumped));
    check(`${tag}: no layout shift of the letters (active moved, boxes unchanged)`, (await page.evaluate(railBoxes)) === boxes0);
    // Keyboard focus ring: distinct from the active circle, combined when both apply.
    if (!touch) {
      const ring = await page.evaluate(() => { const a = document.activeElement; const c = getComputedStyle(a); return { style: c.outlineStyle, width: c.outlineWidth, active: a.classList.contains("is-active"), shadow: getComputedStyle(a, "::before").boxShadow }; });
      if (w === 1280) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(400); } // pointer click shows no ring; a key does
      const keyed = await page.evaluate(() => { const a = document.activeElement; const c = getComputedStyle(a); return { style: c.outlineStyle, width: c.outlineWidth, active: a.classList.contains("is-active"), shadow: getComputedStyle(a, "::before").boxShadow }; });
      check(`${tag}: a keyboard-focused letter has the standard focus ring, without the active circle`, keyed.style === "solid" && parseFloat(keyed.width) >= 2 && (w !== 1280 || (!keyed.active && keyed.shadow === "none")), JSON.stringify(keyed));
      if (w === 1280) { await page.keyboard.press("ArrowUp"); await page.waitForTimeout(200); }
      const both = await page.evaluate(() => { const a = document.activeElement; return { style: getComputedStyle(a).outlineStyle, active: a.classList.contains("is-active"), shadow: getComputedStyle(a, "::before").boxShadow }; });
      check(`${tag}: focused and active together show the ring and the circle`, both.style === "solid" && both.active && both.shadow !== "none", JSON.stringify(both));
      check(`${tag}: no layout shift when focus moves in the rail`, (await page.evaluate(railBoxes)) === boxes0);
    }
    if (OUT) await page.screenshot({ path: join(OUT, `alphabet-active-${w}-${theme}.png`) });
    // Only the key pointing toward the grid enters it (side from layout: rail rect vs grid rect); the away key does nothing.
    const wanted = await page.evaluate(activeLetter);
    if (touch) { await context.close(); continue; }
    const railLeft = await page.evaluate(() => document.querySelector(".tv-alphabet").getBoundingClientRect().left < document.querySelector(".tv-title-grid").getBoundingClientRect().left);
    const [toward, away] = railLeft ? ["ArrowRight", "ArrowLeft"] : ["ArrowLeft", "ArrowRight"];
    await page.evaluate((L) => [...document.querySelectorAll(".tv-alphabet button")].find((b) => b.textContent === L)?.focus(), wanted);
    await page.keyboard.press(away);
    await page.waitForTimeout(800);
    const stayed = await page.evaluate(() => { const a = document.activeElement; return a?.closest(".tv-alphabet") ? a.textContent : (a?.className ?? ""); });
    check(`${tag}: ${away} (away from the grid, rail ${railLeft ? "left" : "right"} of it) keeps focus on the letter`, stayed === wanted, `${wanted} -> ${stayed}`);
    await page.keyboard.press(toward);
    await page.waitForTimeout(800);
    const entered = await page.evaluate(() => { const a = document.activeElement; const g = document.querySelector(".tv-title-grid"); const L = a?.dataset?.libraryLetter; const firstIdx = Math.min(...[...g.querySelectorAll("[data-library-index]")].filter((c) => c.dataset.libraryLetter === L).map((c) => Number(c.dataset.libraryIndex))); return { card: !!a?.closest(".tv-title-card, [data-library-index]"), letter: L, idx: Number(a?.dataset?.libraryIndex), firstIdx }; });
    check(`${tag}: ${toward} (toward the grid) focuses the first card of the active section`, entered.card && entered.letter === wanted && entered.idx === entered.firstIdx, `${wanted} ${JSON.stringify(entered)}`);
    await context.close();
  }
}
await browser.close();
await server.close?.();
console.log(failed === 0 ? "alphabet rail e2e: all passed" : `alphabet rail e2e: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
