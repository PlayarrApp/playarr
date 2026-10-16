import { resolveTestServerUrl } from "./test-server-env.mjs";

export function resolveFixtureServerUrl(env = process.env, requestedBase = "") {
  const base = resolveTestServerUrl(env);
  const requested = requestedBase.trim().replace(/\/$/, "");
  if (requested && requested !== base) {
    throw new Error("--base must match PLAYARR_TEST_SERVER_URL");
  }

  const { hostname } = new URL(base);
  const host = hostname.replace(/^\[|\]$/g, "");
  const ipv4 = host.split(".").map(Number);
  const loopback = host === "localhost" || host === "::1" || (ipv4.length === 4 && ipv4[0] === 127);
  if (!loopback) {
    throw new Error("fixture credentials require PLAYARR_TEST_SERVER_URL to use a loopback host");
  }
  return base;
}
