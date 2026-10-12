import {
  installWebOsLifecycle,
  loadWebOsRuntimeConfig,
} from "./webosLifecycle.mjs";
import { installWebOsDownloadToasts } from "./webosNotifications.mjs";
import { installWebOsDynamicRange, queryWebOsHdr } from "./webosCaps.mjs";
import { installLegacyHas } from "../../../tooling/legacy-has.mjs";

document.documentElement.dataset.platform = "tv-webos";
installWebOsLifecycle();
// Chromium 94 (webOS 23) has no :has(); the build rewrites those rules for this runtime.
installLegacyHas();

async function startPlayarr(): Promise<void> {
  await loadWebOsRuntimeConfig(`${import.meta.env.BASE_URL}playarr-config.json`);
  // Before the shared media-capability detection runs: the engine cannot answer (dynamic-range: high).
  installWebOsDynamicRange(window, await queryWebOsHdr(window));
  // Download notifications reach the TV as system toasts.
  installWebOsDownloadToasts(window);

  // Import the real Playarr application after platform lifecycle and runtime
  // config are in place. This is the same routed profiles/home/search/library/
  // playlists/settings/player client shipped at playarr.app, not ui-tv.
  await import("../../../web/src/main");
}

void startPlayarr().catch((error: unknown) => {
  console.error("Playarr failed to start", error);
  const root = document.getElementById("root");
  if (root) {
    root.textContent = "Playarr could not start. Reinstall the app or inspect it with ares-inspect.";
    root.style.padding = "3rem";
    root.style.boxSizing = "border-box";
    root.style.color = "white";
    root.style.fontFamily = "sans-serif";
    root.style.fontSize = "2rem";
  }
});
