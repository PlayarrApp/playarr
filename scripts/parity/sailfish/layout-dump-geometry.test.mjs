import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../../clients/sailfish/qml/components/LayoutDump.js", import.meta.url), "utf8");
const context = {};
vm.runInNewContext(source.replace(".pragma library", "") + "\nthis.layout = { dump, clipPolygon, polygonBounds, clippedItemPolygon, mappedRect };", context);

function makeItem(name, width, height, props = {}) {
  return {
    objectName: name, width, height, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
    opacity: 1, visible: true, clip: false, children: [], parent: null, ...props,
    mapToItem(root, x, y) {
      let point = { x, y };
      for (let item = this; item && item !== root; item = item.parent) {
        const radians = item.rotation * Math.PI / 180;
        const sx = item.scaleX ?? 1, sy = item.scaleY ?? 1;
        point = {
          x: item.x + Math.cos(radians) * sx * point.x - Math.sin(radians) * sy * point.y,
          y: item.y + Math.sin(radians) * sx * point.x + Math.cos(radians) * sy * point.y,
        };
      }
      return point;
    },
  };
}

function attach(parent, child) {
  child.parent = parent;
  parent.children.push(child);
  return child;
}

function dumpLines(root, u = 1) {
  const lines = [];
  context.layout.dump(root, u, {}, (line) => lines.push(line), (item) => ({ name: item.accessName || "", role: item.accessRole || 0 }), { width: 1, color: { r: 0, g: 0, b: 0, a: 1 } });
  return lines;
}

function dump(root, u = 1) {
  const lines = dumpLines(root, u);
  return lines.filter((line) => line.startsWith("LAYOUTEL|")).flatMap((line) => JSON.parse(line.slice(9)));
}

function focus(name, width, height, props = {}) {
  return makeItem(name, width, height, { navigationFocusable: true, accessName: name, accessRole: 43, ...props });
}

test("maps translated geometry to root-local CSS coordinates", () => {
  const root = makeItem("root", 100, 80, { x: 600, y: 300 });
  const child = attach(root, focus("translated", 20, 10, { x: 12, y: 8 }));
  assert.deepEqual(JSON.parse(JSON.stringify(child.mapToItem(root, 0, 0))), { x: 12, y: 8 });
  assert.deepEqual(dump(root, 2)[0].rect, { x: 6, y: 4, w: 10, h: 5 });
});

test("maps inherited nonuniform scale through every ancestor", () => {
  const root = makeItem("root", 100, 100);
  const parent = attach(root, makeItem("scaled", 40, 40, { x: 5, y: 7, scaleX: 2, scaleY: 3 }));
  attach(parent, focus("child", 10, 5, { x: 4, y: 2 }));
  assert.deepEqual(dump(root)[0].rect, { x: 13, y: 13, w: 20, h: 15 });
});

test("uses polygon intersection for a rotated clipping ancestor", () => {
  const root = makeItem("root", 100, 100);
  const clipper = attach(root, makeItem("rotated-clip", 20, 20, { x: 40, y: 40, rotation: 45, clip: true }));
  attach(clipper, focus("in-diamond", 3, 3, { x: 8, y: 8 }));
  attach(clipper, focus("aabb-only-corner", 3, 3, { x: -4, y: -4 }));
  assert.deepEqual(dump(root).map((item) => item.text), ["in-diamond"]);
  const polygon = context.layout.clippedItemPolygon(clipper.children[1], root, 0, 0, 3, 3);
  assert.equal(polygon.length, 0);
});

test("does not prune a visible child because its unclipped parent is offscreen", () => {
  const root = makeItem("root", 100, 100);
  const parent = attach(root, makeItem("offscreen-parent", 10, 10, { x: 140, y: 20 }));
  attach(parent, focus("visible-child", 12, 8, { x: -140, y: 5 }));
  assert.deepEqual(dump(root)[0].rect, { x: 0, y: 25, w: 12, h: 8 });
});

test("intersects nested clipping polygons before deciding visibility", () => {
  const root = makeItem("root", 100, 100);
  const outer = attach(root, makeItem("outer", 60, 60, { x: 10, y: 10, clip: true }));
  const inner = attach(outer, makeItem("inner", 30, 30, { x: 20, y: 20, clip: true }));
  attach(inner, focus("inside", 8, 8, { x: 2, y: 2 }));
  attach(inner, focus("outside-inner", 8, 8, { x: 35, y: 2 }));
  assert.deepEqual(dump(root).map((item) => item.text), ["inside"]);
});

test("inherits visibility and opacity while retaining partially visible geometry", () => {
  const root = makeItem("root", 100, 100);
  const faded = attach(root, makeItem("faded", 30, 20, { opacity: 0.5 }));
  attach(faded, focus("partly-visible", 20, 10, { x: 90, y: 10 }));
  const hidden = attach(root, makeItem("hidden", 30, 20, { visible: false }));
  attach(hidden, focus("hidden-child", 10, 10));
  const zeroOpacity = attach(root, makeItem("transparent", 30, 20, { opacity: 0 }));
  attach(zeroOpacity, focus("transparent-child", 10, 10));
  const result = dump(root);
  assert.deepEqual(result.map((item) => item.text), ["partly-visible"]);
  assert.deepEqual(result[0].rect, { x: 90, y: 10, w: 20, h: 10 });
  assert.equal(result[0].opacity, 0.5);
});

test("keeps radius tied to the drawn box when viewport clipping shortens its visible box", () => {
  const root = makeItem("root", 100, 100);
  const rounded = attach(root, makeItem("rounded", 30, 20, {
    x: -15, y: 10, border: { width: 0 }, radius: 8,
    color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
  }));
  assert.ok(rounded);
  const [result] = dump(root);
  assert.deepEqual(result.rect, { x: -15, y: 10, w: 30, h: 20 });
  assert.equal(result.radius, 8);
});

test("samples a heavily clipped flat fill from inside its visible polygon", () => {
  const root = makeItem("root", 100, 100);
  attach(root, makeItem("visible-fill", 60, 20, {
    x: -50, border: { width: 0 }, radius: 0,
    color: { r: 1, g: 0, b: 0, a: 1 },
  }));
  const [result] = dump(root);
  assert.deepEqual(result.rect, { x: -50, y: 0, w: 60, h: 20 });
  assert.equal(result.background, "#ff0000");
});

test("does not invent a scalar radius for nonuniformly transformed rounded geometry", () => {
  const root = makeItem("root", 100, 100);
  const parent = attach(root, makeItem("nonuniform", 50, 50, { scaleX: 2, scaleY: 3 }));
  attach(parent, makeItem("rounded", 20, 12, {
    border: { width: 0 }, radius: 4, color: { r: 0, g: 0, b: 0, a: 1 },
  }));
  const lines = dumpLines(root);
  assert.equal(Object.hasOwn(JSON.parse(lines[0].slice(9))[0], "radius"), false);
  assert.ok(lines.some((line) => line === "LAYOUTWARN|nonuniform-rounded-radius|1"));
});

test("takes a control's radius from the shape painted over it, never from a hint", () => {
  const root = makeItem("root", 100, 100);
  const hinted = attach(root, focus("hint-only", 12, 12, { x: 2, y: 2, focusRadius: 6 }));
  const painted = attach(root, focus("painted", 12, 12, { x: 30, y: 2, scaleX: 2, scaleY: 2 }));
  attach(painted, makeItem("plate", 12, 12, { border: { width: 0 }, radius: 3, color: { r: 0, g: 0, b: 0, a: 1 } }));
  const [first, second] = dump(root).filter((row) => row.role === "button");
  assert.ok(hinted);
  assert.equal(Object.hasOwn(first, "radius"), false);
  assert.equal(second.radius, 6);
});

test("drops an element that an opaque later sibling covers, keeps one beneath a translucent plate", () => {
  const root = makeItem("root", 100, 100);
  attach(root, focus("covered", 10, 10, { x: 10, y: 10 }));
  attach(root, makeItem("plate", 50, 50, { border: { width: 0 }, radius: 0, color: { r: 1, g: 1, b: 1, a: 0.9 } }));
  attach(root, focus("under-glass", 10, 10, { x: 60, y: 60 }));
  attach(root, makeItem("glass", 20, 20, { x: 55, y: 55, border: { width: 0 }, radius: 0, color: { r: 1, g: 1, b: 1, a: 0.2 } }));
  assert.deepEqual(dump(root).filter((row) => row.role === "button").map((row) => row.text), ["under-glass"]);
});

test("reports a text font size at the scale it is drawn", () => {
  const root = makeItem("root", 100, 100);
  attach(root, makeItem("scaled", 40, 10, textItem({ text: "abcd", scaleX: 2, scaleY: 2 })));
  assert.equal(dump(root)[0].fontSize, 20);
});

test("a zero-size clipping ancestor hides descendants", () => {
  const root = makeItem("root", 100, 100);
  const empty = attach(root, makeItem("empty-clip", 0, 30, { clip: true }));
  attach(empty, focus("not-visible", 10, 10));
  assert.deepEqual(dump(root), []);
});

test("keeps image item bounds exact and normalises them by the supplied layout scale", () => {
  const root = makeItem("root", 100, 100);
  attach(root, makeItem("image", 20, 10, {
    source: "test-image", status: 1, paintedWidth: 16, paintedHeight: 8, x: 30, y: 40,
  }));
  assert.deepEqual(dump(root, 2)[0].rect, { x: 15, y: 20, w: 10, h: 5 });
});

test("clips rotated convex polygons without replacing their shape with bounding boxes", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const corner = [{ x: 9, y: 9 }, { x: 12, y: 9 }, { x: 12, y: 12 }, { x: 9, y: 12 }];
  assert.deepEqual(Array.from(context.layout.clipPolygon(corner, square), ({ x, y }) => `${x},${y}`).sort(), ["10,10", "10,9", "9,10", "9,9"]);
  assert.deepEqual(context.layout.polygonBounds([]), null);
  assert.equal(context.layout.clipPolygon(square, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]).length, 0);
});

test("does not composite rotated flat fills into empty AABB corners", () => {
  const root = makeItem("root", 100, 100);
  attach(root, makeItem("diamond-fill", 20, 20, {
    x: 40, y: 40, rotation: 45, border: { width: 0 }, radius: 0,
    color: { r: 1, g: 0, b: 0, a: 1 },
  }));
  attach(root, makeItem("corner-text", 2, 2, {
    x: 27, y: 42, text: "x", contentWidth: 2, contentHeight: 10,
    font: { family: "Sans", pixelSize: 10, weight: 50 }, color: { r: 0, g: 0, b: 0, a: 1 },
    lineCount: 1, baselineOffset: 1, horizontalAlignment: 0, implicitWidth: 2, elide: 3,
  }));
  const text = dump(root).find((item) => item.text === "x");
  assert.equal(text.background, "#ffffff");
});

function textItem(props) {
  return {
    text: "", contentWidth: 10, contentHeight: 10, font: { family: "Sans", pixelSize: 10, weight: 50, letterSpacing: 0 }, color: { r: 0, g: 0, b: 0, a: 1 },
    lineCount: 1, horizontalAlignment: 1, verticalAlignment: 32, wrapMode: 0, elide: 3, leftPadding: 0, rightPadding: 0, topPadding: 0, bottomPadding: 0, ...props,
  };
}

test("exports a Text item's own content box, aligned inside the item", () => {
  const root = makeItem("root", 100, 100);
  attach(root, makeItem("line", 60, 14, textItem({ text: "aa bbb cc", contentWidth: 45, contentHeight: 11 })));
  attach(root, makeItem("centred", 40, 14, Object.assign(textItem({ text: "abcd", horizontalAlignment: 4, contentWidth: 20, contentHeight: 11 }), { y: 20 })));
  attach(root, makeItem("right", 40, 14, Object.assign(textItem({ text: "abcd", horizontalAlignment: 2, contentWidth: 20, contentHeight: 11 }), { y: 40 })));
  const runs = dump(root);
  assert.deepEqual(runs.map((run) => run.text), ["aa bbb cc", "abcd", "abcd"]);
  assert.deepEqual(runs.map((run) => run.rect), [{ x: 0, y: 0, w: 45, h: 11 }, { x: 10, y: 20, w: 20, h: 11 }, { x: 20, y: 40, w: 20, h: 11 }]);
});

test("stops on text that Qt wrapped or elided itself, and skips text drawn transparent", () => {
  const throws = (props) => {
    const root = makeItem("root", 100, 100);
    attach(root, makeItem("t", 40, 30, textItem({ text: "aa bb cc", ...props })));
    assert.throws(() => dump(root), /LAYOUTERR/);
  };
  throws({ lineCount: 2 });
  throws({ truncated: true });
  throws({ text: "aa\nbb" });
  const root = makeItem("root", 100, 100);
  attach(root, makeItem("ghost", 40, 10, textItem({ text: "hidden", color: { r: 0, g: 0, b: 0, a: 0 } })));
  assert.deepEqual(dump(root), []);
});

test("exports the radius of the mask a layer is clipped to, and clips its children by it", () => {
  const root = makeItem("root", 100, 100);
  const holder = attach(root, makeItem("holder", 40, 40, { layer: { enabled: true }, border: { width: 0, color: { r: 0, g: 0, b: 0, a: 0 } }, radius: 8, color: { r: 1, g: 0, b: 0, a: 1 } }));
  attach(root, makeItem("effect", 40, 40, { maskSource: { radius: 8 }, source: { sourceItem: holder }, z: 0 }));   // the layer's effect, as Qt places it
  attach(holder, makeItem("picture", 60, 40, { source: "x", status: 1, paintedWidth: 60, fillMode: 2 }));
  const rows = dump(root);
  assert.equal(rows[0].radius, 8);
  assert.deepEqual(rows[1].rect, { x: 0, y: 0, w: 60, h: 40 });
  assert.equal(rows[1].radius, undefined);
  const round = attach(root, makeItem("round", 40, 40, { y: 50, source: "x", status: 1, paintedWidth: 40, fillMode: 2, layer: { enabled: true } }));
  attach(root, makeItem("effect2", 40, 40, { maskSource: { radius: 8 }, source: { sourceItem: round }, z: 0 }));
  assert.equal(dump(root).filter((row) => row.rect.y === 50)[0].radius, 8);
  assert.ok(round);
});

test("a Text with a role of its own still exports its measured run, never its frame", () => {
  const root = makeItem("root", 100, 100);
  const box = attach(root, makeItem("time", 54, 15, { accessName: "0:02 / 1:00", accessRole: 16, navigationFocusable: true }));
  attach(box, makeItem("run", 54, 15, textItem({ text: "0:02 / 1:00", contentWidth: 50, contentHeight: 11, horizontalAlignment: 4 })));
  const rows = dump(root);
  assert.deepEqual(rows.map((row) => [row.role, row.rect.w, row.rect.h]), [["container", 54, 15], ["text", 50, 11]]);
});

test("a named item with no mapped accessible role stops the export, and Form is exported as form", () => {
  const root = makeItem("root", 100, 100);
  attach(root, makeItem("nameless-role", 20, 10, { accessName: "Open", accessRole: 0 }));
  assert.throws(() => dump(root), /LAYOUTERR/);
  const root2 = makeItem("root", 100, 100);
  attach(root2, makeItem("form", 20, 10, { accessName: "", accessRole: 1040 }));
  assert.equal(dump(root2)[0].role, "form");
});

test("a text item that draws its own plate exports the plate's radius; a parent's radius is not copied", () => {
  const root = makeItem("root", 100, 100);
  const parent = attach(root, makeItem("parent", 60, 30, { border: { width: 0, color: { r: 0, g: 0, b: 0, a: 0 } }, radius: 11, color: { r: 1, g: 0, b: 0, a: 1 } }));
  const own = attach(parent, makeItem("own", 40, 14, textItem({ text: "ab", contentWidth: 20, contentHeight: 11 })));
  attach(own, makeItem("plate", 60, 30, { x: -10, y: -8, z: -1, border: { width: 0, color: { r: 0, g: 0, b: 0, a: 0 } }, radius: 11, color: { r: 0, g: 1, b: 0, a: 1 } }));
  attach(parent, makeItem("bare", 40, 14, textItem({ text: "cd", contentWidth: 20, contentHeight: 11 })));
  const text = dump(root).filter((row) => row.role === "text");
  assert.equal(text[0].radius, 11);
  assert.equal(text[1].radius, undefined);
});

test("does not export a Canvas that is not available or a transparent text", () => {
  const root = makeItem("root", 100, 100);
  attach(root, makeItem("canvas", 20, 20, { available: false, renderTarget: 1 }));
  attach(root, makeItem("canvas2", 20, 20, { y: 30, available: true, renderTarget: 1 }));
  assert.deepEqual(dump(root).map((row) => [row.role, row.rect.y]), [["image", 30]]);
});

test("clips overflowing local content by the item's own clip and its parent clip", () => {
  const root = makeItem("root", 100, 100);
  const clipped = attach(root, makeItem("clipped-item", 20, 20, { x: 10, y: 10, clip: true }));
  const overflowing = focus("overflow", 12, 8, { x: 15, y: 4, clip: true });
  attach(clipped, overflowing);
  const polygon = context.layout.clippedItemPolygon(overflowing, root, -4, 0, 20, 8);
  assert.deepEqual(JSON.parse(JSON.stringify(context.layout.polygonBounds(polygon))), { x: 25, y: 14, w: 5, h: 8 });
});

test("reads the accessible name and role the item exposes, not a custom hint", () => {
  const root = makeItem("root", 100, 100);
  attach(root, makeItem("pill", 20, 10, { navigationFocusable: true, accessName: "Close filters", accessRole: 43 }));
  assert.deepEqual(dump(root).map((row) => [row.text, row.role]), [["Close filters", "button"]]);
});

test("a border equal to Qt's unset default draws nothing; any other pen does", () => {
  const root = makeItem("root", 100, 100);
  attach(root, makeItem("unset", 20, 10, { border: { width: 1, color: { r: 0, g: 0, b: 0, a: 1 } }, radius: 0, color: { r: 0, g: 0, b: 0, a: 0 } }));
  attach(root, makeItem("outlined", 20, 10, { x: 30, border: { width: 1, color: { r: 0.5, g: 0, b: 0, a: 1 } }, radius: 0, color: { r: 0, g: 0, b: 0, a: 0 } }));
  assert.deepEqual(dump(root).map((row) => row.rect.x), [30]);
});

test("QML sets no 1 px pure black border that would read as Qt's unset default", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const dir = new URL("../../../clients/sailfish/qml/", import.meta.url);
  const files = (d) => readdirSync(d).flatMap((n) => { const p = new URL(n + (statSync(new URL(n, d)).isDirectory() ? "/" : ""), d); return n.endsWith(".qml") ? [p] : statSync(p).isDirectory() ? files(p) : []; });
  for (const f of files(dir)) assert.doesNotMatch(readFileSync(f, "utf8"), /border\.color:\s*("#000(000)?"|"black")/, f.pathname);
});
