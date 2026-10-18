import { mergeConfig } from "vite";
import base from "./vite.config";

// Debug-only build for real-TV parity runs (scripts/parity/drivers/tizen-webos.mjs, TIZEN_REAL=1 with TIZEN_MIRROR): the packaged Tizen
// platform identity plus the web debug screen mirror, served by the local receiver. Never packaged into a WGT; run
// `pnpm exec vite build -c vite.config.debug-mirror.ts` in this directory.
export default mergeConfig(base, {
  base: "/",
  define: { __PLAYARR_DEBUG_MIRROR__: JSON.stringify(true) },
  build: { outDir: "dist-debug-mirror" },
});
