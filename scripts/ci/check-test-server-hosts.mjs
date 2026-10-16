#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceExtensions = new Set([".cjs", ".js", ".mjs", ".ps1", ".py", ".sh", ".ts", ".tsx"]);
const excludedDirectories = new Set([".git", "node_modules", "dist", "build", "target"]);
const hostnamePattern = /(?<![A-Za-z0-9_-])(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![A-Za-z0-9_-])/g;
const projectSentinelPattern = /(?<![A-Za-z0-9_-])playarr\.lan(?![A-Za-z0-9_-])/i;
const fakeRelayFixture = "clients/tv-web/web/scripts/relay-port-e2e.mjs";
const allowedRelayFixtureDeclaration = /^\s*const RELAY_HOST = `v4-\$\{RELAY_OCTETS\.join\("-"\)\}\.relay\.playarr\.app`;\s*$/;

function isRelayHostname(hostname) {
  return hostname.split(".").some((label) => /relay/i.test(label));
}

function findForbiddenHosts(text, filePath) {
  const violations = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (projectSentinelPattern.test(line)) {
      violations.push({ line: index + 1 });
      continue;
    }
    hostnamePattern.lastIndex = 0;
    for (const match of line.matchAll(hostnamePattern)) {
      if (!isRelayHostname(match[0])) continue;
      // This single declaration is a fake browser resolver fixture used to test port fallback.
      if (filePath === fakeRelayFixture && allowedRelayFixtureDeclaration.test(line)) continue;
      violations.push({ line: index + 1 });
      break;
    }
  }
  return violations;
}

function visit(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      visit(path, files);
    } else if (entry.isFile() && sourceExtensions.has(extensionOf(entry.name))) {
      files.push(path);
    }
  }
}

function visitClientScriptDirectories(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || excludedDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.name === "scripts") visit(path, files);
    else visitClientScriptDirectories(path, files);
  }
}

function extensionOf(name) {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index);
}

function collectFiles() {
  const files = [];
  visit(resolve(repoRoot, "scripts"), files);
  visitClientScriptDirectories(resolve(repoRoot, "clients"), files);
  // The checker contains detection patterns and generated synthetic examples, not harness endpoints.
  const checkerFiles = new Set(["scripts/ci/check-test-server-hosts.mjs", "scripts/ci/check-test-server-hosts.test.mjs"]);
  for (let index = files.length - 1; index >= 0; index -= 1) {
    if (checkerFiles.has(relative(repoRoot, files[index]))) files.splice(index, 1);
  }
  const workflowDirectory = resolve(repoRoot, ".github/workflows");
  for (const entry of readdirSync(workflowDirectory, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))) {
      files.push(resolve(workflowDirectory, entry.name));
    }
  }
  return [...new Set(files)].sort();
}

function scanFiles(files) {
  const violations = [];
  for (const absolutePath of files) {
    const filePath = relative(repoRoot, absolutePath).split(sep).join("/");
    const contents = readFileSync(absolutePath, "utf8");
    for (const hit of findForbiddenHosts(contents, filePath)) {
      violations.push(`${filePath}:${hit.line}`);
    }
  }
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = scanFiles(collectFiles());
  if (violations.length > 0) {
    console.error("::error::Hardcoded relay hostnames and the private project sentinel are forbidden in executable harnesses.");
    for (const location of violations) console.error(location);
    process.exitCode = 1;
  } else {
    console.log("ok: no hardcoded relay hosts or private project sentinel in executable harnesses");
  }
}

export { findForbiddenHosts, scanFiles };
