"""Private, identifier-free summaries for Harmony Previewer capture diagnostics."""
import json
import math
import os


MAX_IMAGE_PAYLOAD_BYTES = 16 * 1024 * 1024
MAX_IMAGE_DIMENSION = 8192
MAX_IMAGE_PIXELS = 16_000_000
# Ignore slivers shorter than the measured card's quarter-scale minimum.
MIN_VISIBLE_EPISODE_CROP = (64, 48)
PAYLOAD_METRIC_FIELDS = (
    "width", "height", "mean_red", "mean_green", "mean_blue",
    "stddev_red", "stddev_green", "stddev_blue", "mean_alpha", "stddev_alpha",
    "transparent_fraction", "mean_luma", "stddev_luma", "near_black_fraction",
)


def confirm_detail_route_source(detail_sources, name, state, work_id):
    """Record only a confirmed suite-pinned Detail/work route, independent of later visual acceptance."""
    if state.get("route") != "Detail" or state.get("work_id") != work_id:
        return False
    detail_sources[name] = {"route": "Detail", "source": "suite.json:open", "route_confirmed": True}
    return True


def summarize_detail_load_events(events, *, sequence_after, work_id, generation,
                                remote_input_sent_before_focus_assertion):
    """Keep only safe Detail-load state and API outcome fields for one Previewer route generation."""
    result = {"route_generation": generation, "events": [],
              "remote_input_sent_before_focus_assertion": bool(remote_input_sent_before_focus_assertion)}
    for event in events:
        if (event.get("sequence", 0) <= sequence_after or event.get("route") != "Detail"
                or event.get("work_id") != work_id or event.get("generation") != generation):
            continue
        category = event.get("category")
        if category not in ("detail-load-load-start", "detail-load-api-result", "detail-load-render-state"):
            continue
        safe = {"stage": category.removeprefix("detail-load-"),
                "sequence": event.get("sequence"), "load_sequence": event.get("load_sequence"),
                "render_state": event.get("render_state")}
        if category == "detail-load-api-result":
            safe.update({"result_category": event.get("result_category"), "status": event.get("status"),
                         "error_category": event.get("error_category")})
        result["events"].append(safe)
    return result


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
    "series-focus-request-count", "series-focused-row-is-target",
    "series-target-season-row-area", "series-target-season-centre-delta-vp",
    "series-target-card-visibility", "series-target-area-sample",
    "series-focus-request-issued", "series-focus-request-result",
    "detail-preview-generation-scope",
    "episode-card-container-report", "episode-card-container-receiver",
    "detail-row-area-geometry", "target-episode-initial-index-watch",
    "target-episode-initial-index-watch-hook-ran", "target-episode-list-appeared",
    "target-episode-list-appeared-hook-ran", "target-episode-initial-index-applied",
    "target-episode-live-item-count-at-callback", "target-episode-positioned-callback",
    "target-episode-live-prop-target-found", "target-episode-live-prop-target-index",
    "target-episode-live-prop-target-at-callback-found", "target-episode-live-prop-target-at-callback-index",
    "target-episode-callback-captured-item-count", "target-episode-callback-captured-target-found",
    "target-episode-callback-captured-target-index", "target-episode-callback-live-rail-found",
    "target-episode-callback-live-item-count", "target-episode-callback-live-target-found",
    "target-episode-callback-live-target-index",
    "resume-plan-loaded", "target-present", "target-in-any-rail", "target-card-mounted",
    "target-season-scroll-requested", "target-episode-scroll-requested", "focus-pending", "focus-suppressed",
    "focus-request-count",
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


def _episode_art_scope(events, *, sequence_after, work_id, generation, frame_size):
    target_samples = []
    card_areas = {}
    image_areas = {}
    positive_area_rows = set()
    completed_rows = set()
    invalid_geometry_count = 0
    container_area_report_count = 0
    container_area_sender_failures = {
        "route": 0, "work-absent": 0, "work-mismatch": 0, "generation-mismatch": 0,
        "rectangle-nonfinite": 0, "rectangle-nonpositive": 0, "density-invalid": 0,
    }
    container_area_receiver_accept_count = 0
    container_area_receiver_reject_count = 0
    container_area_rejection_codes = {}
    container_area_invalid_count = 0
    container_area_offscreen_count = 0
    container_area_visible_candidate_count = 0
    container_bounds = {field: [] for field in ("x_vp", "y_vp", "width_vp", "height_vp", "density")}
    for event in events:
        if (event.get("sequence", 0) <= sequence_after or event.get("route") != "Detail"
                or event.get("work_id") != work_id or event.get("generation") != generation):
            continue
        category = event.get("category")
        if category == "detail-layout-episode-card-container-report":
            container_area_report_count += 1
            failure_fields = (
                ("sender_route_ok", "route"), ("sender_work_present", "work-absent"),
                ("sender_work_matches", "work-mismatch"), ("sender_generation_matches", "generation-mismatch"),
                ("sender_rect_finite", "rectangle-nonfinite"), ("sender_rect_positive", "rectangle-nonpositive"),
                ("sender_density_valid", "density-invalid"),
            )
            for field, label in failure_fields:
                if event.get(field) == 0:
                    container_area_sender_failures[label] += 1
            continue
        if category == "detail-layout-episode-card-container-receiver":
            accepted = event.get("accepted")
            if accepted == 1:
                container_area_receiver_accept_count += 1
            elif accepted == 0:
                container_area_receiver_reject_count += 1
                reason_code = event.get("reason_code")
                if isinstance(reason_code, int) and not isinstance(reason_code, bool):
                    container_area_rejection_codes[reason_code] = container_area_rejection_codes.get(reason_code, 0) + 1
            continue
        if event.get("parent_work_id") != work_id:
            continue
        row_id = event.get("row_id")
        if not isinstance(row_id, str) or not row_id:
            continue
        if category == "detail-episode-target":
            target_samples.append((event.get("sequence", 0), row_id))
        elif category in ("detail-episode-card-container-area", "detail-episode-card-area"):
            values = tuple(event.get(key) for key in ("x_vp", "y_vp", "width_vp", "height_vp", "density"))
            if any(not isinstance(value, (int, float)) or isinstance(value, bool)
                   or (isinstance(value, float) and not math.isfinite(value))
                   or abs(value) > 1_000_000 for value in values):
                invalid_geometry_count += 1
                if category == "detail-episode-card-container-area":
                    container_area_invalid_count += 1
                continue
            x_vp, y_vp, width_vp, height_vp, density = values
            if width_vp <= 0 or height_vp <= 0 or density <= 0 or density > 10:
                invalid_geometry_count += 1
                if category == "detail-episode-card-container-area":
                    container_area_invalid_count += 1
                continue
            if category == "detail-episode-card-container-area":
                container_area_receiver_accept_count += 1
                for field, value in zip(("x_vp", "y_vp", "width_vp", "height_vp", "density"), values):
                    container_bounds[field].append(value)
            sequence = event.get("sequence", 0)
            destination = card_areas if category == "detail-episode-card-container-area" else image_areas
            if row_id not in destination or sequence > destination[row_id][0]:
                destination[row_id] = (sequence, x_vp * density, y_vp * density,
                                       width_vp * density, height_vp * density)
        elif (category == "detail-row-image-image-area-positive"
              and event.get("parent_work_id") == work_id):
            positive_area_rows.add(row_id)
        elif category == "detail-row-image-on-complete" and event.get("parent_work_id") == work_id:
            completed_rows.add(row_id)

    target_id = max(target_samples, key=lambda item: item[0])[1] if target_samples else None
    width, height = frame_size
    visible = []
    partial_count = 0
    low_visibility_count = 0
    for row_id, (sequence, x, y, card_width, card_height) in card_areas.items():
        right = x + card_width
        bottom = y + card_height
        intersects = right > 0 and bottom > 0 and x < width and y < height
        if not intersects:
            container_area_offscreen_count += 1
            continue
        container_area_visible_candidate_count += 1
        clipped_left = max(0, x)
        clipped_top = max(0, y)
        clipped_right = min(width, right)
        clipped_bottom = min(height, bottom)
        visible_width = clipped_right - clipped_left
        visible_height = clipped_bottom - clipped_top
        if (visible_width < MIN_VISIBLE_EPISODE_CROP[0]
                or visible_height < MIN_VISIBLE_EPISODE_CROP[1]):
            low_visibility_count += 1
            continue
        is_full = x >= 0 and y >= 0 and right <= width and bottom <= height
        if not is_full:
            partial_count += 1
        left_pixel = math.floor(clipped_left)
        top_pixel = math.floor(clipped_top)
        right_pixel = math.ceil(clipped_right)
        bottom_pixel = math.ceil(clipped_bottom)
        if right_pixel <= left_pixel or bottom_pixel <= top_pixel:
            low_visibility_count += 1
            continue
        image_rect = image_areas.get(row_id)
        image_bounds = None
        if image_rect is not None:
            _, image_x, image_y, image_width, image_height = image_rect
            image_left = max(0, image_x)
            image_top = max(0, image_y)
            image_right = min(width, image_x + image_width)
            image_bottom = min(height, image_y + image_height)
            if image_right > image_left and image_bottom > image_top:
                image_bounds = (math.floor(image_left), math.floor(image_top),
                                math.ceil(image_right), math.ceil(image_bottom))
        visible.append({
            "row_id": row_id,
            "sequence": sequence,
            "bounds": image_bounds,
            "full": is_full,
            "has_positive_image_area": row_id in positive_area_rows and image_bounds is not None,
            "has_image_completion": row_id in completed_rows,
            "is_target": row_id == target_id,
        })
    return {
        "target_id": target_id,
        "visible": visible,
        "partial_count": partial_count,
        "low_visibility_count": low_visibility_count,
        "target_fully_visible": any(row["is_target"] and row["full"] for row in visible),
        "missing_image_area_count": sum(not row["has_positive_image_area"] for row in visible),
        "missing_completion_count": sum(not row["has_image_completion"] for row in visible),
        "invalid_geometry_count": invalid_geometry_count,
        "container_area_report_count": container_area_report_count,
        "container_area_sender_failures": container_area_sender_failures,
        "container_area_receiver_accept_count": container_area_receiver_accept_count,
        "container_area_receiver_reject_count": container_area_receiver_reject_count,
        "container_area_rejection_codes": container_area_rejection_codes,
        "container_area_invalid_count": container_area_invalid_count,
        "container_area_candidate_count": len(card_areas),
        "container_area_visible_candidate_count": container_area_visible_candidate_count,
        "container_area_offscreen_count": container_area_offscreen_count,
        "container_area_geometry_vp": {
            key: {"min": min(values), "max": max(values)}
            for key, values in container_bounds.items() if values
        },
    }


def _container_area_rejection_reason(scope):
    if scope["target_fully_visible"]:
        return "none"
    if scope["container_area_receiver_reject_count"]:
        codes = scope["container_area_rejection_codes"]
        code = max(codes, key=codes.get) if codes else 0
        return {
            1: "receiver-scope-rejected",
            2: "receiver-generation-rejected",
            3: "receiver-invalid-rectangle",
            4: "receiver-nonpositive-or-invalid-density",
        }.get(code, "receiver-rejected")
    sender_failures = scope["container_area_sender_failures"]
    for label in ("route", "work-absent", "work-mismatch", "generation-mismatch",
                  "rectangle-nonfinite", "rectangle-nonpositive", "density-invalid"):
        if sender_failures[label]:
            return "sender-" + label
    if scope["container_area_invalid_count"]:
        return "invalid-geometry"
    if scope["container_area_candidate_count"] == 0:
        if scope["container_area_report_count"] == 0:
            return "no-report-invocation"
        return "no-accepted-container-area"
    if scope["container_area_offscreen_count"] == scope["container_area_candidate_count"]:
        return "rectangles-outside-viewport"
    if scope["low_visibility_count"]:
        return "below-visible-area-threshold"
    if scope["target_id"] is None:
        return "target-not-reported"
    return "no-visible-target-card"


def episode_art_events_ready(events, *, sequence_after, work_id, generation, frame_size=(1920, 1080)):
    """Return true only when a fresh visible target and every visible episode card completed artwork."""
    scope = _episode_art_scope(events, sequence_after=sequence_after, work_id=work_id,
                               generation=generation, frame_size=frame_size)
    visible = scope["visible"]
    return bool(scope["target_id"] is not None and visible and scope["target_fully_visible"]
                and any(row["is_target"] for row in visible)
                and scope["invalid_geometry_count"] == 0
                and scope["missing_image_area_count"] == 0 and scope["missing_completion_count"] == 0)


def analyze_episode_art_frame(image, *, events, sequence_after, work_id, generation):
    """Validate measured visible card crops with fresh scoped image-area and completion events."""
    if image.size != (1920, 1080):
        return {
            "status": "incompatible-dimensions",
            "width": image.width,
            "height": image.height,
            "expected_width": 1920,
            "expected_height": 1080,
            "crop_count": 0,
        }

    scope = _episode_art_scope(events, sequence_after=sequence_after, work_id=work_id,
                               generation=generation, frame_size=image.size)
    visible = scope["visible"]
    common = {
        "width": image.width,
        "height": image.height,
        "visible_row_count": len(visible),
        "target_visible": any(row["is_target"] for row in visible),
        "target_fully_visible": scope["target_fully_visible"],
        "partial_card_count": scope["partial_count"],
        "low_visibility_card_count": scope["low_visibility_count"],
        "missing_image_area_count": scope["missing_image_area_count"],
        "missing_completion_count": scope["missing_completion_count"],
        "invalid_geometry_count": scope["invalid_geometry_count"],
        "container_area_report_count": scope["container_area_report_count"],
        "container_area_sender_failures": scope["container_area_sender_failures"],
        "container_area_receiver_accept_count": scope["container_area_receiver_accept_count"],
        "container_area_receiver_reject_count": scope["container_area_receiver_reject_count"],
        "container_area_rejection_codes": scope["container_area_rejection_codes"],
        "container_area_invalid_count": scope["container_area_invalid_count"],
        "container_area_candidate_count": scope["container_area_candidate_count"],
        "container_area_visible_candidate_count": scope["container_area_visible_candidate_count"],
        "container_area_offscreen_count": scope["container_area_offscreen_count"],
        "container_area_geometry_vp": scope["container_area_geometry_vp"],
        "container_area_rejection_reason": _container_area_rejection_reason(scope),
    }
    if scope["target_id"] is None:
        return {"status": "target-not-reported", "crop_count": 0, **common}
    if not visible:
        return {"status": "no-visible-episode-cards", "crop_count": 0, **common}
    if not common["target_visible"]:
        return {"status": "target-not-visible", "crop_count": 0, **common}
    if not common["target_fully_visible"]:
        return {"status": "target-not-fully-visible", "crop_count": 0, **common}
    if common["invalid_geometry_count"] > 0:
        return {"status": "invalid-card-geometry", "crop_count": 0, **common}
    if scope["missing_image_area_count"] > 0:
        return {"status": "visible-row-image-area-missing", "crop_count": 0, **common}
    if scope["missing_completion_count"] > 0:
        return {"status": "visible-row-image-completion-missing", "crop_count": 0, **common}

    crops = []
    for row in visible:
        crop = image.crop(row["bounds"])
        metrics = image_numeric_metrics(crop)
        left, top, right, bottom = row["bounds"]
        metrics["left_px"] = left
        metrics["top_px"] = top
        metrics["visible_width_px"] = right - left
        metrics["visible_height_px"] = bottom - top
        metrics["is_target"] = row["is_target"]
        metrics["is_placeholder"] = metrics["stddev_luma"] <= 8
        crops.append(metrics)
    placeholder_count = sum(crop["is_placeholder"] for crop in crops)
    return {
        "status": "placeholder-episode-art" if placeholder_count > 0 else "ok",
        "crop_count": len(crops),
        "placeholder_count": placeholder_count,
        **common,
        "crops": crops,
    }


def decoded_art_is_accepted(completion_seen, episode_art_metrics):
    """An image completion counts only after the captured episode-art frame passes its guard."""
    return bool(completion_seen and isinstance(episode_art_metrics, dict)
                and episode_art_metrics.get("status") == "ok")


def series_focus_failure(layout_summary, episode_art_metrics):
    """Require visible target geometry, fresh offsets and actual target focus acceptance."""
    target_visibility = layout_summary.get("series-target-card-visibility", {})
    visibility_width = target_visibility.get("intersection_width_vp", {}).get("last_value")
    visibility_height = target_visibility.get("intersection_height_vp", {}).get("last_value")
    page_offset = target_visibility.get("page_offset_vp", {}).get("last_value")
    rail_offset = target_visibility.get("rail_offset_vp", {}).get("last_value")
    if (target_visibility.get("visible", {}).get("last_value") != 1
            or target_visibility.get("offsets_fresh", {}).get("last_value") != 1
            or not isinstance(visibility_width, (int, float)) or visibility_width <= 0
            or not isinstance(visibility_height, (int, float)) or visibility_height <= 0
            or not isinstance(page_offset, (int, float)) or not math.isfinite(page_offset)
            or not isinstance(rail_offset, (int, float)) or not math.isfinite(rail_offset)):
        return "target-visibility-or-offsets-missing"
    if not isinstance(episode_art_metrics, dict) or not episode_art_metrics.get("target_fully_visible"):
        return "target-art-not-fully-visible"
    if layout_summary.get("series-focus-request-result", {}).get("last_value") != 1:
        return "focus-request-not-accepted"
    focused = layout_summary.get("series-focused-row-is-target", {})
    if focused.get("last_value") != 1:
        return "focus-not-target"
    return None


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
        for key in ("value", "width", "height", "area", "x", "y", "global_x", "global_y",
                    "x_type_code", "y_type_code", "global_x_type_code", "global_y_type_code",
                    "width_type_code", "height_type_code", "x_unit_code", "y_unit_code",
                    "global_x_unit_code", "global_y_unit_code", "width_unit_code", "height_unit_code",
                    "visible", "offsets_fresh", "present", "captured_generation", "live_generation", "scope_matches",
                    "intersection_width_vp", "intersection_height_vp", "page_offset_vp", "rail_offset_vp",
                    "width_vp", "height_vp", "sampled_at_ms", "report_invoked", "sender_route_ok",
                    "sender_work_present", "sender_work_matches", "sender_generation_matches",
                    "sender_rect_finite", "sender_rect_positive", "sender_density_valid", "x_vp", "y_vp",
                    "density", "accepted", "reason_code"):
            value = event.get(key)
            if (isinstance(value, (int, float)) and not isinstance(value, bool)
                    and (not isinstance(value, float) or math.isfinite(value))):
                metrics[key] = value
        samples[stage].append((event.get("sequence", 0), elapsed, metrics))

    result = {}
    for stage, stage_samples in samples.items():
        if not stage_samples:
            continue
        entry = {"count": len(stage_samples)}
        elapsed = [sample[1] for sample in stage_samples if sample[1] is not None]
        if elapsed:
            entry["first_elapsed_ms"] = min(elapsed)
            entry["last_elapsed_ms"] = max(elapsed)
        for metric in ("value", "width", "height", "area", "x", "y", "global_x", "global_y",
                       "x_type_code", "y_type_code", "global_x_type_code", "global_y_type_code",
                       "width_type_code", "height_type_code", "x_unit_code", "y_unit_code",
                       "global_x_unit_code", "global_y_unit_code", "width_unit_code", "height_unit_code",
                       "visible", "offsets_fresh", "present", "captured_generation", "live_generation", "scope_matches",
                       "intersection_width_vp", "intersection_height_vp", "page_offset_vp", "rail_offset_vp",
                       "width_vp", "height_vp", "sampled_at_ms", "report_invoked", "sender_route_ok",
                       "sender_work_present", "sender_work_matches", "sender_generation_matches",
                       "sender_rect_finite", "sender_rect_positive", "sender_density_valid", "x_vp", "y_vp",
                       "density", "accepted", "reason_code"):
            values = [sample[2][metric] for sample in stage_samples if metric in sample[2]]
            if values:
                entry[metric] = {"min": min(values), "max": max(values)}
                if stage == "series-target-card-visibility" and metric in (
                            "visible", "offsets_fresh", "intersection_width_vp", "intersection_height_vp",
                            "page_offset_vp", "rail_offset_vp"):
                    last_sample = max(stage_samples, key=lambda sample: sample[0])
                    if metric in last_sample[2]:
                        entry[metric]["last_value"] = last_sample[2][metric]
                if stage in ("series-focused-row-is-target", "series-focus-request-issued",
                             "series-focus-request-result") and metric == "value":
                    last_sample = max(stage_samples, key=lambda sample: sample[0])
                    entry["last_value"] = last_sample[2][metric]
                if stage == "series-target-season-centre-delta-vp" and metric == "value":
                    last_sample = max(stage_samples, key=lambda sample: sample[0])
                    entry["last_value"] = last_sample[2][metric]
        result[stage] = entry
    return result


def save_rejected_frame(image, out_dir, theme, screen="series-detail"):
    debug_dir = os.path.join(out_dir, "_debug")
    os.makedirs(debug_dir, exist_ok=True)
    filename = "rejected-" + screen + "-" + theme + ".png"
    image.save(os.path.join(debug_dir, filename))
    return os.path.join("_debug", filename)


def write_detail_summary(out_dir, *, theme, accepted, failure, frame_path, stages, layout=None,
                         payload_metrics=None, episode_art=None, detail_load=None):
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
        "detail_load": detail_load or {"events": [], "remote_input_sent_before_focus_assertion": False},
    }
    filename = "series-detail-" + theme + "-diagnostics.json"
    with open(os.path.join(debug_dir, filename), "w", encoding="utf-8") as stream:
        json.dump(summary, stream, sort_keys=True)
    return summary


def phone_flat_card_rows(image, *, min_run_px=500, min_rows=100):
    """Phone episode cards drawn as grey placeholders: a flat, single-colour block as wide as a card (167 vp or more) and
    tall as one (about 33 vp or more per 100 px rows), in a colour other than the page. Real art never has 500 identical pixels in a
    row for 100 rows; buttons are narrower and carry text. Returns the number of such blocks found (0 means art is drawn)."""
    rgb = image.convert("RGB")
    width, height = rgb.size
    px = rgb.load()
    page = px[min(20, width - 1), height // 2]
    blocks, run_rows = 0, {}
    for y in range(0, height):
        row_hits = set()
        x = 0
        while x < width:
            colour = px[x, y]
            start = x
            while x < width and px[x, y] == colour:
                x += 1
            if x - start >= min_run_px and colour != page:
                row_hits.add((colour, start // 40))
        # a block continues while the same colour keeps a wide run at about the same left edge
        nxt = {}
        for key in row_hits:
            nxt[key] = run_rows.get(key, 0) + 1
        for key, count in run_rows.items():
            if key not in nxt and count >= min_rows:
                blocks += 1
        run_rows = nxt
    blocks += sum(1 for count in run_rows.values() if count >= min_rows)
    return blocks


def tv_flat_card_blocks(image, *, card=(300, 160), step=40, tolerance=16):
    """TV poster cards still on their placeholder: a card-sized window (right of the nav rail) whose pixels barely vary and whose colour is not
    the page's. Real art never fills 300x160 px that evenly. Returns the number of distinct blocks (a grid cell counts once)."""
    rgb = image.convert("RGB")
    width, height = rgb.size
    page = rgb.getpixel((min(700, width - 1), 120))
    cells = set()
    for y in range(380, height - card[1] + 1, step):
        for x in range(860, width - card[0] + 1, step):
            box = rgb.crop((x, y, x + card[0], y + card[1]))
            extrema = box.getextrema()
            if any(high - low > tolerance for low, high in extrema):
                continue
            mean = [(low + high) // 2 for low, high in extrema]
            if any(abs(mean[i] - page[i]) > 6 for i in range(3)):
                cells.add((x // 330, y // 200))
    return len(cells)


HOME_RECENT_CARDS = tuple((x + 20, 830, x + 300, 970) for x in (882, 1234, 1586))  # the first three Recently Added posters, inset


def home_recent_flat(image, *, tolerance=40):
    """Any of the first three Recently Added posters still a flat placeholder (dark one 17 levels, light gradient 16; real art 255)."""
    rgb = image.convert("RGB")
    return any(max(high - low for low, high in rgb.crop(box).getextrema()) <= tolerance for box in HOME_RECENT_CARDS)


POSTER_STALL_MIN_COMPLETE = 15  # Home: a good Previewer process completes 66-80 images by the frame, a stalled one 2-6
POSTER_STALL_MIN_BLOCKS = 2


def posters_stalled(name, image_completes, flat_blocks, home_flat=False):
    """True when the Previewer's image pipeline has stalled for this frame: Home's first Recently Added posters are flat, or two or more
    flat card blocks show on any screen, or Home completed far fewer images than a healthy process. The caller restarts the Previewer."""
    if flat_blocks >= POSTER_STALL_MIN_BLOCKS or (name == "home" and home_flat):
        return True
    return name == "home" and image_completes is not None and image_completes < POSTER_STALL_MIN_COMPLETE
