const SERVER_URL_ALIASES = [
  "PLAYARR_SERVER_URL",
  "PLAYARR_DEVICE_TEST_SERVER_URL",
  "PLAYARR_NURA_APP_SERVER_URL",
  "PLAYARR_SAILFISH_PARITY_SERVER_URL",
];

export function resolveTestServerUrl(env = process.env) {
  const serverUrl = env.PLAYARR_TEST_SERVER_URL?.trim().replace(/\/$/, "");
  if (!serverUrl) throw new Error("PLAYARR_TEST_SERVER_URL is required for parity tests");
  let parsed;
  try { parsed = new URL(serverUrl); }
  catch { throw new Error("PLAYARR_TEST_SERVER_URL must be a valid HTTP or HTTPS URL"); }
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || /\s/.test(serverUrl) || serverUrl.includes("?") || serverUrl.includes("#")) {
    throw new Error("PLAYARR_TEST_SERVER_URL must be an HTTP or HTTPS base URL without credentials, query, or fragment");
  }
  return serverUrl;
}

export function testServerEnvironment(env = process.env) {
  const serverUrl = resolveTestServerUrl(env);
  return Object.fromEntries([
    ...Object.entries(env),
    ["PLAYARR_TEST_SERVER_URL", serverUrl],
    ...SERVER_URL_ALIASES.map((name) => [name, serverUrl]),
  ]);
}
