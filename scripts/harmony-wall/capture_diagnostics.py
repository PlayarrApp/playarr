"""Private, identifier-free summaries for Harmony Previewer capture diagnostics."""
import json
import os


STAGES = (
    "source", "fetch-start", "fetch-ok", "fetch-error", "bridge-source-ready",
    "assigned", "image-source", "image-area-positive", "image-area-zero", "on-complete", "on-error",
)


def summarize_detail_events(events, *, sequence_after, work_id, generation, started_at):
    """Aggregate only allowlisted stages; never return identifiers or raw bridge events."""
    samples = {stage: [] for stage in STAGES}
    for event in events:
        category = event.get("category", "")
        if not isinstance(category, str) or not category.startswith("detail-row-image-"):
            continue
        stage = category.removeprefix("detail-row-image-")
        if stage not in samples:
            continue
        if event.get("sequence", 0) <= sequence_after:
            continue
        if (event.get("route") != "Detail" or event.get("work_id") != work_id
                or event.get("parent_work_id") != work_id or not event.get("row_id")
                or event.get("generation") != generation):
            continue
        timestamp = event.get("timestamp")
        if isinstance(timestamp, (int, float)) and isinstance(started_at, (int, float)):
            elapsed_ms = max(0, round((timestamp - started_at) * 1000))
            samples[stage].append(elapsed_ms)
        else:
            samples[stage].append(None)

    result = {}
    for stage in STAGES:
        elapsed = [value for value in samples[stage] if value is not None]
        if not samples[stage]:
            continue
        entry = {"count": len(samples[stage])}
        if elapsed:
            entry["first_elapsed_ms"] = min(elapsed)
            entry["last_elapsed_ms"] = max(elapsed)
        result[stage] = entry
    return result


def save_rejected_frame(image, out_dir, theme, screen="series-detail"):
    debug_dir = os.path.join(out_dir, "_debug")
    os.makedirs(debug_dir, exist_ok=True)
    filename = "rejected-" + screen + "-" + theme + ".png"
    image.save(os.path.join(debug_dir, filename))
    return os.path.join("_debug", filename)


def write_detail_summary(out_dir, *, theme, accepted, failure, frame_path, stages):
    debug_dir = os.path.join(out_dir, "_debug")
    os.makedirs(debug_dir, exist_ok=True)
    summary = {
        "schema_version": 1,
        "screen": "series-detail",
        "theme": theme,
        "accepted": bool(accepted),
        "failure": failure,
        "frame": frame_path,
        "stages": stages,
    }
    filename = "series-detail-" + theme + "-diagnostics.json"
    with open(os.path.join(debug_dir, filename), "w", encoding="utf-8") as stream:
        json.dump(summary, stream, sort_keys=True)
    return summary
