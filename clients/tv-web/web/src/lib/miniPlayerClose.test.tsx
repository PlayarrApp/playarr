import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MiniPlayerCloseButton } from "../components/player/PlayerSurface";
import { LanguageProvider } from "./i18n/LanguageProvider";
import {
  closeMiniPlayer,
  rememberFocusBeforeMiniPlayer,
  type FocusRoot,
  type FocusTarget,
} from "./miniPlayerClose";

function target(options: { inPlayer?: boolean; connected?: boolean } = {}) {
  const focused: string[] = [];
  const element: FocusTarget & { focused: string[] } = {
    isConnected: options.connected ?? true,
    closest: () => (options.inPlayer ? {} : null),
    focus: () => focused.push("focus"),
    focused,
  };
  return element;
}

function root(map: Record<string, FocusTarget | null>): FocusRoot {
  return { querySelector: (selector) => (map[selector] ?? null) };
}

const runNow = (run: () => void) => run();

describe("mini player close button", () => {
  it("is present with the Close player label and the circle-x icon", () => {
    const markup = renderToStaticMarkup(
      <LanguageProvider>
        <MiniPlayerCloseButton onStop={() => undefined} />
      </LanguageProvider>
    );
    expect(markup).toContain('aria-label="Close player"');
    expect(markup).toContain('class="mini-player-close"');
    expect(markup).toContain("<svg");
  });

  it("is rendered by the mini player and wired to the existing stop path", () => {
    const surface = readFileSync("src/components/player/PlayerSurface.tsx", "utf8");
    const page = readFileSync("src/pages/Player.tsx", "utf8");
    expect(surface).toContain("<MiniPlayerCloseButton onStop={onStop} />");
    expect(page).toContain("onStop={onClose}");
    expect(page).toContain("<MiniPlayerCloseButton onStop={onStop} />");
  });
});

describe("closeMiniPlayer", () => {
  it("calls the stop path, then returns focus to the element focused before", () => {
    const previous = target();
    rememberFocusBeforeMiniPlayer(previous);
    const order: string[] = [];
    const fallback = target();
    closeMiniPlayer(
      () => order.push("stop"),
      root({ "[data-tv-focus-default]": fallback }),
      (run) => {
        order.push("scheduled");
        run();
      }
    );
    expect(order).toEqual(["stop", "scheduled"]);
    expect(previous.focused).toHaveLength(1);
    expect(fallback.focused).toHaveLength(0);
  });

  it("ignores focus that was inside the player", () => {
    const inside = target({ inPlayer: true });
    const fallback = target();
    rememberFocusBeforeMiniPlayer(inside);
    closeMiniPlayer(() => undefined, root({ "[data-tv-focus-default]": fallback }), runNow);
    expect(inside.focused).toHaveLength(0);
    expect(fallback.focused).toHaveLength(1);
  });

  it("falls back to the page default focus when the previous element is gone", () => {
    const gone = target({ connected: false });
    const fallback = target();
    rememberFocusBeforeMiniPlayer(gone);
    closeMiniPlayer(() => undefined, root({ "[data-tv-focus-default]": fallback }), runNow);
    expect(gone.focused).toHaveLength(0);
    expect(fallback.focused).toHaveLength(1);
  });

  it("falls back to the first page control, never leaving focus lost", () => {
    const first = target();
    closeMiniPlayer(
      () => undefined,
      root({ ".app-main :is(a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1']))": first }),
      runNow
    );
    expect(first.focused).toHaveLength(1);
  });
});
