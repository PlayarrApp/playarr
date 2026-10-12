import { writeFileSync } from "node:fs";

export async function createDriver() {
  let location = "/";
  let focused = "pause";
  const toggles = process.env.PARITY_TEST_TOGGLE === "yes";
  const roleOnly = process.env.PARITY_TEST_TOGGLE === "role";
  return {
    async start() { if (process.env.PARITY_TEST_START_MARKER) writeFileSync(process.env.PARITY_TEST_START_MARKER, "started"); },
    async home() { location = "/"; },
    async route(path) {
      if (process.env.PARITY_TEST_ROUTE_MARKER) writeFileSync(process.env.PARITY_TEST_ROUTE_MARKER, path);
      location = path.replace(":id", "fixture");
    },
    async location() { return location; },
    async setTheme() {},
    async playerReady() { focused = "pause"; },
    async key(key) { if (key === "select" && toggles) focused = focused === "pause" ? "play" : "pause"; },
    async focused() { return roleOnly ? "play-pause" : focused; },
  };
}
