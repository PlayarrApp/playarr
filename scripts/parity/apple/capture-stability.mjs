export async function captureStableFrame(capture, { attempts = 8, intervalMs = 4000, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let previous = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const frame = await capture();
    if (previous && frame.equals(previous)) return frame;
    previous = frame;
    if (attempt + 1 < attempts) await wait(intervalMs);
  }
  throw new Error(`screenshot did not settle after ${attempts} frames`);
}
