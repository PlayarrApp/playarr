// Exit 0 when the Tizen debug build answers on the netlog channel with exactly one parity session on the static server.
import { readFileSync, writeFileSync } from "node:fs";
import { loadParityConfig } from "../parity-config.mjs";
const NETLOG = process.env.PARITY_NETLOG ?? "";
const url = loadParityConfig().PARITY_SERVER_URL;
const id = `v${Date.now()}`;
writeFileSync(`${NETLOG}/cmd.txt`, `eval:${id}:JSON.stringify({ u: localStorage.getItem("playarr:apiBaseUrl"), s: !!localStorage.getItem("playarr:session"), r: location.hash })`);
for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, 500));
  const hit = readFileSync(`${NETLOG}/log.txt`, "utf8").split("\n").reverse().find((l) => l.includes(`"id":"${id}"`));
  if (hit) { const v = JSON.parse(JSON.parse(hit.slice(hit.indexOf("{"))).value ?? "null"); process.exit(v?.s && v.u?.replace(/\/$/, "") === url ? 0 : 1); }
}
process.exit(1);
