// Canonical On deck state for every parity capture (web references and device runs alike).
// Watch progress is account state, so a reference captured with one deck and a device with another differs by a whole
// card on Home. Both capture scripts call applyCanonicalDeck inside withCaptureState's callback, so the reset shares the
// account lock and the progress is restored afterwards. The media ID comes from the environment, never from the repo.
// Resume-plan choices are cleared because the server API cannot enumerate them for snapshot/restore.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function seedCanonicalDeck({ snapshot, snapshotNow, writeProgress, clearResumeChoices }, { deckFile, positionMs, durationMs }) {
  if (!ID.test(deckFile ?? "")) throw new Error("deckFile must be a media ID");
  const deck = snapshot.files[deckFile];
  if (!deck) throw new Error("canonical deck item is absent from the captured progress scope");
  for (const [file, row] of Object.entries(snapshot.files)) {
    if (file !== deckFile) await writeProgress(file, { position_ms: 0, duration_ms: row.duration_ms, completed: false });
  }
  const position = Number(positionMs ?? deck.position_ms ?? 1);
  const duration = Number(durationMs ?? deck.duration_ms);
  if (!(position > 0 && duration > position)) throw new Error("canonical deck position/duration are invalid");
  await writeProgress(deckFile, { position_ms: position, duration_ms: duration, completed: false });
  const clearedResumeChoiceWorks = await clearResumeChoices();
  return { snapshot: await snapshotNow(), clearedResumeChoiceWorks };
}

/** Deck settings from the environment, or null when PARITY_DECK_MEDIA_FILE_ID is unset (no canonical deck requested). */
export function deckFromEnv(env = process.env) {
  if (env.PARITY_SEED_CANONICAL === "1" && !env.PARITY_DECK_MEDIA_FILE_ID) throw new Error("PARITY_DECK_MEDIA_FILE_ID is required to seed canonical capture state");
  if (!env.PARITY_DECK_MEDIA_FILE_ID) return null;
  return { deckFile: env.PARITY_DECK_MEDIA_FILE_ID, positionMs: Number(env.PARITY_DECK_POSITION_MS ?? 15098), durationMs: Number(env.PARITY_DECK_DURATION_MS ?? 6742000) };
}

/** Reset progress to the canonical deck when requested. Returns the new snapshot, or null when nothing was requested. */
export async function applyCanonicalDeck(context, env = process.env) {
  const deck = deckFromEnv(env);
  return deck ? (await seedCanonicalDeck(context, deck)).snapshot : null;
}
