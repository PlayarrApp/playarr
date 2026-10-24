#!/usr/bin/env node
// DOM dump (rect, font, colour per visible element) of the web ref at an Android viewport, through the shared web driver.
//   eval "$(node ../parity-config.mjs --shell)"; PLAYARR_USERNAME=parity PLAYARR_PASSWORD=... PARITY_CLIENT=... PARITY_LOCK_DIR=...
//   domdump.mjs <phone|tablet> <light|dark> <route> <out.json> [scrollSelector]
// phone: 390x845 at 1.8436 (719x1558); tablet: 1280x800 at 2 (2560x1600). Needs PARITY_CHROME and the driver's env.
import { writeFileSync } from "node:fs";
const [dev, theme, route, out] = process.argv.slice(2);
Object.assign(process.env, dev === "phone"
  ? { PLAYARR_WEB_MOBILE: "1", PLAYARR_WEB_VIEWPORT_WIDTH: "390", PLAYARR_WEB_VIEWPORT_HEIGHT: "845", PLAYARR_WEB_VIEWPORT_DPR: "1.8436" }
  : { PLAYARR_WEB_VIEWPORT_WIDTH: "1280", PLAYARR_WEB_VIEWPORT_HEIGHT: "800", PLAYARR_WEB_VIEWPORT_DPR: "2" });
const { createDriver } = await import("../drivers/web.mjs");
const d = await createDriver();
await d.start(); await d.setTheme(theme); await d.route(route);
await d.page.waitForTimeout(1500);
const dom = await d.page.evaluate(() => [...document.querySelectorAll("body *")].flatMap((el) => {
  const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) return [];
  const cs = getComputedStyle(el); const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").slice(0, 60);
  const painted = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.borderTopWidth !== "0px" || cs.backgroundImage !== "none" || cs.boxShadow !== "none";
  if (!own && !painted && !["IMG", "svg"].includes(el.tagName)) return [];
  const f = (n) => Math.round(n * 100) / 100;
  return [{ tag: el.tagName.toLowerCase(), cls: String(el.getAttribute("class") ?? "").slice(0, 70), text: own, x: f(r.x), y: f(r.y), w: f(r.width), h: f(r.height),
    font: own ? `${cs.fontSize}/${cs.fontWeight}/${cs.letterSpacing}/${cs.lineHeight}` : undefined, color: own ? cs.color : undefined,
    bg: cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor : undefined, radius: cs.borderTopLeftRadius !== "0px" ? cs.borderTopLeftRadius : undefined,
    shadow: cs.boxShadow !== "none" ? cs.boxShadow.slice(0, 80) : undefined, opacity: cs.opacity !== "1" ? cs.opacity : undefined }];
}));
writeFileSync(out, JSON.stringify(dom, null, 0).replaceAll("},{", "},\n{"));
await d.stop();
