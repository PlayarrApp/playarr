#!/usr/bin/env node
// Captures the ref-only extra screen calendar-link (the calendar's link drawer) in both themes, which is not part of suite.json.
// usage: capture-extra.mjs <out dir>   env as for run.sh (PLAYARR_SF_*, PARITY_*); sign in first (sign-in.mjs).
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadParityConfig } from "../parity-config.mjs";
import { createDriver } from "./driver.mjs";

loadParityConfig();
const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: capture-extra.mjs <out dir>");
process.env.PLAYARR_DEVICE_TEST_USERNAME ??= process.env.PARITY_ACCOUNT_NAME;
const driver = await createDriver();
try {
  await driver.start();
  for (const theme of ["dark", "light"]) {
    await driver.setTheme(theme);
    await driver.route("/calendar?panel=link", { screenId: "calendar-link" });
    mkdirSync(join(out, theme), { recursive: true });
    await driver.screenshot(join(out, theme, "calendar-link.png"));
  }
} finally { await driver.stop(); }
