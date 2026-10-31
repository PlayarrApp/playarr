// Chooses the first profile on the Fire TV picker and waits for the app to leave it. The virtual device is slow to draw the picker after
// a launch, so a fixed sleep then one Enter is sometimes spent before the picker has focus and Home is never reached. Instead: ask the
// app where it is, press Enter only while it reports the picker, and look again.
export async function intoHome({ state, press, sleep, attempts = 5, polls = 8 }) {
  let seen = "no answer";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const here = await state(15000).catch(() => null);
    if (here?.route) seen = here.route;
    if (here?.route && here.route !== "/profiles") return here;
    // Select is sent only once a profile holds focus; before that it would be spent claiming focus on a picker that has not drawn yet.
    let pressed = false;
    if (here?.route === "/profiles" && here.focus) { await press("Return"); pressed = true; }
    for (let i = 0; i < polls; i++) {
      await sleep(2500);
      const s = await state(7000).catch(() => null);
      if (s?.route) seen = s.route;
      if (s?.route && s.route !== "/profiles") return s;
      // A late key goes out once per attempt, never twice, so it cannot land on Home.
      if (!pressed && s?.route === "/profiles" && s.focus) { await press("Return"); pressed = true; }
    }
  }
  throw new Error(`the app did not reach Home after choosing the profile (signed out?); last state: ${seen}`);
}
