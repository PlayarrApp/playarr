#!/usr/bin/env node
// Design-report capture of the Sailfish screens that are not in suite.json, both themes, no layout export.
// usage: capture-design.mjs <captures dir> [screen,screen,...]   env as for run.sh (PLAYARR_SF_*, PARITY_*); sign in first.
// Screens the app does not have are not listed here: they are recorded as absent in the manifest (write-manifest.mjs).
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadParityConfig } from "../parity-config.mjs";
import { createDriver } from "./driver.mjs";

export const DESIGN_SCREENS = [
  "login-qr", "profiles--add", "downloads", "watchlist", "playlists", "requests", "playlist-detail", "music-detail",
  "search-results", "search--keyboard", "player",
  "settings-appearance", "settings-profile-avatar", "settings-language", "settings-player", "settings-server", "settings-profile-lock",
];

if (import.meta.url === `file://${process.argv[1]}`) {
  loadParityConfig();
  process.env.PLAYARR_SF_NO_LAYOUT = "1";
  process.env.PLAYARR_DEVICE_TEST_USERNAME ??= process.env.PARITY_ACCOUNT_NAME;
  const out = resolve(process.argv[2] ?? "");
  if (!process.argv[2]) throw new Error("usage: capture-design.mjs <captures dir> [screens]");
  const wanted = process.argv[3] ? process.argv[3].split(",") : DESIGN_SCREENS;
  for (const id of wanted) if (!DESIGN_SCREENS.includes(id)) throw new Error(`unknown design screen ${id}`);
  const driver = await createDriver();
  try {
    await driver.start();
    for (const theme of (process.env.PLAYARR_SF_THEMES ?? "dark,light").split(",")) {
      await driver.setTheme(theme);
      mkdirSync(join(out, theme), { recursive: true });
      for (const id of wanted) {
        await driver.route(`/design/${id}`, { screenId: id });
        await driver.screenshot(join(out, theme, `${id}.png`));
        console.log(`captured ${theme}/${id}`);
      }
    }
  } finally { await driver.stop(); }
}
