"""Private, identifier-free summaries for Harmony Previewer capture diagnostics."""
import json
import math
import os


STAGES = (
    "source", "fetch-start", "fetch-ok", "fetch-error", "bridge-source-ready",
    "assigned", "image-source", "image-area-positive", "image-area-zero", "on-complete", "on-error",
    "row-match-found", "row-match-missing", "artwork-state-present", "artwork-state-absent", "artwork-state-mutated",
    "poster-artwork-prop-undefined", "poster-artwork-prop-present",
    "poster-render-artwork-undefined", "poster-render-artwork-present",
    "visible-item-artwork-state-absent", "visible-item-artwork-state-present",
)
LAYOUT_STAGES = (
    "detail-rails-count", "rail-items-count", "rail-item-appear",
    "rail-items-prop-update-count", "rail-items-prop-update-artwork-count",
    "poster-card-root-area", "poster-card-art-area", "rail-list-area",
    "rail-list-height-explicit", "rail-list-height-default-fill",
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


def summarize_detail_layout_events(events, *, sequence_after, work_id, generation, started_at):
    """Return counts, elapsed ranges, and numeric measurements for the current detail route only."""
    samples = {stage: [] for stage in LAYOUT_STAGES}
    for event in events:
        category = event.get("category", "")
        if not isinstance(category, str) or not category.startswith("detail-layout-"):
            continue
        stage = category.removeprefix("detail-layout-")
        if stage not in samples or event.get("sequence", 0) <= sequence_after:
            continue
        if (event.get("route") != "Detail" or event.get("work_id") != work_id
                or event.get("generation") != generation):
            continue
        timestamp = event.get("timestamp")
        elapsed = None
        if (isinstance(timestamp, (int, float)) and not isinstance(timestamp, bool)
                and isinstance(started_at, (int, float)) and not isinstance(started_at, bool)
                and (not isinstance(timestamp, float) or math.isfinite(timestamp))
                and (not isinstance(started_at, float) or math.isfinite(started_at))):
            elapsed = max(0, round((timestamp - started_at) * 1000))
        metrics = {}
        for key in ("value", "width", "height", "area"):
            value = event.get(key)
            if (isinstance(value, (int, float)) and not isinstance(value, bool)
                    and (not isinstance(value, float) or math.isfinite(value))):
                metrics[key] = value
        samples[stage].append((elapsed, metrics))

    result = {}
    for stage, stage_samples in samples.items():
        if not stage_samples:
            continue
        entry = {"count": len(stage_samples)}
        elapsed = [sample[0] for sample in stage_samples if sample[0] is not None]
        if elapsed:
            entry["first_elapsed_ms"] = min(elapsed)
            entry["last_elapsed_ms"] = max(elapsed)
        for metric in ("value", "width", "height", "area"):
            values = [sample[1][metric] for sample in stage_samples if metric in sample[1]]
            if values:
                entry[metric] = {"min": min(values), "max": max(values)}
        result[stage] = entry
    return result


def save_rejected_frame(image, out_dir, theme, screen="series-detail"):
    debug_dir = os.path.join(out_dir, "_debug")
    os.makedirs(debug_dir, exist_ok=True)
    filename = "rejected-" + screen + "-" + theme + ".png"
    image.save(os.path.join(debug_dir, filename))
    return os.path.join("_debug", filename)


def write_detail_summary(out_dir, *, theme, accepted, failure, frame_path, stages, layout=None):
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
        "layout": layout or {},
    }
    filename = "series-detail-" + theme + "-diagnostics.json"
    with open(os.path.join(debug_dir, filename), "w", encoding="utf-8") as stream:
        json.dump(summary, stream, sort_keys=True)
    return summary
