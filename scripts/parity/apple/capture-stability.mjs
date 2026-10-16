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

export function directPlayCaptureFile(suite) {
  const candidate = suite.performance?.find((entry) => entry.id === "b" && entry.file && entry.expect?.state === "playing");
  if (!candidate) throw new Error("the parity suite has no designated direct-play player capture file");
  return candidate.file;
}

export function assertDirectPlayback(playback) {
  if (playback?.state === "failed") {
    throw new Error(`direct-play player capture failed before negotiation: ${playback.detail || "player failed"}`);
  }
  if (playback?.mode !== "direct") {
    throw new Error(`direct-play player capture refused: expected direct negotiation, received ${playback?.mode || "no negotiation result"}`);
  }
}

export async function resetProgress(files, { serverURL, username, password, fetchImpl = fetch, deviceID = crypto.randomUUID() }) {
  const server = serverURL.replace(/\/$/, "");
  const request = async (path, options) => {
    try {
      return await fetchImpl(`${server}${path}`, options);
    } catch {
      throw new Error("progress reset request failed");
    }
  };
  const login = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_platform: "web",
      client_version: "parity",
      device_id: deviceID,
      device_name: "parity-reset",
      username,
      password,
    }),
  });
  if (!login.ok) throw new Error(`progress reset login failed (${login.status})`);
  const token = (await login.json()).access_token;
  if (!token) throw new Error("progress reset login returned no access token");

  for (const file of files) {
    const response = await request(`/api/v1/playback/${file}/progress`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ position_ms: 0, duration_ms: 6454000, completed: false }),
    });
    if (!response.ok) throw new Error(`progress reset failed (${response.status})`);
  }
}
