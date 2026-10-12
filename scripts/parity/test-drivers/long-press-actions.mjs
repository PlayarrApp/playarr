export async function createDriver() {
  let location = "/";
  return {
    async home() { location = "/"; },
    async route(path) { location = path.replace(":id", "fixture"); },
    async location() { return location; },
    async setTheme() {},
    async key() {},
    async focused() { return "play-pause"; },
  };
}
