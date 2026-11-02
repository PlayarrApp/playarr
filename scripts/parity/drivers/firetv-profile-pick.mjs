// Chooses the first profile on the Fire TV picker and waits for the app to leave it. The virtual device is slow to draw the picker after
// a launch, so a fixed sleep then one Enter is sometimes spent before the picker has focus and Home is never reached. Instead: ask the
// app where it is, press Enter only while it reports the picker, and look again.
// A profile holds focus when the app reports a focused control or the native focus manager has a focused node.
const held = (s) => Boolean(s?.focus) || (s?.nativeFocusTag != null && s.nativeFocusTag >= 0);

export async function intoHome({ state, press, sleep, attempts = 5, polls = 8 }) {
  let seen = "no answer";
  // What each look found and when, so a failure says whether the app never answered or answered "picker" throughout.
  const trail = [];
  const t0 = Date.now();
  const note = (what, s) => trail.push(`${Math.round((Date.now() - t0) / 1000)}s ${what}:${s ? `${s.route}${held(s) ? "+focus" : ""}` : "none"}`);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const here = await state(15000).catch(() => null);
    note("a", here);
    if (here?.route) seen = here.route;
    if (here?.route && here.route !== "/profiles") return here;
    // Select is sent only once a profile holds focus; before that it would be spent claiming focus on a picker that has not drawn yet.
    let pressed = false;
    if (here?.route === "/profiles" && (held(here) || attempt > 0)) { await press("Return"); pressed = true; }
    let silent = 0;
    for (let i = 0; i < polls; i++) {
      await sleep(2500);
      const s = await state(7000).catch(() => null);
      note("p", s);
      // The app took Select and then never answers again while its screen stays drawn: the Vega runtime stopped the app's JS thread.
      // That happens on roughly one profile pick in ten, also with no state request in flight; only a relaunch brings the app back.
      silent = s ? 0 : silent + 1;
      if (pressed && silent >= 3) throw Object.assign(new Error(`the app stopped answering after the profile was chosen; trail: ${trail.join(" ")}`), { appHung: true });
      if (s?.route) seen = s.route;
      if (s?.route && s.route !== "/profiles") return s;
      // From the second attempt a picker that never reports focus still gets its Select (an app build without the focus report).
      // A late key goes out once per attempt, never twice, so it cannot land on Home.
      if (!pressed && s?.route === "/profiles" && (held(s) || attempt > 0)) { await press("Return"); pressed = true; }
    }
  }
  throw new Error(`the app did not reach Home after choosing the profile (signed out?); last state: ${seen}; trail: ${trail.join(" ")}`);
}
