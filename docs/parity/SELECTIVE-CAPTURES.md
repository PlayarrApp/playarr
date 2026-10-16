# Selective parity captures

Use a selective run when one screen changes and the existing result and capture set still belongs to the same suite, build, clock, and state snapshot. A selective result merge keeps every unselected ID and its original `checked_at`; it rejects incomplete or mismatched provenance. The aggregate pass count cannot fall unless the operator supplies a non-empty regression reason, which is retained in the result audit metadata.

Run the suite with a narrow selection, for example:

```sh
node scripts/parity/suite-run.mjs --driver ./scripts/parity/drivers/web.mjs --out <fresh-incoming-dir> --stable --only screens --screens home
```

For a stable web capture, provide the isolated `PARITY_CLIENT`, its lock directory, and credentials through the documented parity environment. The runner writes selected images and a `captures.json` manifest containing exactly the selected screen/theme rows, group-relative paths, PNG SHA-256 values, the verified web build SHA, and ISO capture times. The complete `sha@builtAt` identity is checked before and after capture, while the manifest's build value remains the SHA used by `web/build.json`. Use a fresh incoming directory for every selective run; the runner refuses to overwrite an existing `captures.json`. Keep the incoming directory intact until the merge is reviewed. The previous and incoming manifests must have identical `suite`, `build`, `clock`, and `state` provenance.

A full stable screen capture writes one manifest covering every selected theme and screen. It also requires a fresh output directory, so a failed recapture cannot leave old manifest hashes pointing at replaced PNGs. Non-stable runs do not emit a verified-capture manifest.

`capture-refs.mjs` captures several viewport groups in one invocation, so it writes one manifest per candidate at `<work>/<group>/captures.json`; use that group directory as the incoming directory. Manifest capture paths are relative to the group. Its `provenance.build` and each capture's `build` contain the web build SHA so they match `web/build.json.sha`; the complete `sha@builtAt` identity is checked before and after capture. Live screens such as `player-controls` are currently unsupported by this deterministic entrypoint: requesting one fails before capture, and other selected screens never pull or publish it implicitly.

For a wall candidate, first review the incoming bytes against the current references and legend. The review overlays them in memory and does not change the candidate, cache, or legend:

```sh
node <wall-update-script> --review-selective --incoming <incoming-dir> --selected home --client <client-slug> --receipt-out <review-receipt.json>
```

If the score falls, review exits without writing a receipt unless `--regression-reason "<reason>"` is supplied. Keep the generated receipt with the review. Apply the selected capture merge only with that receipt:

```sh
node scripts/parity/selective-captures-apply.mjs --previous <candidate-dir> --incoming <incoming-dir> --selected home --all <all-screen-ids> --themes dark,light
node scripts/parity/selective-captures-apply.mjs --previous <candidate-dir> --incoming <incoming-dir> --selected home --all <all-screen-ids> --themes dark,light --apply --review-receipt <review-receipt.json>
```

The first command is a dry run. Apply stages the selected image replacements and merged manifest, writes only selected paths, and renames `captures.json` last. Unselected files and their modification times stay unchanged. The receipt binds the selected IDs and both input manifest hashes, so any changed input requires a fresh review. Periodic wall updates read capture timestamps and hashes from the manifest rather than inferring provenance from PNG modification times.
