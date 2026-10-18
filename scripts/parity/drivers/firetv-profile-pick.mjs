// Chooses the first profile on the Fire TV picker and waits for the app to leave it. The virtual device is slow to draw the picker after
// a launch, so a fixed sleep then one Enter is sometimes spent before the picker has focus and Home is never reached. Instead: ask the
// app where it is, press Enter only while it reports the picker, and look again.
export async function intoHome({ state, press, sleep, attempts = 5, polls = 8 }) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const here = await state(15000).catch(() => null);
    if (here?.route && here.route !== "/profiles") return here;
    if (here?.route === "/profiles") await press("Return");
    for (let i = 0; i < polls; i++) {
      await sleep(2500);
      const s = await state(7000).catch(() => null);
      if (s?.route && s.route !== "/profiles") return s;
    }
  }
  throw new Error("the app did not reach Home after choosing the profile (signed out?)");
}
