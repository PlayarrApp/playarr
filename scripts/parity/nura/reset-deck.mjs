#!/usr/bin/env node
// Local-only canonical state preparation for the Nura (and Sailfish) captures: one canonical On deck item, no other progress.
// Invoke this module from inside withCaptureState's callback so reset and captures share one account lock.
// Resume-plan choices are cleared because the server API cannot enumerate them for snapshot/restore.
import { withCaptureState } from "../capture-state.mjs";
import { pathToFileURL } from "node:url";

export async function seedCanonicalDeck({ snapshot, snapshotNow, writeProgress, clearResumeChoices }, { deckFile, positionMs, durationMs }) {
  if (!deckFile || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deckFile)) throw new Error("deckFile must be a locally supplied media ID");
  const deck = snapshot.files[deckFile];
  if (!deck) throw new Error("canonical deck item is absent from the captured progress scope");
  for (const [file, row] of Object.entries(snapshot.files)) {
    if (file === deckFile) continue;
    await writeProgress(file, { position_ms: 0, duration_ms: row.duration_ms, completed: false });
  }
  const position = Number(positionMs ?? process.env.PARITY_DECK_POSITION_MS ?? deck.position_ms ?? 1);
  const duration = Number(durationMs ?? process.env.PARITY_DECK_DURATION_MS ?? deck.duration_ms);
  if (!(position > 0 && duration > position)) throw new Error("canonical deck position/duration are invalid");
  await writeProgress(deckFile, { position_ms: position, duration_ms: duration, completed: false });
  const clearedResumeChoiceWorks = await clearResumeChoices();
  return { snapshot: await snapshotNow(), clearedResumeChoiceWorks };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const client = process.env.PARITY_CLIENT;
  const deckFile = process.env.PARITY_DECK_MEDIA_FILE_ID;
  /* nura-14: the Nura VM is signed in as the device-test account (sub verified by guard.sh), whose credentials are the unsuffixed defaults */
  if (!deckFile || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deckFile)) throw new Error("PARITY_DECK_MEDIA_FILE_ID must be supplied locally");
  if (process.argv.includes("--dry")) {
    console.log("would clear progress except the configured canonical deck item and remove resume-plan choices");
  } else {
    // withCaptureState restores the account's progress when its callback returns, so a standalone reset is undone at once. With
    // `-- <command...>` the command runs inside the callback (after the seed), sharing the account lock, and the state is restored after it.
    const at = process.argv.indexOf("--");
    const state = await withCaptureState({ client: undefined, files: [deckFile] }, async (context) => {
      const seeded = await seedCanonicalDeck(context, { deckFile });
      if (at >= 0) {
        const { spawnSync } = await import("node:child_process");
        const run = spawnSync(process.argv[at + 1], process.argv.slice(at + 2), { stdio: "inherit", env: context.env ?? process.env });
        if (run.status !== 0) throw new Error(`wrapped command exited with ${run.status}`);
      }
      return seeded;
    });
    console.log(`canonical progress seeded; state hash ${state.snapshot.hash}; cleared resume choices for ${state.clearedResumeChoiceWorks} works`);
  }
}
