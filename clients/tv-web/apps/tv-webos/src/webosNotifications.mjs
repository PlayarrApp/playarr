/**
 * Download notifications on webOS. The web client raises them through the Notification API (and a service worker's
 * `showNotification`), which a TV never shows. This forwards each one to the TV's system toast
 * (`luna://com.webos.notification/createToast`), and reports the permission as granted so the opt-in works.
 * A toast per whole percent would flood the screen: progress shows at the start and at every 25%, while paused, done and
 * failed always show.
 */

const TOAST = "luna://com.webos.notification/createToast";

/** @param {any} appWindow */
export function installWebOsDownloadToasts(appWindow) {
  const Bridge = /** @type {{ PalmServiceBridge?: new () => { call: (uri: string, payload: string) => void } }} */ (appWindow)
    .PalmServiceBridge;
  if (!Bridge || typeof appWindow.Notification !== "function") return false;
  let lastState = "";
  let lastBucket = -1;
  const toast = (/** @type {string} */ title, /** @type {{ body?: string, data?: { state?: string, percent?: number | null } } | undefined} */ options) => {
    const state = options?.data?.state ?? "";
    const bucket = Math.floor((options?.data?.percent ?? 0) / 25);
    if (state === "progress" && lastState === "progress" && bucket === lastBucket) return;
    lastState = state;
    lastBucket = state === "progress" ? bucket : -1;
    try {
      new Bridge().call(TOAST, JSON.stringify({ message: options?.body ? `${title}: ${options.body}` : title }));
    } catch {
      // A toast must never affect the app.
    }
  };
  const Original = appWindow.Notification;
  /** @type {any} */
  const Wrapped = function (/** @type {string} */ title, /** @type {any} */ options) {
    toast(title, options);
    return new Original(title, options);
  };
  Wrapped.prototype = Original.prototype;
  Object.defineProperty(Wrapped, "permission", { get: () => "granted" });
  Wrapped.requestPermission = () => Promise.resolve("granted");
  appWindow.Notification = Wrapped;
  const registration = /** @type {any} */ (appWindow).ServiceWorkerRegistration?.prototype;
  if (registration?.showNotification) {
    const original = registration.showNotification;
    registration.showNotification = function (/** @type {string} */ title, /** @type {any} */ options) {
      toast(title, options);
      return original.call(this, title, options);
    };
  }
  return true;
}
