// entry/src/test/Requests.test.ts: core/Requests.ts against web pages/Requests.tsx.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { requestMetaParts, requestStatusLabel } from "../main/ets/core/Requests";
import { requestsUrl } from "../main/ets/core/Endpoints";

test("status labels, unknown shown as is", () => {
  assert.equal(requestStatusLabel("pending"), "Waiting for approval");
  assert.equal(requestStatusLabel("available"), "Available");
  assert.equal(requestStatusLabel("odd"), "odd");
});

test("meta: year, status, requester", () => {
  assert.deepEqual(requestMetaParts({ id: "1", title: "T", kind: "movie", status: "approved", mine: true, year: 2026, requested_by: "Sam" }),
    ["2026", "Approved", "Requested by you"]);
  assert.deepEqual(requestMetaParts({ id: "2", title: "T", kind: "series", status: "pending", mine: false, requested_by: "Alex" }),
    ["Waiting for approval", "Requested by Alex"]);
  assert.deepEqual(requestMetaParts({ id: "3", title: "T", kind: "movie", status: "failed", mine: false, year: null }), ["Failed"]);
});

test("requests url", () => {
  assert.equal(requestsUrl(), "/api/v1/requests");
});
