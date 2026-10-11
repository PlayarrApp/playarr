// VIDAA only. The TV's remote service delivers a long press of OK (the phone-remote KEY_OK_LONG_PRESS command) as an instant
// burst of repeat keydowns plus a keyup, a few milliseconds in all. Shared long-press code times the hold between a plain
// keydown and its keyup, so on VIDAA the hold never registers and the actions panel cannot be opened. This turns such a
// burst (repeat keydowns with no plain keydown just before them) into one plain keydown and a keyup after HOLD_MS. A held
// key that starts with a plain keydown, and every other key, passes through untouched.
export const VIDAA_HOLD_MS = 900;
// A real held key repeats about half a second after its first keydown; the remote service's burst repeats within a few ms.
const BURST_AFTER_PLAIN_MS = 150;
const PLAIN_DOWN_WINDOW_MS = 3000;

function isEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" || e.keyCode === 13;
}

export function installVidaaLongPress(win: Window = window, holdMs = VIDAA_HOLD_MS): () => void {
  let holding = false;
  let lastPlainDownAt = 0;
  let timer = 0;
  let own = false; // our synthetic events must not count as the plain keydown a real press starts with
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isEnter(e) || own) return;
    if (!e.repeat) {
      lastPlainDownAt = Date.now();
      return;
    }
    if (holding) {
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    const since = Date.now() - lastPlainDownAt;
    if (since >= BURST_AFTER_PLAIN_MS && since < PLAIN_DOWN_WINDOW_MS) return; // a real hold: repeats start later, after a plain keydown
    holding = true;
    e.stopImmediatePropagation();
    e.preventDefault();
    const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true } as KeyboardEventInit;
    const target = () => win.document.activeElement ?? win.document.body;
    own = true;
    target().dispatchEvent(new (win as Window & { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown", init));
    own = false;
    timer = win.setTimeout(() => {
      holding = false; // before the keyup, so our own keyup is not swallowed
      target().dispatchEvent(new (win as Window & { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keyup", init));
    }, holdMs);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (isEnter(e) && holding) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };
  win.addEventListener("keydown", onKeyDown, true);
  win.addEventListener("keyup", onKeyUp, true);
  return () => {
    win.removeEventListener("keydown", onKeyDown, true);
    win.removeEventListener("keyup", onKeyUp, true);
    win.clearTimeout(timer);
  };
}
