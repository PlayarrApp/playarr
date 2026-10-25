// Reads the vertical metrics (hhea ascender/descender, unitsPerEm) of every shipped font file into src/debug/fontMetrics.json, which the
// parity layout exporter uses for the content area of a text line (what a browser's text range covers). Run after changing assets/fonts.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const dir = new URL("../assets/fonts/", import.meta.url);
const out = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith(".ttf"))) {
  const b = readFileSync(new URL(file, dir));
  const n = b.readUInt16BE(4);
  const table = {};
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; table[b.toString("latin1", o, o + 4)] = b.readUInt32BE(o + 8); }
  const upm = b.readUInt16BE(table.head + 18);
  out[file.replace(".ttf", "")] = { ascender: b.readInt16BE(table.hhea + 4) / upm, descender: -b.readInt16BE(table.hhea + 6) / upm };
}
writeFileSync(new URL("../src/debug/fontMetrics.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(out);
