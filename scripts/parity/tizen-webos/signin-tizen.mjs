// Signs the Tizen emulator's debug build in to the static parity server as `parity` through the netlog eval channel.
// PARITY_NETLOG=<dir with log.txt> (the logserver.py sink). The password comes from ~/.secrets and is never printed.
import { readFileSync, writeFileSync } from "node:fs";
import { loadParityConfig } from "../parity-config.mjs";
const sec = readFileSync(process.env.HOME + "/.secrets", "utf8");
const get = (k) => (sec.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").replace(/^['"]|['"]$/g, "");
const url = loadParityConfig().PARITY_SERVER_URL, pw = process.env.PLAYARR_PARITY_STATIC_PASSWORD ?? get("PLAYARR_PARITY_STATIC_PASSWORD");
if (!url || !pw) throw new Error("static parity server URL or password is not configured");
const NETLOG = process.env.PARITY_NETLOG ?? "";
if (!NETLOG) throw new Error("set PARITY_NETLOG");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
async function ev(expr) {
  const id = `s${Date.now()}${n++}`;
  writeFileSync(`${NETLOG}/cmd.txt`, `eval:${id}:${expr.replace(/\n/g, " ")}`);
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    const hit = readFileSync(`${NETLOG}/log.txt`, "utf8").split("\n").reverse().find((l) => l.includes(`"id":"${id}"`));
    if (hit) { const o = JSON.parse(hit.slice(hit.indexOf("{"))); if (o.error) throw new Error(o.error); return o.value; }
  }
  return undefined;
}
await ev(`(localStorage.clear(), sessionStorage.clear(), localStorage.setItem("playarr:apiBaseUrl", ${JSON.stringify(url)}), setTimeout(() => location.reload(), 50), true)`);
await sleep(12000);
await ev(`[...document.querySelectorAll("button,a")].find((b) => /sign in manually/i.test(b.textContent))?.click()`);
await sleep(3000);
const set = (name, v) => `(() => { const i = document.querySelector('input[name="${name}"]'); if (!i) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`;
console.log("fields", await ev(set("username", "parity")), await ev(set("password", pw)));
await ev(`(document.querySelector('button[type="submit"]') ?? document.querySelector("form button"))?.click()`);
await sleep(10000);
console.log(await ev(`JSON.stringify({ h: location.hash, t: document.body.innerText.slice(0, 120) })`));
