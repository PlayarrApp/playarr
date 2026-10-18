const SCOPES = new Set(["home", "movies", "series", "music", "calendar"]);
const SLOT = /^(?:home|movies|series|music|calendar)-(?:hero|preview|r\d+-c\d+)$/;
const STATUSES = new Set(["pending", "ready", "failed", "empty"]);
const validSlot = (scope, slot) => slot.startsWith(`${scope}-`) && SLOT.test(slot);

export function intersectingSlots(slots, viewport = { x: 0, y: 0, width: 1920, height: 1080 }) {
  const right = viewport.x + viewport.width;
  const bottom = viewport.y + viewport.height;
  return slots.filter(({ x, y, width, height }) =>
    [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0 &&
    x < right && y < bottom && x + width > viewport.x && y + height > viewport.y);
}

export function parseArtEvent(text, seq) {
  if (typeof text !== "string") return null;
  const p = text.split("|");
  const generation = Number(p[1]);
  const scope = p[2];
  if (!Number.isSafeInteger(generation) || generation < 1 || !SCOPES.has(scope)) return null;
  if (p[0] === "begin" && p.length === 5 && /^[01]$/.test(p[3])) {
    const expectedCount = Number(p[4]);
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) return null;
    return { type: "begin", generation, scope, hasArt: p[3] === "1", expectedCount, seq };
  }
  if (p[0] === "slot" && p.length === 10 && validSlot(scope, p[3]) && /^[01]$/.test(p[4])) {
    const geometry = p.slice(5, 9).map(Number);
    const version = Number(p[9]);
    if (!geometry.every(Number.isFinite) || !Number.isSafeInteger(version) || version < 0) return null;
    return { type: "slot", generation, scope, slot: p[3], hasSource: p[4] === "1", x: geometry[0], y: geometry[1], width: geometry[2], height: geometry[3], version, seq };
  }
  if (p[0] === "status" && p.length === 6 && validSlot(scope, p[3]) && STATUSES.has(p[4])) {
    const version = Number(p[5]);
    if (!Number.isSafeInteger(version) || version < 0) return null;
    return { type: "status", generation, scope, slot: p[3], status: p[4], version, seq };
  }
  if (p[0] === "optional-empty" && p.length === 5 && validSlot(scope, p[3])) {
    const version = Number(p[4]);
    if (!Number.isSafeInteger(version) || version < 0) return null;
    return { type: "optional-empty", generation, scope, slot: p[3], version, seq };
  }
  if (p[0] === "finish" && p.length === 3) return { type: "finish", generation, scope, seq };
  return null;
}

export function createArtReadinessState() {
  return { generations: new Map() };
}

export function resetArtReadinessState(state) {
  state.generations.clear();
}

export function reduceArtEvent(state, event) {
  if (!event) return state;
  const key = `${event.scope}:${event.generation}`;
  let generation = state.generations.get(key);
  if (!generation) {
    generation = { scope: event.scope, generation: event.generation, began: false, finished: false, hasArt: false, expectedCount: 0, beginSeq: 0, slots: new Map(), buffered: [], pendingStatuses: new Map() };
    state.generations.set(key, generation);
  }
  if (event.type !== "begin" && !generation.began) {
    generation.buffered.push(event);
    return state;
  }
  if (event.type === "begin") {
    generation.began = true;
    generation.hasArt = event.hasArt;
    generation.expectedCount = event.expectedCount;
    generation.beginSeq = event.seq;
    const buffered = generation.buffered.splice(0).sort((a, b) => {
      const order = { slot: 0, "optional-empty": 1, status: 2, finish: 3 };
      return order[a.type] - order[b.type] || a.seq - b.seq;
    });
    for (const item of buffered) applyArtEvent(generation, item);
  } else applyArtEvent(generation, event);
  return state;
}

function applyArtEvent(generation, event) {
  if (event.type === "slot") {
    const current = generation.slots.get(event.slot);
    if (!current || event.version >= current.version) {
      if (!current && generation.finished) generation.expectedCount += 1;
      generation.slots.set(event.slot, { hasSource: event.hasSource, version: event.version, status: "pending", x: event.x, y: event.y, width: event.width, height: event.height });
      const pending = generation.pendingStatuses.get(event.slot)?.get(event.version);
      if (pending && (event.hasSource || pending.status === "empty")) generation.slots.get(event.slot).status = pending.status;
      generation.pendingStatuses.delete(event.slot);
    }
  } else if (event.type === "status") {
    const current = generation.slots.get(event.slot);
    if (current && event.version === current.version && (current.hasSource || event.status === "empty")) current.status = event.status;
    else if (!current) {
      const versions = generation.pendingStatuses.get(event.slot) ?? new Map();
      versions.set(event.version, { status: event.status, seq: event.seq });
      generation.pendingStatuses.set(event.slot, versions);
    }
  } else if (event.type === "optional-empty") {
    const current = generation.slots.get(event.slot);
    if (current && event.version >= current.version) {
      generation.slots.delete(event.slot);
      if (generation.finished) generation.expectedCount = Math.max(0, generation.expectedCount - 1);
    }
    generation.pendingStatuses.delete(event.slot);
  } else if (event.type === "finish") generation.finished = true;
}

export function artReadiness(generation, { scope, afterSeq = 0 } = {}) {
  if (!generation || !generation.began || generation.scope !== scope || generation.beginSeq <= afterSeq) return { ready: false, reason: "no-fresh-generation" };
  if (!generation.finished) return { ready: false, reason: "population-incomplete" };
  if (generation.slots.size !== generation.expectedCount) return { ready: false, reason: "telemetry-incomplete" };
  if (generation.hasArt && generation.slots.size === 0) return { ready: false, reason: "no-required-art-slots" };
  for (const slot of generation.slots.values()) {
    if (slot.status === "failed") return { ready: false, reason: "art-failed" };
    if (slot.status === "pending") return { ready: false, reason: "art-pending" };
    if (!slot.hasSource && slot.status !== "empty") return { ready: false, reason: "empty-slot-invalid" };
    if (slot.hasSource && slot.status === "empty") return { ready: false, reason: "source-slot-empty" };
  }
  return { ready: true, reason: "ready" };
}
