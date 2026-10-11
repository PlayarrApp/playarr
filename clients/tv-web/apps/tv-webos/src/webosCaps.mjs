/**
 * What the webOS shell adds to the shared media-capability detection (web/src/lib/deviceMediaCaps.ts).
 * Chromium 94 (webOS 23) has no `(dynamic-range: high)` media query, so the shared code would see an SDR
 * display on every HDR TV. The TV's own configuration answers it; everything else stays the shared probes.
 */

/**
 * Asks the webOS configuration service whether the panel does HDR10 and Dolby Vision.
 * Resolves null when the bridge or the answer is missing (simulator, older firmware): the shared probes then stand.
 *
 * @param {Window} appWindow
 * @param {number} timeoutMs
 * @returns {Promise<{ hdr10: boolean, dolbyVision: boolean } | null>}
 */
export function queryWebOsHdr(appWindow, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const Bridge = /** @type {{ PalmServiceBridge?: new () => { call: (uri: string, payload: string) => void, onservicecallback?: (message: string) => void } }} */ (appWindow)
      .PalmServiceBridge;
    if (!Bridge) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      const bridge = new Bridge();
      bridge.onservicecallback = (message) => {
        clearTimeout(timer);
        try {
          const configs = JSON.parse(message)?.configs;
          if (!configs || typeof configs !== "object") return resolve(null);
          resolve({
            hdr10: configs["tv.model.supportHDR"] === true,
            dolbyVision: configs["tv.model.supportDolbyHDRContents"] === true,
          });
        } catch {
          resolve(null);
        }
      };
      bridge.call(
        "luna://com.webos.service.config/getConfigs",
        JSON.stringify({ configNames: ["tv.model.supportHDR", "tv.model.supportDolbyHDRContents"] })
      );
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * Makes `matchMedia("(dynamic-range: high)")` answer from the TV when the engine cannot.
 *
 * @param {Window} appWindow
 * @param {{ hdr10: boolean, dolbyVision: boolean } | null} hdr
 */
export function installWebOsDynamicRange(appWindow, hdr) {
  if (!hdr || typeof appWindow.matchMedia !== "function") return;
  const real = appWindow.matchMedia.bind(appWindow);
  const high = hdr.hdr10 || hdr.dolbyVision;
  appWindow.matchMedia = (query) => {
    const list = real(query);
    if (!/dynamic-range\s*:\s*high/.test(String(query)) || list.media !== "not all") return list;
    // The engine does not know the feature ("not all"): answer for it.
    return new Proxy(list, {
      get: (target, prop) => (prop === "matches" ? high : Reflect.get(target, prop) instanceof Function ? Reflect.get(target, prop).bind(target) : Reflect.get(target, prop)),
    });
  };
}
