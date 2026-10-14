export interface MirrorCaptureGeometry {
  width: number;
  height: number;
  pixelRatio: number;
  /** Applied to the cloned body only when the app uses the VIDAA body transform. */
  cloneStyle?: Partial<CSSStyleDeclaration>;
}

/**
 * Captures the logical TV stage and applies the requested output density once.
 * VIDAA scales the real body with transform, so html-to-image must remove that
 * transform from its clone while retaining the body's logical stage bounds.
 */
export function mirrorCaptureGeometry(
  viewportWidth: number,
  viewportHeight: number,
  stageZoom: number,
  targetWidth: number,
  hasStageBodyTransform: boolean,
): MirrorCaptureGeometry {
  const zoom = stageZoom > 0 ? stageZoom : 1;
  const width = Math.round(viewportWidth / zoom);
  const height = Math.round(viewportHeight / zoom);
  const pixelRatio = Math.min(1, targetWidth / Math.max(1, width));

  return {
    width,
    height,
    pixelRatio,
    ...(hasStageBodyTransform
      ? {
          cloneStyle: {
            transform: "none",
            width: `${width}px`,
            height: `${height}px`,
          },
        }
      : {}),
  };
}
