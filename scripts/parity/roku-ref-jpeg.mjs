#!/usr/bin/env node
// Roku web refs through the same JPEG round trip as the device (owner decision 2 Nov 2026).
// The Roku only screenshots as JPEG (IJG quality 75, 4:2:0, full range). The driver decodes it with
// ffmpeg to PNG (drivers/roku.mjs pngFromJpeg). This script gives every lossless web ref PNG the same
// treatment: ImageMagick/libjpeg encode with pinned settings, then the identical ffmpeg decode.
//   node roku-ref-jpeg.mjs --in <dir with PNGs> --out <dir> [--check]
// Re-run after every Roku web ref recapture, then install the result as the Roku row's refs.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ENCODE = ["-strip", "-quality", "75", "-sampling-factor", "2x2,1x1,1x1", "-interlace", "none", "-colorspace", "sRGB", "-define", "jpeg:dct-method=islow", "-define", "jpeg:optimize-coding=false", "jpeg:"];
const DECODE = ["-hide_banner", "-loglevel", "error", "-threads", "2", "-filter_threads", "2", "-i", "pipe:0", "-threads", "2", "-f", "image2pipe", "-vcodec", "png", "pipe:1"];
const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, maxBuffer: 256 << 20 });
  if (r.status !== 0 || !r.stdout?.length) throw new Error(`${cmd} failed: ${r.stderr}`);
  return r.stdout;
};
export const jpegEncode = (png) => run("magick", ["png:-", ...ENCODE], png);
export const jpegDecode = (jpeg) => run("ffmpeg", DECODE, jpeg);
export const roundTrip = (png) => jpegDecode(jpegEncode(png));

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const arg = (n) => { const i = a.indexOf(n); return i < 0 ? null : a[i + 1]; };
  const inDir = arg("--in"), outDir = arg("--out");
  if (!inDir || !outDir) throw new Error("--in and --out required");
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(inDir).filter((n) => n.endsWith(".png")).sort()) {
    const out = roundTrip(readFileSync(join(inDir, f)));
    writeFileSync(join(outDir, f), out);
    console.log("ok", f);
  }
}
