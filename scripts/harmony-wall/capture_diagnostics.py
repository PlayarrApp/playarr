"""Private, identifier-free summaries for Harmony Previewer capture diagnostics."""
import json
import math
import os


EPISODE_ART_BOUNDS = ((888, 566, 1106, 681), (1141, 566, 1359, 681),
                      (1394, 566, 1612, 681), (1647, 566, 1865, 681))
MAX_IMAGE_PAYLOAD_BYTES = 16 * 1024 * 1024
MAX_IMAGE_DIMENSION = 8192
MAX_IMAGE_PIXELS = 16_000_000
PAYLOAD_METRIC_FIELDS = (
    "width", "height", "mean_red", "mean_green", "mean_blue",
    "stddev_red", "stddev_green", "stddev_blue", "mean_alpha", "stddev_alpha",
    "transparent_fraction", "mean_luma", "stddev_luma", "near_black_fraction",
)


STAGES = (
    "source", "fetch-start", "fetch-ok", "fetch-error", "bridge-source-ready",
    "assigned", "image-source", "image-area-positive", "image-area-zero", "on-complete", "on-error",
    "row-match-found", "row-match-missing", "artwork-state-present", "artwork-state-absent", "artwork-state-mutated",
    "artwork-store-present", "artwork-store-absent", "artwork-store-updated",
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


def image_numeric_metrics(image):
    """Measure channel, alpha and luminance statistics without retaining image bytes."""
    from PIL import ImageStat

    rgba = image.convert("RGBA")
    channels = ImageStat.Stat(rgba)
    luma = rgba.convert("RGB").convert("L")
    luma_stat = ImageStat.Stat(luma)
    pixels = rgba.width * rgba.height
    histogram = luma.histogram()
    alpha_histogram = rgba.getchannel("A").histogram()
    return {
        "width": rgba.width,
        "height": rgba.height,
        "mean_red": round(channels.mean[0], 4),
        "mean_green": round(channels.mean[1], 4),
        "mean_blue": round(channels.mean[2], 4),
        "stddev_red": round(channels.stddev[0], 4),
        "stddev_green": round(channels.stddev[1], 4),
        "stddev_blue": round(channels.stddev[2], 4),
        "mean_alpha": round(channels.mean[3], 4),
        "stddev_alpha": round(channels.stddev[3], 4),
        "transparent_fraction": round(sum(alpha_histogram[:9]) / pixels, 6),
        "mean_luma": round(luma_stat.mean[0], 4),
        "stddev_luma": round(luma_stat.stddev[0], 4),
        "near_black_fraction": round(sum(histogram[:9]) / pixels, 6),
    }


def image_payload_metrics(payload):
    """Return bounded status and numeric metrics only. Never return decode errors or bytes."""
    import io
    import warnings
    from PIL import Image

    if len(payload) > MAX_IMAGE_PAYLOAD_BYTES:
        return {"decode_status": "oversized"}
    try:
        with warnings.catch_warnings(record=True) as caught_warnings:
            warnings.simplefilter("always", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload)) as image:
                width, height = image.size
                if (width <= 0 or height <= 0 or width > MAX_IMAGE_DIMENSION
                        or height > MAX_IMAGE_DIMENSION or width * height > MAX_IMAGE_PIXELS
                        or caught_warnings):
                    return {"decode_status": "oversized"}
                image.load()
                metrics = image_numeric_metrics(image)
        metrics["decode_status"] = "ok"
        return metrics
    except Image.DecompressionBombError:
        return {"decode_status": "oversized"}
    except Exception:
        return {"decode_status": "malformed"}


def analyze_episode_art_frame(image):
    """Check the four measured TV episode-art regions, failing closed on other frame sizes."""
    if image.size != (1920, 1080):
        return {
            "status": "incompatible-dimensions",
            "width": image.width,
            "height": image.height,
            "expected_width": 1920,
            "expected_height": 1080,
            "crop_count": 0,
        }

    crops = []
    for left, top, right, bottom in EPISODE_ART_BOUNDS:
        crop = image.crop((left, top, right + 1, bottom + 1))
        metrics = image_numeric_metrics(crop)
        metrics["uniformly_black"] = (
            metrics["mean_luma"] <= 4
            and metrics["stddev_luma"] <= 2
            and metrics["near_black_fraction"] >= 0.995
        )
        crops.append(metrics)
    black_count = sum(1 for crop in crops if crop["uniformly_black"])
    return {
        "status": "uniformly-black-episode-art" if black_count == len(crops) else "ok",
        "width": image.width,
        "height": image.height,
        "crop_count": len(crops),
        "uniformly_black_count": black_count,
        "crops": crops,
    }


def decoded_art_is_accepted(completion_seen, episode_art_metrics):
    """An image completion counts only after the captured episode-art frame passes its guard."""
    return bool(completion_seen and isinstance(episode_art_metrics, dict)
                and episode_art_metrics.get("status") == "ok")


def summarize_detail_image_payload_events(events, *, sequence_after, work_id, generation):
    """Aggregate only numeric payload measurements from the requested Detail route scope."""
    payloads = []
    decode_errors = 0
    oversized = 0
    for event in events:
        if event.get("sequence", 0) <= sequence_after:
            continue
        if (event.get("route") != "Detail" or event.get("work_id") != work_id
                or event.get("parent_work_id") != work_id or not event.get("row_id")
                or event.get("generation") != generation):
            continue
        category = event.get("category")
        if category == "detail-image-payload-decode-error":
            decode_errors += 1
        elif category == "detail-image-payload-oversized":
            oversized += 1
            decode_errors += 1
        elif category == "detail-image-payload-metrics":
            payloads.append(event)

    result = {"payload_count": len(payloads), "decode_error_count": decode_errors,
              "oversized_count": oversized}
    for field in PAYLOAD_METRIC_FIELDS:
        values = []
        for event in payloads:
            value = event.get(field)
            if (isinstance(value, (int, float)) and not isinstance(value, bool)
                    and math.isfinite(value)):
                values.append(value)
        if values:
            result[field] = {
                "min": min(values),
                "max": max(values),
                "mean": round(sum(values) / len(values), 4),
            }
    return result


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


def write_detail_summary(out_dir, *, theme, accepted, failure, frame_path, stages, layout=None,
                         payload_metrics=None, episode_art=None):
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
        "payload_metrics": payload_metrics or {"payload_count": 0, "decode_error_count": 0,
                                                "oversized_count": 0},
        "episode_art": episode_art or {},
    }
    filename = "series-detail-" + theme + "-diagnostics.json"
    with open(os.path.join(debug_dir, filename), "w", encoding="utf-8") as stream:
        json.dump(summary, stream, sort_keys=True)
    return summary
