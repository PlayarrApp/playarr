// Ref-only screens the suite does not run (web-refs.json extraScreens): the Calendar link drawer. Opens the calendar agenda and the
// link tile like a viewer with a pointer, then captures through the same driver path as the suite (PNG plus layout export).
//   XBOX_IO=... node xbox/extra-captures.mjs --theme dark|light --out <dir>   writes <dir>/<theme>/calendar-link.png
import { join } from "node:path";
import { createDriver } from "./driver.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const theme = arg("theme"), out = arg("out");
if (!["dark", "light"].includes(theme) || !out) throw new Error("usage: extra-captures.mjs --theme dark|light --out <dir>");
const driver = await createDriver();
await driver.start({ theme });
await driver.setTheme(theme);
await driver.home();
await driver.route("/calendar?view=agenda", { screenId: "calendar-agenda" });
await driver.clickAt(1877, 187, 6); // the Calendar link tile
await driver.screenshot(join(out, theme, "calendar-link.png"));
console.log(`ok ${theme} calendar-link`);
