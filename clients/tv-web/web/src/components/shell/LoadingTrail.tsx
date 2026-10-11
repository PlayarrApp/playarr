import { createPortal } from "react-dom";

/**
 * The one "something is loading" indicator for content that is already on screen (loading more titles, refreshing a
 * stored list): a thin trail along the top of the screen, never a centred spinner. First loads use the shared skeletons.
 * Portalled to `body` so the route transition's transform on the page cannot move it off the screen edge.
 */
/** `label` is announced; leave it out when a skeleton on the same screen already announces the loading. */
export function LoadingTrail({ label }: { label?: string }) {
  return createPortal(
    <div className="loading-trail" {...(label ? { role: "status", "aria-label": label } : { "aria-hidden": true })}>
      <span className="loading-trail-bar" aria-hidden="true" />
    </div>,
    document.body
  );
}
