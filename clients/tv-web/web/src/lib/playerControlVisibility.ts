export function shouldAutoHidePlayerControls({
  inlineMusic,
  minimised,
  playbackState,
  interactionPinned,
}: {
  inlineMusic: boolean;
  minimised: boolean;
  playbackState: string;
  interactionPinned: boolean;
}): boolean {
  return (
    !inlineMusic &&
    !minimised &&
    playbackState === "playing" &&
    !interactionPinned
  );
}

/** Inline music controls stay mounted while a slow or stalled stream is still busy, so they never vanish under the coverflow. */
export function shouldRenderPlayerControls({
  inlineMusic,
  minimised,
}: {
  inlineMusic: boolean;
  minimised: boolean;
}): boolean {
  return !minimised || inlineMusic;
}
