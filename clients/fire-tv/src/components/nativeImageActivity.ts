/** Tracks every native image request owned by one mounted Image element. */
export function createNativeImageActivityTracker(onDelta: (delta: 1 | -1) => void): {
  start(): void;
  end(): void;
  dispose(): void;
} {
  let pending = 0;
  let disposed = false;

  return {
    start() {
      if (disposed) return;
      pending += 1;
      onDelta(1);
    },
    end() {
      if (disposed || pending === 0) return;
      pending -= 1;
      onDelta(-1);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      while (pending > 0) {
        pending -= 1;
        onDelta(-1);
      }
    },
  };
}
