import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { navigationOriginFromState } from "../lib/navigationLayer";
import { setScrollInstant } from "../lib/smoothScroll";

/** The native vertical viewport shared by every authenticated route. */
export function PageScrollRoot({
  scrollKey,
  routeMotion,
  children,
}: {
  scrollKey: string;
  /** Route transition token (see lib/routeMotion.ts); CSS animates the page body only. */
  routeMotion?: string;
  children: ReactNode;
}) {
  const { pathname, state } = useLocation();
  const navigationType = useNavigationType();
  const lastPath = useRef(pathname);
  // A new page starts at the top, before its first paint: the shared <main> and the page's own scrollers (grid, rails)
  // keep their offset across routes otherwise. Back/Forward and a Back that carries a saved origin restore instead
  // (lib/navigationLayer.ts, run by the page's own layout effect just before this one). Query-only changes keep the path.
  useLayoutEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (navigationType === "POP" || navigationOriginFromState(state)) return;
    const main = document.querySelector<HTMLElement>("main.app-main");
    const scrollers = main ? [main, ...main.querySelectorAll<HTMLElement>("[data-navigation-scroll-key]")] : [];
    for (const el of [document.documentElement, ...scrollers]) setScrollInstant(el, { top: 0, left: 0 });
  }, [pathname, navigationType, state]);
  return (
    <main
      className="app-main"
      data-tv-scroll-container
      data-tv-scroll-axis="vertical"
      data-fade="off"
      data-navigation-scroll-key={scrollKey}
      data-route-motion={routeMotion}
    >
      {children}
    </main>
  );
}
