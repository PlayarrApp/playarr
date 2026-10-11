// entry/src/test/CalendarLink.test.ts: core/CalendarLink.ts against web lib/calendarLink.ts.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { calendarLinkFailureText, calendarLinkScope, classifyCalendarLinkFailure, planCalendarLinkOpen } from "../main/ets/core/CalendarLink";
import { calendarFeedUrl } from "../main/ets/core/Endpoints";

test("a link is fetched when none exists or the server can show it again", () => {
  assert.equal(planCalendarLinkOpen(false, undefined, null), "fetch");
  assert.equal(planCalendarLinkOpen(true, true, null), "fetch");
});

test("an older server shows the stored copy, or asks for a deliberate reset", () => {
  assert.equal(planCalendarLinkOpen(true, undefined, "https://x/feed"), "stored");
  assert.equal(planCalendarLinkOpen(true, false, "https://x/feed"), "stored");
  assert.equal(planCalendarLinkOpen(true, false, null), "needsReset");
  assert.equal(planCalendarLinkOpen(true, false, ""), "needsReset");
});

test("failures map to viewer-facing causes", () => {
  assert.equal(classifyCalendarLinkFailure(0), "unreachable");
  assert.equal(classifyCalendarLinkFailure(404), "unsupported");
  assert.equal(classifyCalendarLinkFailure(501), "unsupported");
  assert.equal(classifyCalendarLinkFailure(401), "signin");
  assert.equal(classifyCalendarLinkFailure(500), "other");
  assert.match(calendarLinkFailureText("signin"), /sign-in has expired/);
});

test("scope and feed urls", () => {
  assert.equal(calendarLinkScope("https://s", "p1"), "https://s|p1");
  assert.equal(calendarFeedUrl(), "/api/v1/calendar/feed");
  assert.equal(calendarFeedUrl(true), "/api/v1/calendar/feed?rotate=true");
});
