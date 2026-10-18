import { setScrollInstant } from "./smoothScroll";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useLocation } from "react-router-dom";

const SNAPSHOT_PREFIX = "playarr.navigationLayer.";
const SNAPSHOT_INDEX_KEY = `${SNAPSHOT_PREFIX}index`;
const MAX_SNAPSHOTS = 32;

export interface NavigationOrigin {
  route: string;
  entryKey: string;
}

interface ScrollPosition {
  top: number;
  left: number;
}

interface NavigationSnapshot {
  route: string;
  focusKey: string | null;
  scroll: Record<string, ScrollPosition>;
  capturedAt: number;
}

export function navigationOriginFromState(state: unknown): NavigationOrigin | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as { navigationOrigin?: unknown }).navigationOrigin;
  if (!candidate || typeof candidate !== "object") return null;
  const route = (candidate as { route?: unknown }).route;
  const entryKey = (candidate as { entryKey?: unknown }).entryKey;
  return typeof route === "string" && typeof entryKey === "string"
    ? { route, entryKey }
    : null;
}

function storageKey(entryKey: string): string {
  return `${SNAPSHOT_PREFIX}${entryKey}`;
}

function readSnapshot(entryKey: string): NavigationSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(entryKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NavigationSnapshot;
    return parsed &&
      typeof parsed === "object" &&
      typeof parsed.route === "string" &&
      typeof parsed.scroll === "object"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function persistSnapshot(entryKey: string, snapshot: NavigationSnapshot): void {
  try {
    window.sessionStorage.setItem(storageKey(entryKey), JSON.stringify(snapshot));
    const previous = JSON.parse(
      window.sessionStorage.getItem(SNAPSHOT_INDEX_KEY) ?? "[]"
    ) as unknown;
    const keys = Array.isArray(previous)
      ? previous.filter((key): key is string => typeof key === "string")
      : [];
    const next = [entryKey, ...keys.filter((key) => key !== entryKey)];
    for (const staleKey of next.slice(MAX_SNAPSHOTS)) {
      window.sessionStorage.removeItem(storageKey(staleKey));
    }
    window.sessionStorage.setItem(
      SNAPSHOT_INDEX_KEY,
      JSON.stringify(next.slice(0, MAX_SNAPSHOTS))
    );
  } catch {
    // Navigation still works when storage is disabled; only restoration is lost.
  }
}

function removeSnapshot(entryKey: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(entryKey));
  } catch {
    // Storage may be disabled; local hook state still prevents another attempt.
  }
}

function navigationFocusKey(target?: HTMLElement | null): string | null {
  const candidate =
    target?.closest<HTMLElement>("[data-navigation-focus-key]") ??
    (document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>("[data-navigation-focus-key]")
      : null);
  return candidate?.dataset.navigationFocusKey ?? null;
}

export function captureNavigationLayer(
  route: string,
  entryKey: string,
  target?: HTMLElement | null
): NavigationOrigin {
  const scroll: Record<string, ScrollPosition> = {};
  for (const container of document.querySelectorAll<HTMLElement>(
    "[data-navigation-scroll-key]"
  )) {
    const key = container.dataset.navigationScrollKey;
    if (!key) continue;
    scroll[key] = {
      top: container.scrollTop,
      left: container.scrollLeft,
    };
  }
  persistSnapshot(entryKey, {
    route,
    focusKey: navigationFocusKey(target),
    scroll,
    capturedAt: Date.now(),
  });
  return { route, entryKey };
}

let restoringNavigationLayer = false;
const NAVIGATION_RESTORE_SETTLE_MS = 700;
const NAVIGATION_RESTORE_INTERRUPTION_EVENTS = [
  "keydown",
  "pointerdown",
  "touchstart",
  "wheel",
] as const;

export function isNavigationLayerRestoring(): boolean {
  return restoringNavigationLayer;
}

export function maintainNavigationScrollRestore(
  applyScroll: () => void,
  focusTarget: HTMLElement | null,
  settleMs = NAVIGATION_RESTORE_SETTLE_MS
): () => void {
  let animationFrame = 0;
  let startedAt: number | null = null;
  let cancelled = false;

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    window.cancelAnimationFrame(animationFrame);
    for (const eventName of NAVIGATION_RESTORE_INTERRUPTION_EVENTS) {
      window.removeEventListener(eventName, cancel, true);
    }
  };

  const reapply = (timestamp: number) => {
    if (cancelled) return;
    if (focusTarget && document.activeElement !== focusTarget) {
      cancel();
      return;
    }
    applyScroll();
    startedAt ??= timestamp;
    if (timestamp - startedAt >= settleMs) {
      cancel();
      return;
    }
    animationFrame = window.requestAnimationFrame(reapply);
  };

  for (const eventName of NAVIGATION_RESTORE_INTERRUPTION_EVENTS) {
    window.addEventListener(eventName, cancel, true);
  }
  animationFrame = window.requestAnimationFrame(reapply);
  return cancel;
}

function restoreSnapshot(snapshot: NavigationSnapshot): (() => void) | false {
  const focusTarget = snapshot.focusKey
    ? document.querySelector<HTMLElement>(
        `[data-navigation-focus-key="${CSS.escape(snapshot.focusKey)}"]`
      )
    : null;
  if (snapshot.focusKey && !focusTarget) return false;
  // A saved scroll offset needs its scroller on screen: while the page still shows a skeleton there is nothing to restore
  // into, and reporting success would spend the one restore (the 700 ms settle) before the list exists.
  // The page-level scroller (`page:/route`) is always mounted, so it alone must not count as "the scroller is on screen":
  // every scroller saved away from the top has to be present, or a slow-mounting grid is skipped and the restore spent.
  const scrollKeys = Object.keys(snapshot.scroll);
  const present = (key: string) => document.querySelector(`[data-navigation-scroll-key="${CSS.escape(key)}"]`) !== null;
  const moved = scrollKeys.filter((key) => (snapshot.scroll[key]?.top ?? 0) > 0 || (snapshot.scroll[key]?.left ?? 0) > 0);
  if (moved.length > 0 ? !moved.every(present) : scrollKeys.length > 0 && !scrollKeys.some(present)) return false;

  const applyScroll = () => {
    for (const [key, position] of Object.entries(snapshot.scroll)) {
      const container = document.querySelector<HTMLElement>(
        `[data-navigation-scroll-key="${CSS.escape(key)}"]`
      );
      if (!container) continue;
      setScrollInstant(container, { top: position.top, left: position.left });
    }
  };

  applyScroll();
  if (focusTarget) {
    restoringNavigationLayer = true;
    focusTarget.focus({ preventScroll: true });
    restoringNavigationLayer = false;
  }
  // Focus handlers and WebView spatial navigation can queue smooth centring
  // after focus() returns. Keep the captured position stable through that
  // settling window, but stop immediately when the viewer interacts.
  return maintainNavigationScrollRestore(applyScroll, focusTarget);
}

export function useNavigationLayer(
  restoreKey: string,
  discardMissingWhenReady = false,
  restoreEnabled = true
) {
  const location = useLocation();
  const restoredEntryRef = useRef<string | null>(null);
  const [ignoredEntryKey, setIgnoredEntryKey] = useState<string | null>(null);
  const snapshot = useMemo(
    () => readSnapshot(location.key),
    [location.key, restoreKey]
  );
  const hasSnapshot =
    snapshot?.route === location.pathname && ignoredEntryKey !== location.key;
  const origin = useMemo<NavigationOrigin>(
    () => ({ route: location.pathname, entryKey: location.key }),
    [location.key, location.pathname]
  );

  const capture = useCallback(
    (target?: HTMLElement | null) =>
      captureNavigationLayer(location.pathname, location.key, target),
    [location.key, location.pathname]
  );
  const captureLink = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      capture(event.currentTarget);
    },
    [capture]
  );

  // The saved focus and scroll are applied in the commit that mounts their target, before the frame is painted: the
  // two animation frames the effect below waits would paint the top of the page (and its default focus) first, a
  // visible jump when Back returns to a title far down a list. The effect below stays as the retry for targets that
  // mount later (more rows, data arriving). Runs every commit while a restore is pending and costs one lookup.
  // Leaving by any route (a nav tab, a link that captured nothing) still saves where each scroller was, so Back returns
  // to the same offset. A card click already captured focus and scroll a moment ago; that richer snapshot is kept.
  useEffect(() => {
    const entryKey = location.key;
    const route = location.pathname;
    // Seeded from the entry's saved offsets: the restore on Back scrolls before this listener is attached, so a scroller
    // that only the restore moved would otherwise be missing here and be saved as the top on the next departure.
    const positions: Record<string, ScrollPosition> = { ...readSnapshot(entryKey)?.scroll };
    const onScroll = (event: Event) => {
      const element = event.target;
      if (!(element instanceof HTMLElement)) return;
      const key = element.dataset.navigationScrollKey;
      if (key) positions[key] = { top: element.scrollTop, left: element.scrollLeft };
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      if (Object.keys(positions).length === 0) return;
      const existing = readSnapshot(entryKey);
      if (existing && Date.now() - existing.capturedAt < 2000) return;
      persistSnapshot(entryKey, { route, focusKey: null, scroll: positions, capturedAt: Date.now() });
    };
  }, [location.key, location.pathname]);

  const earlyCancelRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (
      !restoreEnabled ||
      !hasSnapshot ||
      !snapshot ||
      !snapshot.focusKey ||
      restoredEntryRef.current === location.key
    ) {
      return;
    }
    const restoration = restoreSnapshot(snapshot);
    if (!restoration) return;
    restoredEntryRef.current = location.key;
    earlyCancelRef.current = restoration;
  });
  useEffect(
    () => () => {
      earlyCancelRef.current?.();
      earlyCancelRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (
      !restoreEnabled ||
      !hasSnapshot ||
      !snapshot ||
      restoredEntryRef.current === location.key
    ) {
      return;
    }
    let cancelled = false;
    let secondFrame = 0;
    let cancelRestore: (() => void) | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        const restoration = restoreSnapshot(snapshot);
        if (restoration) {
          cancelRestore = restoration;
          restoredEntryRef.current = location.key;
        } else if (discardMissingWhenReady) {
          removeSnapshot(location.key);
          setIgnoredEntryKey(location.key);
        }
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      cancelRestore?.();
    };
  }, [
    discardMissingWhenReady,
    hasSnapshot,
    location.key,
    restoreEnabled,
    restoreKey,
    snapshot,
  ]);

  return {
    capture,
    captureLink,
    hasSnapshot,
    focusKey: hasSnapshot ? snapshot?.focusKey ?? null : null,
    origin,
  };
}
