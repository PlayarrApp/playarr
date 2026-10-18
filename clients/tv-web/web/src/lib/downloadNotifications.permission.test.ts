import { afterEach, describe, expect, it, vi } from "vitest";
import { readNotificationPermission, requestNotificationPermission } from "./downloadNotifications";

function stubNotification(permission: NotificationPermission, next: NotificationPermission = permission) {
  vi.stubGlobal("window", { Notification: {} });
  vi.stubGlobal("Notification", { permission, requestPermission: vi.fn(async () => next) });
}

afterEach(() => vi.unstubAllGlobals());

describe("readNotificationPermission", () => {
  it.each(["granted", "default", "denied"] as const)("maps %s", (permission) => {
    stubNotification(permission);
    expect(readNotificationPermission()).toBe(permission);
  });

  it("reports unsupported, never blocked, without the Notification API", () => {
    vi.stubGlobal("window", {});
    expect(readNotificationPermission()).toBe("unsupported");
  });
});

describe("requestNotificationPermission", () => {
  it("shows the unblock hint when the browser still answers denied", async () => {
    stubNotification("denied");
    const onGranted = vi.fn();
    await expect(requestNotificationPermission(onGranted)).resolves.toEqual({ permission: "denied", showHint: true });
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(onGranted).not.toHaveBeenCalled();
  });

  it("continues the subscribe flow when permission becomes granted", async () => {
    stubNotification("denied", "granted");
    const onGranted = vi.fn();
    await expect(requestNotificationPermission(onGranted)).resolves.toEqual({ permission: "granted", showHint: false });
    expect(onGranted).toHaveBeenCalledTimes(1);
  });
});

describe("after a prompt", () => {
  it("reads as blocked at once when the user denies from the default state", async () => {
    stubNotification("default");
    const notification = Notification as unknown as { permission: NotificationPermission; requestPermission: () => Promise<NotificationPermission> };
    notification.requestPermission = vi.fn(async () => {
      notification.permission = "denied"; // the browser updates the live value when the prompt is denied
      return "denied" as const;
    });
    expect(readNotificationPermission()).toBe("default");
    await requestNotificationPermission(() => undefined);
    expect(readNotificationPermission()).toBe("denied");
  });
});
