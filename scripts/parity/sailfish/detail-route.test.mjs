import assert from "node:assert/strict";
import test from "node:test";
import { detailRouteRequest } from "./detail-route.mjs";

test("concrete detail routes fetch and open the exact validated catalogue work", () => {
  for (const kind of ["movie", "series"]) {
    const request = detailRouteRequest("fixture-item-123", kind, "--pc=a1b2c3d4");
    assert.match(request, /Api\.request\('GET','\/api\/v1\/catalog\/fixture-item-123'/);
    assert.ok(request.includes(`d.work.kind!=='${kind}'`));
    assert.ok(request.includes("d.work.id!=='fixture-item-123'"));
    assert.ok(request.includes("pageStack.currentPage.open(d.work)"));
    assert.ok(request.includes("PLAYARR_CAPTURE_ROUTE_ERROR=--pc=a1b2c3d4"));
    assert.ok(!request.includes("|"), "route scripts cannot contain the PLAYARR_STEPS delimiter");
  }
  assert.throws(() => detailRouteRequest("bad/id", "series", "--pc=a1b2c3d4"), /invalid Sailfish detail id/);
});
