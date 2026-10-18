import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

function canonicalServerUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("selected fixture server secret is empty");
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("selected fixture server URL is invalid"); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password ||
      url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("selected fixture server URL is invalid");
  }
  return url.toString().replace(/\/$/, "");
}

export async function verifyFixtureServerIdentity({ serverUrl, username, password, fetchImpl = fetch }) {
  const server = canonicalServerUrl(serverUrl);
  if (typeof username !== "string" || !username || typeof password !== "string" || !password) {
    throw new Error("Device Test credentials are not configured");
  }

  const request = async (path, options) => {
    try {
      return await fetchImpl(`${server}${path}`, {
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        ...options,
      });
    }
    catch { throw new Error("fixture server identity request failed"); }
  };
  const login = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_platform: "ios",
      client_version: "parity",
      device_id: randomUUID(),
      device_name: "apple-wall-preflight",
      username,
      password,
    }),
  });
  if (!login.ok) throw new Error(`fixture server Device Test login failed with status ${login.status}`);

  let token;
  try { token = (await login.json()).access_token; } catch { /* sanitized below */ }
  if (typeof token !== "string" || !token) throw new Error("fixture server Device Test login returned no access token");

  const profilesResponse = await request("/api/v1/users/profiles", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!profilesResponse.ok) throw new Error(`fixture server Device Test profile check failed with status ${profilesResponse.status}`);

  let profiles;
  try { profiles = await profilesResponse.json(); } catch { /* sanitized below */ }
  const current = Array.isArray(profiles) ? profiles.filter((profile) => profile?.is_current === true) : [];
  if (current.length !== 1 || current[0]?.username !== username) {
    throw new Error("fixture server current profile does not match PLAYARR_DEVICE_TEST_USERNAME");
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyFixtureServerIdentity({
      serverUrl: process.env.SERVER_URL,
      username: process.env.PLAYARR_DEVICE_TEST_USERNAME,
      password: process.env.PLAYARR_DEVICE_TEST_PASSWORD,
    });
    console.log("Fixture server and Device Test identity verified");
  } catch (error) {
    console.error(`Fixture server preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
