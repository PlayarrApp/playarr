// Native-only D-pad check for the header back arrow (web: the back link/button is reachable by the D-pad).
// For each page: Up from the start focus enters the arrow (focused label "back"), Down (or Right, in the calendar header row) leaves it, Up + Select goes back (route changes to /).
//   node tizen-native/back-dpad.mjs <out.json>   (same environment as run.sh)
import { writeFileSync } from "node:fs";
import { createDriver } from "../drivers/tizen-native.mjs";

const pages = ["/movies", "/series", "/music", "/calendar", "/calendar?view=month", "/calendar?view=week", "/search", "/downloads", "/playlists"];
const driver = await createDriver();
await driver.start?.({ theme: "dark" });
// Up enters the arrow from the content; the calendar header sits in one row with its pills, so Left walks there
async function reachBack() {
  for (const k of ["up", "up", "left", "left", "left", "left"]) { if ((await driver.focused())?.label === "back") return true; await driver.key(k); }
  return (await driver.focused())?.label === "back";
}
const results = [];
for (const page of pages) {
  const r = { id: `back-${page}`, pass: false };
  try {
    await driver.home();
    await driver.route(page);
    r.entered = await reachBack();
    await driver.key(page.startsWith("/calendar") ? "right" : "down");
    r.left = page === "/downloads" || (await driver.focused())?.label !== "back"; // an empty downloads list has nothing below the arrow
    await reachBack();
    await driver.key("select");
    r.route = await driver.location();
    r.pass = r.entered && r.left && r.route === "/";
  } catch (e) { r.error = String(e.message ?? e); }
  results.push(r);
  console.log(r.pass ? "ok" : "FAIL", r.id, JSON.stringify(r));
}
writeFileSync(process.argv[2] ?? "back-dpad.json", JSON.stringify({ checked_at: new Date().toISOString(), results }, null, 2));
await driver.stop?.();
process.exitCode = results.every((r) => r.pass) ? 0 : 1;
