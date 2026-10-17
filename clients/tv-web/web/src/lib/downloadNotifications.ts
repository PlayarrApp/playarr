import { useCallback, useEffect, useRef, useState } from "react";
import type { DownloadRecord } from "./downloadsDb";
import { aggregateDownloads, isFailed, isRunning } from "./downloadGroups";
import { formatBytes } from "./formatBytes";
import type { TranslationKey } from "./i18n/translations";

type TFunc = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** One notification tracks every download; a new state replaces the old one (same tag). */
export const DOWNLOAD_NOTIFICATION_TAG = "playarr-downloads";
export const DOWNLOAD_NOTIFICATION_OPT_IN_KEY = "playarr.downloadNotifications";
/** Message the service worker posts to the page when a notification button is pressed. */
export const DOWNLOAD_NOTIFICATION_ACTION_MESSAGE = "playarr-download-action";

export type DownloadNotificationAction = "pause" | "resume" | "cancel";

export interface DownloadNotificationContent {
  title: string;
  body: string;
  state: "progress" | "paused" | "done" | "failed";
  actions: DownloadNotificationAction[];
  /** 0 to 100 while a percentage is known. */
  percent: number | null;
}

function sizeLine(records: readonly DownloadRecord[], t: TFunc): string {
  const aggregate = aggregateDownloads(records);
  const total = aggregate.totalBytes !== null ? formatBytes(aggregate.totalBytes) : t("pages.downloads.unknownSize");
  const progress = t("pages.downloads.bytesOfTotal", { downloaded: formatBytes(aggregate.bytesDownloaded), total });
  return aggregate.percent !== null ? `${aggregate.percent}% · ${progress}` : progress;
}

/** The live notification for the downloads in flight (running or paused), or null when there are none. */
export function liveDownloadNotification(records: readonly DownloadRecord[], t: TFunc): DownloadNotificationContent | null {
  const live = records.filter((record) => isRunning(record) || record.status === "paused");
  if (live.length === 0) return null;
  const running = live.filter(isRunning);
  const aggregate = aggregateDownloads(live);
  const single = live.length === 1 ? (live[0] ?? null) : null;
  if (running.length > 0) {
    return {
      state: "progress",
      title: single
        ? t("lib.downloads.notification.downloadingOne", { title: single.title })
        : t("lib.downloads.notification.downloadingMany", { count: live.length }),
      body: sizeLine(live, t),
      actions: ["pause", "cancel"],
      percent: aggregate.percent,
    };
  }
  return {
    state: "paused",
    title: single
      ? t("lib.downloads.notification.pausedOne", { title: single.title })
      : t("lib.downloads.notification.pausedMany", { count: live.length }),
    body: sizeLine(live, t),
    actions: ["resume", "cancel"],
    percent: aggregate.percent,
  };
}

/** The one-off notification when downloads finish or fail and nothing else is still in flight. */
export function finishedDownloadNotification(
  previous: ReadonlyMap<string, DownloadRecord["status"]>,
  records: readonly DownloadRecord[],
  t: TFunc
): DownloadNotificationContent | null {
  if (records.some((record) => isRunning(record) || record.status === "paused")) return null;
  const done = records.filter((record) => record.status === "ready" && previous.has(record.id) && previous.get(record.id) !== "ready");
  const failed = records.filter((record) => isFailed(record) && previous.has(record.id) && previous.get(record.id) !== record.status && isRunningStatus(previous.get(record.id)));
  if (done.length === 0 && failed.length === 0) return null;
  if (failed.length > 0 && done.length === 0) {
    return {
      state: "failed",
      title: failed.length === 1 ? t("lib.downloads.notification.failedOne", { title: failed[0]?.title ?? "" }) : t("lib.downloads.notification.failedMany", { count: failed.length }),
      body: failed[0]?.errorMessage ?? "",
      actions: [],
      percent: null,
    };
  }
  return {
    state: "done",
    title: done.length === 1 ? t("lib.downloads.notification.doneOne", { title: done[0]?.title ?? "" }) : t("lib.downloads.notification.doneMany", { count: done.length }),
    body: formatBytes(aggregateDownloads(done).bytesDownloaded),
    actions: [],
    percent: 100,
  };
}

function isRunningStatus(status: DownloadRecord["status"] | undefined): boolean {
  return status === "queued" || status === "processing" || status === "downloading" || status === "paused";
}

export function downloadNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function readOptIn(): boolean {
  try {
    return window.localStorage.getItem(DOWNLOAD_NOTIFICATION_OPT_IN_KEY) === "on";
  } catch {
    return false;
  }
}

/** Permission as the UI sees it; "unsupported" means there is no Notification API, which is never shown as blocked. */
export function readNotificationPermission(): NotificationPermission | "unsupported" {
  return downloadNotificationsSupported() ? Notification.permission : "unsupported";
}

/**
 * Asks the browser once. Browsers usually resolve a blocked site to "denied" without a prompt, so a denied result
 * means the page must explain how to unblock; a granted result continues through `onGranted`.
 */
export async function requestNotificationPermission(onGranted: () => void): Promise<{ permission: NotificationPermission; showHint: boolean }> {
  const permission = await Notification.requestPermission();
  if (permission === "granted") onGranted();
  return { permission, showHint: permission === "denied" };
}

/** The live permission, following changes made in the browser's site settings while the page is open (where the Permissions API allows). */
export function useNotificationPermission() {
  const supported = downloadNotificationsSupported();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(readNotificationPermission);
  const [blockedHint, setBlockedHint] = useState(false);
  useEffect(() => {
    if (!supported || !navigator.permissions?.query) return;
    let status: PermissionStatus | undefined;
    let cancelled = false;
    const sync = () => {
      setPermission(readNotificationPermission());
      setBlockedHint(false);
    };
    navigator.permissions
      .query({ name: "notifications" })
      .then((result) => {
        if (cancelled) return;
        status = result;
        result.onchange = sync;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, [supported]);
  return { supported, permission, setPermission, blockedHint, setBlockedHint };
}

/** The opt-in: notifications show only once the user has agreed on this device and the browser has granted permission. */
export function useDownloadNotificationOptIn() {
  const { supported, permission, setPermission, blockedHint, setBlockedHint } = useNotificationPermission();
  const [optedIn, setOptedIn] = useState(() => (supported ? readOptIn() : false));
  const enable = useCallback(async () => {
    if (!supported) return;
    const { permission: result, showHint } = await requestNotificationPermission(() => {
      try {
        window.localStorage.setItem(DOWNLOAD_NOTIFICATION_OPT_IN_KEY, "on");
      } catch {
        // Storage blocked: the opt-in lasts for this tab only.
      }
      setOptedIn(true);
    });
    setPermission(result);
    setBlockedHint(showHint);
  }, [supported]);
  const disable = useCallback(() => {
    try {
      window.localStorage.removeItem(DOWNLOAD_NOTIFICATION_OPT_IN_KEY);
    } catch {
      // Same.
    }
    setOptedIn(false);
  }, []);
  return { supported, permission, blockedHint, enabled: supported && optedIn && permission === "granted", enable, disable };
}

async function show(content: DownloadNotificationContent, t: TFunc, labelFor: (action: DownloadNotificationAction) => string): Promise<void> {
  const options: NotificationOptions & { actions?: Array<{ action: string; title: string }>; renotify?: boolean } = {
    body: content.body,
    tag: DOWNLOAD_NOTIFICATION_TAG,
    icon: "/playarr-icon-192.png",
    badge: "/playarr-icon-192.png",
    silent: true,
    data: { link: "/downloads", state: content.state, percent: content.percent },
  };
  void t;
  const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration().catch(() => undefined) : undefined;
  if (registration) {
    options.actions = content.actions.map((action) => ({ action, title: labelFor(action) }));
    await registration.showNotification(content.title, options);
    return;
  }
  // No service worker (so no action buttons): a plain notification still tracks the status.
  new Notification(content.title, options);
}

/**
 * Keeps one system notification in step with the downloads (progress, paused, done, failed), with Pause, Resume and
 * Cancel buttons where the browser supports notification actions. Does nothing until the user has opted in.
 */
export function useDownloadNotifications(
  records: readonly DownloadRecord[],
  enabled: boolean,
  t: TFunc,
  handlers: { pauseAll: () => void; resumeAll: () => void; cancelAll: () => void }
): void {
  const previousRef = useRef(new Map<string, DownloadRecord["status"]>());
  const lastShownRef = useRef<string>("");
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) {
      previousRef.current = new Map(records.map((record) => [record.id, record.status]));
      return;
    }
    const live = liveDownloadNotification(records, t);
    const finished = live ? null : finishedDownloadNotification(previousRef.current, records, t);
    previousRef.current = new Map(records.map((record) => [record.id, record.status]));
    const content = live ?? finished;
    if (!content) {
      lastShownRef.current = "";
      return;
    }
    // One update per visible change: the percentage rounds to a whole number, so the text is stable between ticks.
    const signature = `${content.state}|${content.title}|${content.body}`;
    if (signature === lastShownRef.current) return;
    lastShownRef.current = signature;
    const labelFor = (action: DownloadNotificationAction) =>
      action === "pause" ? t("pages.downloads.pause") : action === "resume" ? t("pages.downloads.resume") : t("pages.downloads.cancel");
    void show(content, t, labelFor).catch(() => undefined);
  }, [enabled, records, t]);

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; action?: string } | null;
      if (data?.type !== DOWNLOAD_NOTIFICATION_ACTION_MESSAGE) return;
      if (data.action === "pause") handlersRef.current.pauseAll();
      else if (data.action === "resume") handlersRef.current.resumeAll();
      else if (data.action === "cancel") handlersRef.current.cancelAll();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [enabled]);
}
