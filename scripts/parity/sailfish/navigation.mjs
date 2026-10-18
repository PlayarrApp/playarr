const KEYMAP = Object.freeze({ left: "LEFT", right: "RIGHT", up: "UP", down: "DOWN", select: "ENTER", back: "ESC" });

export function keyCommand(name) {
  const key = KEYMAP[name];
  if (!key) throw new Error(`unsupported Sailfish navigation key: ${name}`);
  return key;
}

export function parseParityEvents(log) {
  const events = { screen: null, focus: null, keyAcks: [], keyCompletions: [], player: null };
  for (const line of String(log).split(/\r?\n/)) {
    const marker = line.indexOf("PARITY|");
    if (marker < 0) continue;
    const [, type, ...values] = line.slice(marker).split("|");
    if (type === "screen" && values.length) events.screen = values.join("|");
    if (type === "focus" && values.length >= 3) events.focus = { label: values[0], rail: values[1], index: values[2] };
    if (type === "key" && values.length >= 2 && /^(press|release)$/.test(values[1])) {
      events.keyAcks.push({ sequence: Number(values[0]), edge: values[1] });
    }
    if (type === "keydone" && values.length && /^\d+$/.test(values[0])) {
      events.keyCompletions.push(Number(values[0]));
    }
    if (type === "player" && values.length >= 4 && values.slice(0, 4).every((value) => /^\d+$/.test(value))) {
      events.player = { state: Number(values[0]), positionSeconds: Number(values[1]), menuOpen: values[2] === "1", controls: values[3] === "1" };
    }
  }
  return events;
}

export function decodeFocus(focus) {
  if (!focus) return null;
  const rawLabel = String(focus.label ?? "");
  let label = "";
  try { label = decodeURIComponent(rawLabel); } catch { label = rawLabel; }
  const railText = String(focus.rail ?? "");
  const indexText = String(focus.index ?? "");
  const validRail = /^-?\d+$/.test(railText) || /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(railText);
  const validIndex = /^\d+$/.test(indexText);
  if (!validRail || !validIndex) return { label };
  const rail = /^-?\d+$/.test(railText) ? Number(railText) : railText;
  return { label, position: { rail, index: Number(indexText) } };
}

export function hasKeyAckPair(events, sequence, after = 0) {
  const edges = new Set(events.slice(after).filter((event) => event.sequence === sequence).map((event) => event.edge));
  return edges.has("press") && edges.has("release");
}

export function nextKeyAckPress(events, after = 0) {
  const press = events.slice(after).find((event) => event.edge === "press");
  return press?.sequence ?? null;
}

export function hasKeyCompletion(events, sequence) {
  return events.includes(sequence);
}

export function nextCompletedKeySequence(events, after = 0) {
  const recent = events.slice(after);
  const press = recent.find((event) => event.edge === "press");
  if (!press) return null;
  const hasRelease = recent.some((event) => event.sequence === press.sequence && event.edge === "release");
  return hasRelease ? press.sequence : null;
}

export function hasNextKeyAckPress(events, after = 0) {
  return events.slice(after).some((event) => event.edge === "press");
}

export function hasNextKeyAckPair(events, after = 0) {
  const recent = events.slice(after);
  const press = recent.find((event) => event.edge === "press");
  return !!press && recent.some((event) => event.sequence === press.sequence && event.edge === "release");
}

export function completedKeyAckSequence(events, after = 0) {
  const recent = events.slice(after);
  const press = recent.find((event) => event.edge === "press");
  if (!press) return null;
  return recent.some((event) => event.sequence === press.sequence && event.edge === "release") ? press.sequence : null;
}
