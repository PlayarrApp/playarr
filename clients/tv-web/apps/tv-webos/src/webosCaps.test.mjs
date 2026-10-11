import assert from "node:assert/strict";
import test from "node:test";
import { installWebOsDynamicRange, queryWebOsHdr } from "./webosCaps.mjs";

function windowWith(configs) {
  return {
    PalmServiceBridge: class {
      call() {
        setTimeout(() => this.onservicecallback(JSON.stringify({ configs })), 0);
      }
    },
  };
}

test("an HDR TV reports hdr10 and Dolby Vision from its configuration", async () => {
  const hdr = await queryWebOsHdr(windowWith({ "tv.model.supportHDR": true, "tv.model.supportDolbyHDRContents": false }));
  assert.deepEqual(hdr, { hdr10: true, dolbyVision: false });
});

test("an SDR TV reports neither", async () => {
  assert.deepEqual(await queryWebOsHdr(windowWith({ "tv.model.supportHDR": false })), { hdr10: false, dolbyVision: false });
});

test("no bridge or no answer leaves the shared probes alone", async () => {
  assert.equal(await queryWebOsHdr({}), null);
  assert.equal(await queryWebOsHdr({ PalmServiceBridge: class { call() {} } }, 20), null);
});

test("dynamic-range answers from the TV only when the engine does not know the query", () => {
  const w = { matchMedia: (q) => ({ media: /dynamic-range/.test(q) ? "not all" : q, matches: false }) };
  installWebOsDynamicRange(w, { hdr10: true, dolbyVision: false });
  assert.equal(w.matchMedia("(dynamic-range: high)").matches, true);
  assert.equal(w.matchMedia("(min-width: 1px)").matches, false);
  const known = { matchMedia: () => ({ media: "(dynamic-range: high)", matches: false }) };
  installWebOsDynamicRange(known, { hdr10: true, dolbyVision: true });
  assert.equal(known.matchMedia("(dynamic-range: high)").matches, false);
  const untouched = { matchMedia: () => ({ media: "x", matches: false }) };
  const before = untouched.matchMedia;
  installWebOsDynamicRange(untouched, null);
  assert.equal(untouched.matchMedia, before);
});
