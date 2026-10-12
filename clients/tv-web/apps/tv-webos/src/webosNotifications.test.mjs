import assert from "node:assert/strict";
import test from "node:test";
import { installWebOsDownloadToasts } from "./webosNotifications.mjs";

function fakeWindow() {
  const calls = [];
  const w = {
    PalmServiceBridge: class { call(uri, payload) { calls.push([uri, JSON.parse(payload).message]); } },
    Notification: class { constructor(title, options) { this.title = title; this.options = options; } },
    ServiceWorkerRegistration: { prototype: { showNotification(title) { return Promise.resolve(title); } } },
  };
  return { w, calls };
}

test("notifications become system toasts and the permission reads as granted", async () => {
  const { w, calls } = fakeWindow();
  assert.equal(installWebOsDownloadToasts(w), true);
  assert.equal(w.Notification.permission, "granted");
  assert.equal(await w.Notification.requestPermission(), "granted");
  new w.Notification("Downloading", { body: "10%", data: { state: "progress", percent: 10 } });
  assert.deepEqual(calls, [["luna://com.webos.notification/createToast", "Downloading: 10%"]]);
});

test("progress toasts show at the start and every 25 percent; other states always show", async () => {
  const { w, calls } = fakeWindow();
  installWebOsDownloadToasts(w);
  const reg = w.ServiceWorkerRegistration.prototype;
  for (const p of [1, 5, 20, 26, 40, 51, 99]) await reg.showNotification("D", { body: `${p}%`, data: { state: "progress", percent: p } });
  assert.deepEqual(calls.map((c) => c[1]), ["D: 1%", "D: 26%", "D: 51%", "D: 99%"]);
  await reg.showNotification("D", { body: "paused", data: { state: "paused", percent: 99 } });
  await reg.showNotification("D", { body: "done", data: { state: "done", percent: 100 } });
  assert.deepEqual(calls.slice(-2).map((c) => c[1]), ["D: paused", "D: done"]);
});

test("without the Luna bridge nothing is touched", () => {
  const w = { Notification: class {} };
  const before = w.Notification;
  assert.equal(installWebOsDownloadToasts(w), false);
  assert.equal(w.Notification, before);
});
