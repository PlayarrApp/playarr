#!/usr/bin/env node
// Prints the parity suite's designated direct-play media file for CI UI tests.
// Keep consumers on the shared suite so hosted captures do not copy a private fixture id.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { directPlayCaptureFile } from "./capture-stability.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, "..", "suite.json"), "utf8"));
console.log(directPlayCaptureFile(suite));
