// Builds the server-hosted web client (--mode server, base /tv/) with a packaged-TV platform define, for the web refs of that platform.
//   node build-platform-web.mjs --platform tv-webos|tv-tizen --out <dir> [--web-dir <clients/tv-web/web>]
// The packaged builds (apps/tv-webos, apps/tv-tizen) define __PLAYARR_PLATFORM__ and import this same web client; the hosted build
// defines it as null. This build changes only that define, so the platform-specific web behaviour (hash routing, system volume,
// stage scale, no Clients/update links) shows exactly as the web renders it there. No repo file is modified.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const platform = opt("platform"), out = opt("out") && resolve(opt("out"));
if (!["tv-webos", "tv-tizen"].includes(platform) || !out) { console.error("usage: build-platform-web.mjs --platform tv-webos|tv-tizen --out <dir> [--web-dir <dir>]"); process.exit(2); }
const webDir = resolve(opt("web-dir") ?? join(dirname(fileURLToPath(import.meta.url)), "../../clients/tv-web/web"));
mkdirSync(out, { recursive: true });
const config = join(webDir, "node_modules", `.vite-${platform}.config.mjs`); // inside node_modules so "vite" resolves; git-ignored, removed below
writeFileSync(config, `import { mergeConfig } from "vite";
import base from ${JSON.stringify(join(webDir, "vite.config.ts"))};
export default (env) => mergeConfig(base(env), {
  root: ${JSON.stringify(webDir)},
  define: { __PLAYARR_PLATFORM__: JSON.stringify(${JSON.stringify(platform)}) },
  build: { outDir: ${JSON.stringify(out)}, emptyOutDir: true },
});
`);
try { execFileSync("pnpm", ["exec", "vite", "build", "--mode", "server", "--config", config], { cwd: webDir, stdio: "inherit" }); } finally { rmSync(config, { force: true }); }
// same post-step as build:server: the PWA manifest starts and scopes at /tv/
execFileSync("node", ["-e", `const f=require("fs"),p=${JSON.stringify(join(out, "playarr.webmanifest"))},m=JSON.parse(f.readFileSync(p,"utf8"));m.start_url="/tv/";m.scope="/tv/";m.icons=m.icons.map(i=>({...i,src:i.src.replace(/^\\//,"/tv/")}));f.writeFileSync(p,JSON.stringify(m,null,2)+"\\n")`]);
console.log(`built ${platform} -> ${out}`);
