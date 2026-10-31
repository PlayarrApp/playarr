// Stand-in for Samsung's window.webapis.avplay on the Tizen 6.5 engine stand-in (DEVICE=tizen65): stock Chromium has no H.264 and no AVPlay, so the
// Tizen player engine would stop with AVPLAY_UNAVAILABLE. The shim keeps the AVPlay state machine (open, prepare, play, pause, seekTo, position ticks)
// over the clip's real length, so the player chrome shows the same states it shows on a TV. It decodes nothing: the picture is a codec and scaler
// difference, not UI, and the web refs for this dir are shot with the video hidden. Injected before the page scripts by drivers/tizen-webos.mjs.
(() => {
  const DURATION_MS = Number(window.__AVSHIM_DURATION_MS || 60000);
  let state = "NONE", position = 0, listener = {}, playedAt = 0, timer = 0;
  const now = () => performance.now();
  const sync = () => { if (state === "PLAYING") { position = Math.min(DURATION_MS, position + (now() - playedAt)); playedAt = now(); } };
  const tick = () => {
    sync();
    if (listener.oncurrentplaytime) listener.oncurrentplaytime(Math.round(position));
    if (position >= DURATION_MS) { state = "PAUSED"; clearInterval(timer); if (listener.onstreamcompleted) listener.onstreamcompleted(); }
  };
  const avplay = {
    open() { state = "IDLE"; position = 0; },
    close() { state = "NONE"; clearInterval(timer); },
    stop() { state = "IDLE"; position = 0; clearInterval(timer); },
    prepareAsync(ok) { setTimeout(() => { state = "READY"; ok && ok(); if (listener.onbufferingprogress) listener.onbufferingprogress(100); if (listener.onbufferingcomplete) listener.onbufferingcomplete(); }, 50); },
    play() { sync(); playedAt = now(); state = "PLAYING"; clearInterval(timer); timer = setInterval(tick, 500); },
    pause() { sync(); state = "PAUSED"; clearInterval(timer); },
    seekTo(ms, ok) { sync(); position = Math.max(0, Math.min(DURATION_MS, ms)); playedAt = now(); setTimeout(() => ok && ok(), 20); },
    suspend() {}, restore() {}, restoreAsync(a, b, c, ok) { ok && ok(); },
    getState: () => state,
    getDuration: () => DURATION_MS,
    getCurrentTime: () => { sync(); return Math.round(position); },
    getTotalTrackInfo: () => [],
    getCurrentStreamInfo: () => [],
    setListener(l) { listener = l || {}; window.__avListener = listener; },
    setDrm() {}, setStreamingProperty() {}, setDisplayRect() {}, setDisplayMethod() {}, setSelectTrack() {}, setSilentSubtitle() {}, setExternalSubtitlePath() {}, setSpeed() {},
  };
  window.webapis = window.webapis || {};
  window.webapis.avplay = avplay;
  window.__AVSHIM = true;
})();
