#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateReadOnlyCaptureArgs } from "./readonly-capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, "suite.json"), "utf8"));
try {
  validateReadOnlyCaptureArgs(["--readonly-capture", "--only", "screens", ...process.argv.slice(2)], suite);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
