// Isolated macOS Search focus smoke. This is deliberately outside suite.json and suite-run.
// The query, result labels, session tokens and ids stay in process memory and are never logged.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const KEY = { down: 125 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalise = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");

export function parseArgs(argv) {
  let query = "";
  let seen = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--query" || seen || i + 1 >= argv.length) return null;
    seen = true;
    query = argv[++i];
  }
  if (/[\r\n\0]/.test(query)) return null;
  query = query.trim();
  if (!query || query.length > 80 || /[\r\n\0]/.test(query)) return null;
  return { query };
}

export function parseResultCount(lines) {
  const counts = [];
  for (const line of lines) {
    const match = /^\s*([\d,]+)\s+results?\s*$/i.exec(String(line));
    if (match) counts.push(Number(match[1].replaceAll(",", "")));
  }
  const uniqueCounts = [...new Set(counts)];
  return uniqueCounts.length === 1 && Number.isSafeInteger(uniqueCounts[0]) ? uniqueCounts[0] : null;
}

export function compareSearchEvidence({ webQuery, nativeQuery, webLabels, nativeCount, webCount, webFirst, webDown, nativeFirst, nativeDown }) {
  const sameQuery = normalise(webQuery) === normalise(nativeQuery);
  const countsReady = Number.isSafeInteger(webCount) && Number.isSafeInteger(nativeCount) &&
    webCount >= 2 && nativeCount >= 2 && webCount === nativeCount && webLabels.length === webCount;
  const ordinal = (label) => {
    const matches = webLabels.map((item, index) => normalise(item) === normalise(label) ? index : -1).filter((index) => index >= 0);
    return matches.length === 1 ? matches[0] : null;
  };
  const webFirstOrdinal = ordinal(webFirst);
  const webDownOrdinal = ordinal(webDown);
  const firstOrdinal = ordinal(nativeFirst);
  const downOrdinal = ordinal(nativeDown);
  if (!sameQuery || !countsReady || webLabels.length < 2 || webFirstOrdinal === null || webDownOrdinal === null ||
      webFirstOrdinal === webDownOrdinal) {
    return { status: "not_executed", sameQuery, countsReady, firstMatches: false, downMatches: false,
      webFirstOrdinal, webDownOrdinal, firstOrdinal: null, downOrdinal: null };
  }
  return {
    status: "complete",
    sameQuery,
    countsReady,
    firstMatches: webFirstOrdinal === 0 && normalise(nativeFirst) === normalise(webFirst),
    downMatches: normalise(nativeDown) === normalise(webDown),
    webFirstOrdinal,
    webDownOrdinal,
    firstOrdinal,
    downOrdinal,
  };
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

function osascript(script, args = []) {
  return run("osascript", script.flatMap((line) => ["-e", line]).concat(args));
}

function readNativeState(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

async function waitFor(predicate, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await predicate();
    if (value) return value;
    await sleep(250);
  }
  return null;
}

function keyCode(code) {
  osascript([
    "on run argv",
    'tell application "System Events" to tell process "PlayarrMac" to set frontmost to true',
    `tell application "System Events" to key code ${code}`,
    "end run",
  ]);
}

function focusSearchAndType(query) {
  osascript([
    "on run argv",
    'tell application "System Events" to tell process "PlayarrMac"',
    "set frontmost to true",
    "if (count of windows) is 0 then error \"no app window\"",
    "set fields to every text field of front window",
    "if (count of fields) is 0 then error \"search text field unavailable\"",
    "if enabled of item 1 of fields is false then error \"search text field is disabled\"",
    "click item 1 of fields",
    "if focused of item 1 of fields is false then error \"search text field did not receive focus\"",
    "keystroke (item 1 of argv)",
    "if (value of item 1 of fields as text) is not (item 1 of argv) then error \"query entry mismatch\"",
    "key code 36",
    "end tell",
    "end run",
  ], [query]);
}

function activateSearchNavigation() {
  osascript([
    "tell application \"System Events\"",
    'tell process "PlayarrMac"',
    "set frontmost to true",
    "if (count of windows) is 0 then error \"no app window\"",
    'set matches to every button of front window whose name is "Search"',
    "if (count of matches) is not 1 then error \"Search navigation target unavailable\"",
    "click item 1 of matches",
    "end tell",
    "end tell",
  ]);
}

function readNativeAccessibleText() {
  const output = osascript([
    "tell application \"System Events\"",
    'tell process "PlayarrMac"',
    "if (count of windows) is 0 then error \"no app window\"",
    "set collected to \"\"",
    "repeat with elementRef in entire contents of front window",
    "try",
    "set elementRole to role of elementRef",
    "if elementRole is \"AXStaticText\" or elementRole is \"AXButton\" or elementRole is \"AXTextField\" then",
    "set elementName to name of elementRef as text",
    "if elementName is not \"\" then set collected to collected & elementName & linefeed",
    "end if",
    "end try",
    "try",
    "set elementValue to value of elementRef as text",
    "if elementValue is not \"\" then set collected to collected & elementValue & linefeed",
    "end try",
    "end repeat",
    "return collected",
    "end tell",
    "end tell",
  ]);
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function enterSearchOnWeb(page, query) {
  await page.goto(`${process.env.PLAYARR_WEB_URL ?? "https://playarr.app"}/search`, { waitUntil: "load" });
  const input = page.locator('.tv-search-form input[type="search"]');
  await input.waitFor({ state: "visible", timeout: 20000 });
  await input.fill(query);
  await input.press("Enter");
  await page.waitForFunction((expected) => new URL(location.href).searchParams.get("q") === expected,
    query, { timeout: 15000 });
  await page.waitForFunction(() => {
    const detail = document.querySelector(".page-header-detail")?.textContent?.trim() ?? "";
    const expected = Number(detail.replaceAll(",", "").match(/^(\d+) results?$/i)?.[1]);
    const cards = document.querySelectorAll(".tv-search-result");
    return Number.isSafeInteger(expected) && expected > 0 && cards.length === expected &&
      !document.querySelector(".tv-search .tv-mini-loader, .tv-search .skeleton, .tv-search [class*=skeleton-]");
  }, null, { timeout: 30000 });
  const cards = page.locator(".tv-search-result");
  const count = await cards.count();
  const labels = [];
  for (let index = 0; index < count; index += 1) {
    labels.push((await cards.nth(index).locator("strong").first().innerText()).trim());
  }
  const focusedFirst = await waitFor(async () => page.evaluate(() => {
    const card = document.activeElement?.closest(".tv-search-result");
    return card?.querySelector("strong")?.textContent?.trim() ?? null;
  }), 10000);
  if (focusedFirst) await waitFocusedArtwork(page);
  return {
    query: new URL(page.url()).searchParams.get("q") ?? "",
    count,
    labels,
    first: focusedFirst,
    page,
  };
}

async function observeWebDown(page) {
  await page.keyboard.press("ArrowDown");
  const focusedDown = await waitFor(async () => page.evaluate(() => {
    const card = document.activeElement?.closest(".tv-search-result");
    return card?.querySelector("strong")?.textContent?.trim() ?? null;
  }), 10000);
  if (focusedDown) await waitFocusedArtwork(page);
  return focusedDown;
}

async function waitFocusedArtwork(page) {
  await page.waitForFunction(async () => {
    const card = document.activeElement?.closest(".tv-search-result");
    const art = card?.querySelector(".tv-search-result-art");
    if (!card || !art) return false;
    const images = [...art.querySelectorAll("img")];
    if (!images.length) return art.childElementCount > 0 && !art.querySelector(".skeleton, [class*=skeleton-]");
    return (await Promise.all(images.map(async (image) => {
      if (!image.complete || image.naturalWidth === 0) return false;
      try { await image.decode(); } catch { return false; }
      const style = getComputedStyle(image);
      const rect = image.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    }))).every(Boolean);
  }, null, { timeout: 20000 });
}

async function signIn(page) {
  const base = (process.env.PLAYARR_WEB_URL ?? "https://playarr.app").replace(/\/$/, "");
  await page.goto(`${base}/`, { waitUntil: "load" });
  if (await page.locator(".app-nav").count()) return;
  if (!process.env.PLAYARR_USERNAME || !process.env.PLAYARR_PASSWORD || !process.env.PLAYARR_SERVER_URL) {
    throw new Error("web credentials unavailable");
  }
  await page.goto(`${base}/login`, { waitUntil: "load" });
  await page.getByText(/sign in manually|manual/i).first().click().catch(() => {});
  await page.fill('input[name="server-url"]', process.env.PLAYARR_SERVER_URL);
  await page.fill('input[name="username"]', process.env.PLAYARR_USERNAME);
  await page.fill('input[name="password"]', process.env.PLAYARR_PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 });
  await page.locator(".app-nav").waitFor({ state: "visible", timeout: 20000 });
}

async function runSmoke(query) {
  if (process.platform !== "darwin") return { status: "not_executed", stage: "platform" };
  const required = ["WORK", "TRUSTED", "SERVER_URL", "TEST_USERNAME", "TEST_PASSWORD"];
  if (required.some((key) => !process.env[key])) return { status: "not_executed", stage: "configuration" };
  const stateFile = `${process.env.WORK}/parity-state.json`;
  const wall = `${process.env.TRUSTED}/scripts/apple-wall/wall.sh`;
  if (!existsSync(wall)) return { status: "not_executed", stage: "trusted_scripts" };

  let browser;
  let stage = "launch";
  try {
    if (existsSync(stateFile)) unlinkSync(stateFile);
    run("bash", [wall, "launch", "macos", "dark", "-"], {
      env: {
        ...process.env,
        LAUNCH_EXTRA: `-PlayarrParityState ${stateFile}`,
        MAC_PARITY_VISIBLE: "true",
      },
    });
    await waitFor(() => {
      const state = readNativeState(stateFile);
      return state?.route === "/" && state?.focused ? state : null;
    }, 45000);

    stage = "native_search_navigation";
    const homeState = readNativeState(stateFile);
    if (homeState?.route !== "/" || !homeState.focused) return { status: "not_executed", stage };
    activateSearchNavigation();
    const state = await waitFor(() => {
      const next = readNativeState(stateFile);
      return next?.route === "/search" ? next : null;
    }, 15000);
    if (!state) return { status: "not_executed", stage };

    stage = "web_search";
    const web = (process.env.PLAYARR_WEB_URL ?? "https://playarr.app").replace(/\/$/, "");
    browser = await chromium.launch(process.env.PARITY_CHROME ? { executablePath: process.env.PARITY_CHROME } : {});
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
      userAgent: "Mozilla/5.0 (Linux; Android 12; BRAVIA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PlayarrAndroidTV/1.0",
      colorScheme: "dark", locale: "en-GB", timezoneId: "Asia/Bangkok" });
    await context.grantPermissions(["local-network-access"], { origin: web });
    const page = await context.newPage();
    await signIn(page);
    const webResult = await enterSearchOnWeb(page, query);

    stage = "native_search_entry";
    focusSearchAndType(query);
    const countLabels = await waitFor(() => {
      const labels = readNativeAccessibleText();
      return parseResultCount(labels) !== null ? labels : null;
    }, 30000);
    if (!countLabels) {
      return { status: "not_executed", stage, webCount: webResult.count, nativeCount: null };
    }
    const nativeCount = parseResultCount(countLabels);
    if (nativeCount < 2 || webResult.count < 2) {
      return { status: "not_executed", stage: "result_readiness", webCount: webResult.count, nativeCount };
    }
    if (nativeCount !== webResult.count) {
      return { status: "failed", stage: "result_count_mismatch", webCount: webResult.count, nativeCount };
    }

    stage = "focus_comparison";
    const webDown = await observeWebDown(webResult.page);
    const firstState = await waitFor(() => {
      const next = readNativeState(stateFile);
      return next?.route === "/search" && next.focused && normalise(next.focused) !== "search" ? next : null;
    }, 8000);
    const nativeFirst = firstState?.focused ?? null;
    keyCode(KEY.down);
    const nativeDown = await waitFor(() => {
      const next = readNativeState(stateFile);
      return next?.route === "/search" && next.focused && normalise(next.focused) !== normalise(nativeFirst) ? next.focused : null;
    }, 10000);
    const comparison = compareSearchEvidence({
      webQuery: webResult.query,
      nativeQuery: query,
      webLabels: webResult.labels,
      webCount: webResult.count,
      nativeCount,
      webFirst: webResult.first,
      webDown,
      nativeFirst,
      nativeDown,
    });
    return {
      status: comparison.status === "complete" && comparison.firstMatches && comparison.downMatches ? "passed" : "failed",
      stage,
      route: "/search",
      webCount: webResult.count,
      nativeCount,
      firstOrdinal: comparison.firstOrdinal,
      downOrdinal: comparison.downOrdinal,
      webFirstOrdinal: comparison.webFirstOrdinal,
      webDownOrdinal: comparison.webDownOrdinal,
      firstMatches: comparison.firstMatches,
      downMatches: comparison.downMatches,
    };
  } catch {
    return { status: "not_executed", stage };
  } finally {
    await browser?.close().catch(() => {});
  }
}

const args = parseArgs(process.argv.slice(2));
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!args) {
    console.log(JSON.stringify({ status: "not_executed", stage: "arguments" }));
    process.exitCode = 2;
  } else {
    const result = await runSmoke(args.query);
    console.log(JSON.stringify(result));
    process.exitCode = result.status === "passed" ? 0 : result.status === "failed" ? 1 : 2;
  }
}
